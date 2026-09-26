"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { attemptAnswers, assignmentSubmissions, users } from "@/server/db/schema";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import type { SessionUser } from "@/server/auth/sessions";
import { getOwnedCourse } from "@/server/services/courses";
import { getItem, type CourseItem } from "@/server/services/tree";
import {
  attemptForGrading,
  gradeOpenAnswers,
  gradeSubmission,
  gradedRecently,
} from "@/server/services/grading";
import { listQuestions } from "@/server/services/exams";
import { NO_ANSWER, boardAnswerSummary, imageAnswerSummary } from "@/server/services/exam-review";
import { getAssignmentDetail, listSubmissionFiles } from "@/server/services/assignments";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ─── Detalle de un intento de examen ─────────────────────────────────────────

export type AutoAnswerSummary = {
  questionId: string;
  prompt: string;
  maxPoints: number;
  points: number;
  answerDisplay: string;
};

export type OpenAnswerDetail = {
  questionId: string;
  prompt: string;
  maxPoints: number;
  answerText: string | null;
  manualPoints: number | null;
  feedbackMd: string | null;
};

export type ExamGradingDetail = {
  attemptId: string;
  studentName: string;
  itemTitle: string;
  courseTitle: string;
  attemptNumber: number;
  submittedAtMs: number | null;
  autoScore: number;
  autoMax: number;
  maxScore: number;
  autoAnswers: AutoAnswerSummary[];
  openAnswers: OpenAnswerDetail[];
};

export type LoadExamGradingResult = { ok: true; detail: ExamGradingDetail } | { error: string };

/** El intento debe pertenecer a un examen de un curso del maestro. */
function guardAttempt(
  attemptId: string,
  user: SessionUser
): { data: NonNullable<ReturnType<typeof attemptForGrading>>; item: CourseItem } | null {
  const data = attemptForGrading(attemptId);
  if (!data) return null;
  const item = getItem(data.attempt.examItemId);
  if (!item) return null;
  const course = getOwnedCourse(item.courseId, user);
  if (!course) return null;
  return { data, item };
}

export async function loadExamGradingAction(attemptId: string): Promise<LoadExamGradingResult> {
  const user = await requireTeacher();
  const guarded = guardAttempt(attemptId, user);
  if (!guarded) return { error: "No encontramos este intento o no te pertenece" };
  const { data, item } = guarded;

  const course = getOwnedCourse(item.courseId, user)!;
  const student = db.select().from(users).where(eq(users.id, data.attempt.studentId)).get();

  // Resumen de la parte autocalificada (todo lo que no es texto abierto)
  const allQuestions = listQuestions(item.id);
  const answers = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId))
    .all();
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));

  // Con pool aleatorio, el resumen SOLO incluye las preguntas sorteadas en
  // este intento (mostrar el banco completo inflaba el máximo y pintaba
  // "Sin respuesta" en preguntas que el alumno nunca recibió)
  const drawnIds = data.attempt.questionOrder
    ? new Set(data.attempt.questionOrder as string[])
    : null;
  const autoQuestions = allQuestions.filter(
    (q) => q.type !== "open_text" && (!drawnIds || drawnIds.has(q.id))
  );
  const autoAnswers: AutoAnswerSummary[] = autoQuestions.map((q) => {
    const ans = byQuestion.get(q.id);
    const selected = (ans?.selectedOptionIds as string[] | null) ?? null;
    let answerDisplay = "— Sin respuesta —";
    if (q.type === "single_choice" || q.type === "multiple_choice" || q.type === "true_false") {
      if (selected && selected.length > 0) {
        const chosen = q.options.filter((o) => selected.includes(o.id)).map((o) => o.textMd);
        if (chosen.length > 0) answerDisplay = chosen.join(" · ");
      }
    } else if (q.type === "short_text") {
      if (ans?.answerText?.trim()) answerDisplay = ans.answerText;
    } else if (q.type === "matching") {
      answerDisplay = ans?.answerText ? "Relación de columnas" : "— Sin respuesta —";
    } else if (q.type === "ordering") {
      answerDisplay = ans?.answerText ? "Orden de pasos" : "— Sin respuesta —";
    } else if (q.type === "image_drag" || q.type === "image_click") {
      // El mismo resumen que lee el alumno en su revisión («N de M lugares correctos»…)
      const summary = imageAnswerSummary(q, ans?.answerText, attemptId);
      if (summary !== NO_ANSWER) answerDisplay = summary;
    } else if (q.type === "categorize" || q.type === "cloze") {
      // El mismo resumen que lee el alumno («N de M tarjetas bien», «N de M huecos bien»)
      const summary = boardAnswerSummary(q, ans?.answerText, attemptId);
      if (summary !== NO_ANSWER) answerDisplay = summary;
    }
    return {
      questionId: q.id,
      prompt: q.promptMd,
      maxPoints: q.points,
      points: ans?.autoPoints ?? 0,
      answerDisplay,
    };
  });

  return {
    ok: true,
    detail: {
      attemptId,
      studentName: student?.fullName ?? "Estudiante",
      itemTitle: item.title,
      courseTitle: course.title,
      attemptNumber: data.attempt.attemptNumber,
      submittedAtMs: data.attempt.submittedAt?.getTime() ?? null,
      autoScore: data.attempt.autoScore ?? 0,
      autoMax: autoQuestions.reduce((sum, q) => sum + q.points, 0),
      maxScore:
        data.attempt.maxScoreSnapshot ?? allQuestions.reduce((sum, q) => sum + q.points, 0),
      autoAnswers,
      openAnswers: data.openAnswers.map((o) => ({
        questionId: o.questionId,
        prompt: o.promptMd,
        maxPoints: o.points,
        answerText: o.answerText,
        manualPoints: o.manualPoints,
        feedbackMd: o.feedbackMd,
      })),
    },
  };
}

