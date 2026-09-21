import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { ownerCondition, type ViewScope } from "@/server/auth/view-scope";
import {
  examAttempts,
  attemptAnswers,
  questions,
  courseItems,
  courses,
  assignmentSubmissions,
  users,
  enrollments,
  exams,
} from "@/server/db/schema";
import { resultsVisible } from "@/lib/exam-results";
import { evaluateEnrollment } from "./rules-engine";
import { notify } from "./notifications";

// ─── Cola de calificación ────────────────────────────────────────────────────

export type GradingQueueEntry =
  | {
      kind: "exam";
      attemptId: string;
      courseId: string;
      courseTitle: string;
      itemId: string;
      itemTitle: string;
      studentId: string;
      studentName: string;
      submittedAt: Date;
      pendingQuestions: number;
    }
  | {
      kind: "assignment";
      submissionId: string;
      courseId: string;
      courseTitle: string;
      itemId: string;
      itemTitle: string;
      studentId: string;
      studentName: string;
      submittedAt: Date;
      isLate: boolean;
    };

/** Cola global del maestro, ordenada por antigüedad (lo más viejo primero). */
export function gradingQueue(scope: ViewScope): GradingQueueEntry[] {
  const ownerFilter = (ownerId: typeof courses.ownerId) => ownerCondition(scope, ownerId) ?? sql`1=1`;

  const attempts = db
    .select({
      attemptId: examAttempts.id,
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: courseItems.id,
      itemTitle: courseItems.title,
      studentId: users.id,
      studentName: users.fullName,
      submittedAt: examAttempts.submittedAt,
    })
    .from(examAttempts)
    .innerJoin(courseItems, eq(examAttempts.examItemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(examAttempts.studentId, users.id))
    .where(and(eq(examAttempts.status, "submitted"), ownerFilter(courses.ownerId)))
    .all();

  // Pendientes por intento = abiertas SORTEADAS sin calificar. Contar solo
  // filas de attempt_answers subcontaba: una abierta sin responder no tiene
  // fila, pero igual debe calificarse (con 0 o los puntos que decida el
  // maestro).
  const attemptIds = attempts.map((a) => a.attemptId);
  const pendingByAttempt = new Map<string, number>();
  if (attemptIds.length > 0) {
    const fullAttempts = db
      .select({ id: examAttempts.id, examItemId: examAttempts.examItemId, questionOrder: examAttempts.questionOrder })
      .from(examAttempts)
      .where(inArray(examAttempts.id, attemptIds))
      .all();
    const openByExam = new Map<string, string[]>();
    for (const a of fullAttempts) {
      if (!openByExam.has(a.examItemId)) {
        openByExam.set(
          a.examItemId,
          db
            .select({ id: questions.id })
            .from(questions)
            .where(and(eq(questions.examItemId, a.examItemId), eq(questions.type, "open_text")))
            .all()
            .map((q) => q.id)
        );
      }
    }
    const gradedRows = db
      .select({ attemptId: attemptAnswers.attemptId, questionId: attemptAnswers.questionId })
      .from(attemptAnswers)
      .where(
        and(inArray(attemptAnswers.attemptId, attemptIds), sql`${attemptAnswers.manualPoints} IS NOT NULL`)
      )
      .all();
    const gradedByAttempt = new Map<string, Set<string>>();
    for (const r of gradedRows) {
      if (!gradedByAttempt.has(r.attemptId)) gradedByAttempt.set(r.attemptId, new Set());
      gradedByAttempt.get(r.attemptId)!.add(r.questionId);
    }
    for (const a of fullAttempts) {
      const drawn = a.questionOrder ? new Set(a.questionOrder as string[]) : null;
      const openDrawn = (openByExam.get(a.examItemId) ?? []).filter(
        (qid) => !drawn || drawn.has(qid)
      );
      const graded = gradedByAttempt.get(a.id) ?? new Set();
      pendingByAttempt.set(a.id, openDrawn.filter((qid) => !graded.has(qid)).length);
    }
  }

  const submissions = db
    .select({
      submissionId: assignmentSubmissions.id,
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: courseItems.id,
      itemTitle: courseItems.title,
      studentId: users.id,
      studentName: users.fullName,
      submittedAt: assignmentSubmissions.submittedAt,
      isLate: assignmentSubmissions.isLate,
    })
    .from(assignmentSubmissions)
    .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(assignmentSubmissions.studentId, users.id))
    .where(and(eq(assignmentSubmissions.status, "submitted"), ownerFilter(courses.ownerId)))
    .all();

  const entries: GradingQueueEntry[] = [
    ...attempts.map((a) => ({
      kind: "exam" as const,
      ...a,
      submittedAt: a.submittedAt!,
      pendingQuestions: pendingByAttempt.get(a.attemptId) ?? 0,
    })),
    ...submissions.map((s) => ({ kind: "assignment" as const, ...s })),
  ];

  return entries.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
}