// ─── Calificar las preguntas abiertas de un intento ──────────────────────────

export type GradeExamAnswersResult =
  | {
      ok: true;
      finalized: boolean;
      /** true si el intento ya tenía nota: esto fue una corrección. */
      regraded: boolean;
      scoreBefore: number | null;
      scoreAfter: number | null;
      /** El alumno ya completó el curso / tiene certificado: avisar al maestro. */
      warning?: string;
    }
  | { error: string };

/**
 * Califica las preguntas abiertas de un intento. Sirve igual para corregir una
 * nota ya publicada: el servicio recalcula, vuelve a firmar quién y cuándo y
 * devuelve de qué nota a cuál se movió.
 */
export async function gradeExamAnswersAction(input: {
  attemptId: string;
  grades: { questionId: string; points: number; feedbackMd: string }[];
}): Promise<GradeExamAnswersResult> {
  const user = await requireTeacher();
  const guarded = guardAttempt(input.attemptId, user);
  if (!guarded) return { error: "No encontramos este intento o no te pertenece" };

  if (input.grades.length === 0) return { error: "No hay preguntas por calificar" };
  if (input.grades.some((g) => !Number.isFinite(g.points))) {
    return { error: "Captura los puntos de todas las preguntas" };
  }

  try {
    const result = gradeOpenAnswers({
      gradedBy: user.id,
      attemptId: input.attemptId,
      grades: input.grades.map((g) => ({
        questionId: g.questionId,
        points: g.points,
        feedbackMd: g.feedbackMd.trim() || undefined,
      })),
    });
    revalidatePath("/teach/grading");
    revalidatePath("/teach/dashboard");
    return { ok: true, ...result };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo guardar la calificación. Intenta de nuevo.") };
  }
}

// ─── Detalle de una entrega de tarea ─────────────────────────────────────────

export type SubmissionGradingDetail = {
  submissionId: string;
  studentName: string;
  itemTitle: string;
  courseTitle: string;
  submittedAtMs: number;
  isLate: boolean;
  comment: string;
  /** Respuesta escrita del alumno (HTML saneado). */
  answerText: string;
  /** Primer archivo (null si la entrega fue solo texto). */
  fileId: string | null;
  fileName: string;
  isPdf: boolean;
  /** Todos los archivos de la entrega. */
  files: { fileId: string; name: string; sizeBytes: number; isPdf: boolean }[];
  maxScore: number;
  dueAtMs: number | null;
  score: number | null;
  feedbackMd: string | null;
};

export type LoadSubmissionGradingResult =
  | { ok: true; detail: SubmissionGradingDetail }
  | { error: string };

function guardSubmission(submissionId: string, user: SessionUser) {
  const submission = db
    .select()
    .from(assignmentSubmissions)
    .where(eq(assignmentSubmissions.id, submissionId))
    .get();
  if (!submission) return null;
  const item = getItem(submission.itemId);
  if (!item) return null;
  const course = getOwnedCourse(item.courseId, user);
  if (!course) return null;
  return { submission, item, course };
}