// ─── Calificar examen (preguntas abiertas) ───────────────────────────────────

export type OpenAnswerForGrading = {
  answerId: string;
  questionId: string;
  promptMd: string;
  points: number;
  answerText: string | null;
  manualPoints: number | null;
  feedbackMd: string | null;
};

export function attemptForGrading(attemptId: string) {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).get();
  if (!attempt) return null;

  const open = db
    .select({
      answerId: attemptAnswers.id,
      questionId: questions.id,
      promptMd: questions.promptMd,
      points: questions.points,
      answerText: attemptAnswers.answerText,
      manualPoints: attemptAnswers.manualPoints,
      feedbackMd: attemptAnswers.feedbackMd,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(attemptAnswers.questionId, questions.id))
    .where(and(eq(attemptAnswers.attemptId, attemptId), eq(questions.type, "open_text")))
    .orderBy(asc(questions.position))
    .all();

  // Preguntas abiertas SIN respuesta del alumno (también deben calificarse: 0 o puntos).
  // Con pool aleatorio solo cuentan las preguntas sorteadas en este intento.
  const drawnIds = attempt.questionOrder ? new Set(attempt.questionOrder as string[]) : null;
  const answeredIds = new Set(open.map((o) => o.questionId));
  const unanswered = db
    .select()
    .from(questions)
    .where(and(eq(questions.examItemId, attempt.examItemId), eq(questions.type, "open_text")))
    .orderBy(asc(questions.position))
    .all()
    .filter((q) => !answeredIds.has(q.id) && (!drawnIds || drawnIds.has(q.id)))
    .map(
      (q): OpenAnswerForGrading => ({
        answerId: "",
        questionId: q.id,
        promptMd: q.promptMd,
        points: q.points,
        answerText: null,
        manualPoints: null,
        feedbackMd: null,
      })
    );

  return { attempt, openAnswers: [...open, ...unanswered] };
}

/**
 * Guarda la calificación manual de una pregunta abierta. Cuando ya no queda
 * ninguna abierta sin puntos, publica el final_score, marca graded, notifica
 * al alumno y dispara el motor de reglas.
 */
export function gradeOpenAnswer(opts: {
  gradedBy: string;
  attemptId: string;
  questionId: string;
  points: number;
  feedbackMd?: string;
}): { finalized: boolean } {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, opts.attemptId)).get();
  if (!attempt) throw new Error("Intento no encontrado");
  if (attempt.status === "in_progress") throw new Error("Este intento aún no se envía");

  const question = db.select().from(questions).where(eq(questions.id, opts.questionId)).get();
  if (!question || question.examItemId !== attempt.examItemId)
    throw new Error("Pregunta no encontrada");
  if (opts.points < 0 || opts.points > question.points)
    throw new Error(`Los puntos deben estar entre 0 y ${question.points}`);

  const existing = db
    .select()
    .from(attemptAnswers)
    .where(
      and(eq(attemptAnswers.attemptId, opts.attemptId), eq(attemptAnswers.questionId, opts.questionId))
    )
    .get();

  if (existing) {
    db.update(attemptAnswers)
      .set({ manualPoints: opts.points, feedbackMd: opts.feedbackMd ?? null, updatedAt: new Date() })
      .where(eq(attemptAnswers.id, existing.id))
      .run();
  } else {
    // El alumno dejó la pregunta sin responder: fila para registrar los puntos
    db.insert(attemptAnswers)
      .values({
        id: crypto.randomUUID(),
        attemptId: opts.attemptId,
        questionId: opts.questionId,
        manualPoints: opts.points,
        feedbackMd: opts.feedbackMd ?? null,
      })
      .run();
  }

  return finalizeIfComplete(attempt.id, opts.gradedBy);
}

function finalizeIfComplete(attemptId: string, gradedBy: string): { finalized: boolean } {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).get()!;
  if (attempt.status === "graded") return { finalized: true };

  const drawnIds = attempt.questionOrder ? new Set(attempt.questionOrder as string[]) : null;
  const openQuestions = db
    .select()
    .from(questions)
    .where(and(eq(questions.examItemId, attempt.examItemId), eq(questions.type, "open_text")))
    .all()
    .filter((q) => !drawnIds || drawnIds.has(q.id));

  const answers = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId))
    .all();
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));

  const allGraded = openQuestions.every(
    (q) => byQuestion.get(q.id)?.manualPoints !== null && byQuestion.get(q.id) !== undefined
  );
  if (!allGraded) return { finalized: false };

  const manualScore = openQuestions.reduce(
    (sum, q) => sum + (byQuestion.get(q.id)?.manualPoints ?? 0),
    0
  );
  const finalScore = (attempt.autoScore ?? 0) + manualScore;
  const now = new Date();

  db.update(examAttempts)
    .set({ manualScore, finalScore, status: "graded", gradedBy, gradedAt: now, updatedAt: now })
    .where(eq(examAttempts.id, attemptId))
    .run();

  // Notificar al alumno y evaluar reglas del curso
  const item = db.select().from(courseItems).where(eq(courseItems.id, attempt.examItemId)).get();
  if (item) {
    // Con resultados ocultos no se avisa: el aviso llega al publicarlos
    const exam = db.select().from(exams).where(eq(exams.itemId, item.id)).get();
    if (!exam || resultsVisible(exam, Date.now())) {
      notify(attempt.studentId, "grade_published", {
        courseId: item.courseId,
        itemId: item.id,
        itemTitle: item.title,
        attemptId,
      });
    }
    // El intento sabe a qué ciclo pertenece: calificar tarde uno de 2026 no
    // debe re-evaluar el ciclo 2027
    const enrollmentId =
      attempt.enrollmentId ??
      db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(eq(enrollments.courseId, item.courseId), eq(enrollments.studentId, attempt.studentId))
        )
        .get()?.id;
    if (enrollmentId) evaluateEnrollment(enrollmentId);
  }

  return { finalized: true };
}

// ─── Calificar tareas ────────────────────────────────────────────────────────

export function gradeSubmission(opts: {
  gradedBy: string;
  submissionId: string;
  score: number;
  feedbackMd?: string;
  action: "grade" | "return";
}) {
  const submission = db
    .select()
    .from(assignmentSubmissions)
    .where(eq(assignmentSubmissions.id, opts.submissionId))
    .get();
  if (!submission) throw new Error("Entrega no encontrada");

  const now = new Date();

  if (opts.action === "return") {
    db.update(assignmentSubmissions)
      .set({
        status: "returned",
        feedbackMd: opts.feedbackMd ?? null,
        gradedBy: opts.gradedBy,
        gradedAt: now,
        updatedAt: now,
      })
      .where(eq(assignmentSubmissions.id, opts.submissionId))
      .run();
    notify(submission.studentId, "submission_returned", {
      itemId: submission.itemId,
      submissionId: submission.id,
    });
    return;
  }

  db.update(assignmentSubmissions)
    .set({
      status: "graded",
      score: opts.score,
      feedbackMd: opts.feedbackMd ?? null,
      gradedBy: opts.gradedBy,
      gradedAt: now,
      updatedAt: now,
    })
    .where(eq(assignmentSubmissions.id, opts.submissionId))
    .run();

  notify(submission.studentId, "grade_published", {
    itemId: submission.itemId,
    submissionId: submission.id,
  });

  const item = db.select().from(courseItems).where(eq(courseItems.id, submission.itemId)).get();
  if (item) {
    const enrollmentId =
      submission.enrollmentId ??
      db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(eq(enrollments.courseId, item.courseId), eq(enrollments.studentId, submission.studentId))
        )
        .get()?.id;
    if (enrollmentId) evaluateEnrollment(enrollmentId);
  }
}