export async function loadSubmissionGradingAction(
  submissionId: string
): Promise<LoadSubmissionGradingResult> {
  const user = await requireTeacher();
  const guarded = guardSubmission(submissionId, user);
  if (!guarded) return { error: "No encontramos esta entrega o no te pertenece" };
  const { submission, item, course } = guarded;

  const student = db.select().from(users).where(eq(users.id, submission.studentId)).get();
  const assignment = getAssignmentDetail(item.id);
  const allFiles = listSubmissionFiles(submission);
  const file = allFiles[0] ?? null;
  const fileName = file?.originalName ?? "";

  return {
    ok: true,
    detail: {
      submissionId,
      studentName: student?.fullName ?? "Estudiante",
      itemTitle: item.title,
      courseTitle: course.title,
      submittedAtMs: submission.submittedAt.getTime(),
      isLate: submission.isLate,
      comment: submission.comment,
      answerText: submission.answerText,
      fileId: file?.fileId ?? null,
      fileName,
      files: allFiles.map((f) => ({
        fileId: f.fileId,
        name: f.originalName,
        sizeBytes: f.sizeBytes,
        isPdf: f.mimeType === "application/pdf" || f.originalName.toLowerCase().endsWith(".pdf"),
      })),
      isPdf:
        fileName.toLowerCase().endsWith(".pdf") || file?.mimeType === "application/pdf",
      maxScore: assignment?.maxScore ?? 100,
      dueAtMs: assignment?.dueAt?.getTime() ?? null,
      score: submission.score,
      feedbackMd: submission.feedbackMd,
    },
  };
}

// ─── Calificar o devolver una entrega ────────────────────────────────────────

export type GradeSubmissionResult =
  | {
      ok: true;
      /** true si la entrega ya tenía nota: esto fue una corrección. */
      regraded: boolean;
      scoreBefore: number | null;
      scoreAfter: number | null;
      /** El alumno ya completó el curso / tiene certificado: avisar al maestro. */
      warning?: string;
    }
  | { error: string };

export async function gradeSubmissionAction(input: {
  submissionId: string;
  score: number;
  feedbackMd: string;
  action: "grade" | "return";
}): Promise<GradeSubmissionResult> {
  const user = await requireTeacher();
  const guarded = guardSubmission(input.submissionId, user);
  if (!guarded) return { error: "No encontramos esta entrega o no te pertenece" };

  if (input.action === "grade") {
    const maxScore = getAssignmentDetail(guarded.item.id)?.maxScore ?? 100;
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > maxScore) {
      return { error: `Los puntos deben estar entre 0 y ${maxScore}` };
    }
  }

  try {
    const result = gradeSubmission({
      gradedBy: user.id,
      submissionId: input.submissionId,
      score: input.action === "grade" ? input.score : 0,
      feedbackMd: input.feedbackMd.trim() || undefined,
      action: input.action,
    });
    revalidatePath("/teach/grading");
    revalidatePath("/teach/dashboard");
    return { ok: true, ...result };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo guardar la calificación. Intenta de nuevo.") };
  }
}

// ─── Lo ya calificado (para volver a abrirlo y corregirlo) ───────────────────

export type GradedEntry = {
  kind: "exam" | "assignment";
  /** Id del intento o de la entrega, según `kind`. */
  key: string;
  courseId: string;
  courseTitle: string;
  itemTitle: string;
  studentName: string;
  gradedAtMs: number | null;
  score: number | null;
  maxScore: number | null;
  gradedByName: string | null;
  /** «graded» o, en tareas, «returned». */
  status: string;
  isLate: boolean;
};

export type ListGradedResult = { ok: true; entries: GradedEntry[] } | { error: string };

/** Lo calificado hace poco en el contexto de vista actual, lo más nuevo primero. */
export async function listGradedRecentlyAction(
  input: { limit?: number; courseId?: string } = {}
): Promise<ListGradedResult> {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const entries = gradedRecently(scope, { limit: input.limit, courseId: input.courseId });
  return {
    ok: true,
    entries: entries.map((e) => ({
      kind: e.kind,
      key: e.kind === "exam" ? e.attemptId : e.submissionId,
      courseId: e.courseId,
      courseTitle: e.courseTitle,
      itemTitle: e.itemTitle,
      studentName: e.studentName,
      gradedAtMs: e.gradedAt?.getTime() ?? null,
      score: e.score ?? null,
      maxScore: e.maxScore ?? null,
      gradedByName: e.gradedByName ?? null,
      status: e.status ?? "graded",
      isLate: e.kind === "assignment" ? e.isLate : false,
    })),
  };
}
