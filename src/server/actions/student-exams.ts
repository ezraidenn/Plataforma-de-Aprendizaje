"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { attemptAnswers, examAttempts } from "@/server/db/schema";
import { requireStudent } from "@/server/auth/guards";
import {
  getExam,
  listQuestions,
  listAttempts,
  matchingToken,
  orderingToken,
  startAttempt,
  saveAnswer,
  submitAttempt,
  type ExamAttempt,
  type Question,
  type QuestionOption,
} from "@/server/services/exams";
import { getEnrollment } from "@/server/services/progress";
import { resultsVisible } from "@/lib/exam-results";
import { getItem } from "@/server/services/tree";
import {
  attemptToDto,
  answersForAttempt,
  buildRunnerQuestions,
} from "@/components/student/lesson-data";
import type {
  AttemptDto,
  ReviewEntry,
  ReviewResult,
  RunnerQuestion,
  SavedAnswer,
} from "@/components/student/types";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function validExamItem(courseId: string, itemId: string): boolean {
  const item = getItem(itemId);
  return !!item && item.courseId === courseId && item.kind === "exam";
}

// ─── Iniciar / retomar intento ───────────────────────────────────────────────

export type StartAttemptResult =
  | {
      ok: true;
      attempt: AttemptDto;
      answers: SavedAnswer[];
      /** Preguntas del intento (solo las sorteadas, en su orden). */
      questions: RunnerQuestion[];
      /** Intentos ya consumidos, fresco del servidor. */
      attemptsUsed: number;
      serverNowMs: number;
    }
  | { error: string };

function finishedAttempts(itemId: string, studentId: string): number {
  return listAttempts(itemId, studentId).filter((a) => a.status !== "in_progress").length;
}

export async function startAttemptAction(input: {
  courseId: string;
  itemId: string;
}): Promise<StartAttemptResult> {
  const user = await requireStudent();
  if (!validExamItem(input.courseId, input.itemId)) {
    return { error: "Examen no encontrado" };
  }
  try {
    const attempt = startAttempt({
      courseId: input.courseId,
      studentId: user.id,
      examItemId: input.itemId,
    });
    return {
      ok: true,
      attempt: attemptToDto(attempt),
      answers: answersForAttempt(attempt.id),
      questions: buildRunnerQuestions(attempt),
      attemptsUsed: finishedAttempts(input.itemId, user.id),
      serverNowMs: Date.now(),
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo iniciar el intento. Intenta de nuevo.") };
  }
}

// ─── Autosave de respuesta ───────────────────────────────────────────────────

export type SaveAnswerResult = { ok: true } | { error: string };

export async function saveAnswerAction(input: {
  attemptId: string;
  questionId: string;
  selectedOptionIds?: string[];
  answerText?: string;
}): Promise<SaveAnswerResult> {
  const user = await requireStudent();
  try {
    saveAnswer({
      studentId: user.id,
      attemptId: input.attemptId,
      questionId: input.questionId,
      selectedOptionIds: input.selectedOptionIds,
      answerText: input.answerText,
    });
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo guardar tu respuesta.") };
  }
}

// ─── Enviar intento ──────────────────────────────────────────────────────────

export type SubmitAttemptResult =
  | {
      ok: true;
      attempt: AttemptDto;
      /** % del intento recién calificado (null si quedó en revisión). */
      scorePercent: number | null;
      /** true = con este envío el enrollment PASÓ a completed (no si ya lo estaba). */
      courseCompleted: boolean;
      /** Desglose por pregunta; solo con resultados visibles y el intento calificado. */
      review: ReviewEntry[] | null;
      /** El alumno ya puede ver su calificación en este examen. */
      resultsVisible: boolean;
      /** Intentos ya consumidos, fresco del servidor (incluye este envío). */
      attemptsUsed: number;
      serverNowMs: number;
    }
  | { error: string };

export async function submitAttemptAction(input: {
  courseId: string;
  itemId: string;
  attemptId: string;
  /** true solo para el autoenvío del timer (acepta el margen de gracia). */
  auto?: boolean;
}): Promise<SubmitAttemptResult> {
  const user = await requireStudent();
  if (!validExamItem(input.courseId, input.itemId)) {
    return { error: "Examen no encontrado" };
  }
  try {
    // B9: validar que el intento corresponde al examen ANTES de enviarlo
    const existing = db
      .select()
      .from(examAttempts)
      .where(eq(examAttempts.id, input.attemptId))
      .get();
    if (!existing || existing.studentId !== user.id || existing.examItemId !== input.itemId) {
      return { error: "Intento no encontrado" };
    }

    // M1: capturar el estado del enrollment ANTES del envío para avisar
    // "¡Aprobaste el curso!" solo cuando este envío lo completa.
    const wasCompleted = getEnrollment(input.courseId, user.id)?.status === "completed";

    const attempt = submitAttempt({
      courseId: input.courseId,
      studentId: user.id,
      attemptId: input.attemptId,
      auto: input.auto,
    });

    const exam = getExam(input.itemId);
    const nowCompleted = getEnrollment(input.courseId, user.id)?.status === "completed";
    const courseCompleted = !wasCompleted && nowCompleted;

    // El % y el desglose solo viajan cuando el alumno ya puede ver sus
    // resultados (que la respuesta de red no revele lo que la UI oculta).
    const visible = exam ? resultsVisible(exam, Date.now()) : false;
    const showNow = visible && attempt.status === "graded";
    const scorePercent =
      showNow && attempt.finalScore !== null && attempt.maxScoreSnapshot
        ? Math.round((attempt.finalScore / attempt.maxScoreSnapshot) * 1000) / 10
        : null;
    const review = showNow ? buildReview(attempt) : null;

    revalidatePath(`/courses/${input.courseId}`);
    revalidatePath("/dashboard");

    return {
      ok: true,
      attempt: attemptToDto(attempt),
      scorePercent,
      courseCompleted,
      review,
      resultsVisible: visible,
      attemptsUsed: finishedAttempts(input.itemId, user.id),
      serverNowMs: Date.now(),
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo enviar el examen. Intenta de nuevo.") };
  }
}

// ─── Desglose por pregunta (solo tras calificar, nunca antes) ────────────────

type FullQuestion = Question & { options: QuestionOption[] };
type AnswerRow = typeof attemptAnswers.$inferSelect;

function buildReview(attempt: ExamAttempt): ReviewEntry[] {
  const qs = listQuestions(attempt.examItemId);
  const byId = new Map(qs.map((q) => [q.id, q]));
  const answers = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attempt.id))
    .all();
  const ansByQ = new Map(answers.map((a) => [a.questionId, a]));

  // A4: iterar una COPIA del sorteo, sin mutar attempt.questionOrder y sin
  // anexar preguntas del banco que no cayeron en este intento.
  const order = [...((attempt.questionOrder as string[] | null) ?? qs.map((q) => q.id))];

  const entries: ReviewEntry[] = [];
  for (const qid of order) {
    const q = byId.get(qid);
    if (!q) continue;
    entries.push(reviewEntry(q, ansByQ.get(qid) ?? null, attempt.id));
  }
  return entries;
}

function selectedText(q: FullQuestion, ids: string[] | null): string {
  if (!ids || ids.length === 0) return "Sin respuesta";
  return ids
    .map((id) => q.options.find((o) => o.id === id)?.textMd ?? "—")
    .join(", ");
}

function reviewEntry(q: FullQuestion, ans: AnswerRow | null, attemptId: string): ReviewEntry {
  let yourAnswer = "Sin respuesta";
  let correctAnswer: string | null = null;

  switch (q.type) {
    case "single_choice":
    case "multiple_choice":
    case "true_false": {
      yourAnswer = selectedText(q, (ans?.selectedOptionIds as string[] | null) ?? null);
      correctAnswer = q.options
        .filter((o) => o.isCorrect)
        .map((o) => o.textMd)
        .join(", ");
      break;
    }
    case "short_text": {
      yourAnswer = ans?.answerText?.trim() || "Sin respuesta";
      const accepted = (q.config as { accepted?: string[] } | null)?.accepted ?? [];
      correctAnswer = accepted.filter((a) => a.trim()).join(" · ");
      break;
    }
    case "matching": {
      const pairs =
        (q.config as { pairs?: { left: string; right: string }[] } | null)?.pairs ?? [];
      let map: Record<string, unknown> = {};
      try {
        map = JSON.parse(ans?.answerText ?? "{}") as Record<string, unknown>;
      } catch {
        map = {};
      }
      // El valor puede ser un token opaco (nuevo) o un índice (intentos viejos):
      // en ambos casos se muestra el TEXTO de la derecha elegida, nunca índices.
      const rightText = (v: unknown): string => {
        if (typeof v === "number") return pairs[v]?.right ?? "—";
        if (typeof v === "string") {
          const j = pairs.findIndex((_, k) => matchingToken(attemptId, q.id, k) === v);
          return j >= 0 ? pairs[j].right : "—";
        }
        return "—";
      };
      yourAnswer = pairs
        .map((p, i) => `${p.left} → ${rightText(map[String(i)])}`)
        .join(" · ");
      correctAnswer = pairs.map((p) => `${p.left} → ${p.right}`).join(" · ");
      break;
    }
    case "ordering": {
      const steps = (q.config as { steps?: string[] } | null)?.steps ?? [];
      let tokens: unknown = [];
      try {
        tokens = JSON.parse(ans?.answerText ?? "[]");
      } catch {
        tokens = [];
      }
      const textOf = (t: unknown): string => {
        const i = steps.findIndex((_, k) => orderingToken(attemptId, q.id, k) === t);
        return i >= 0 ? steps[i] : "—";
      };
      yourAnswer =
        Array.isArray(tokens) && tokens.length > 0
          ? tokens.map((t, i) => `${i + 1}. ${textOf(t)}`).join(" · ")
          : "Sin respuesta";
      correctAnswer = steps.map((st, i) => `${i + 1}. ${st}`).join(" · ");
      break;
    }
    case "open_text": {
      yourAnswer = ans?.answerText?.trim() || "Sin respuesta";
      correctAnswer = null;
      break;
    }
  }

  let earnedPoints: number | null;
  let result: ReviewResult;
  if (q.type === "open_text") {
    earnedPoints = null;
    result = "pending";
  } else {
    earnedPoints = ans?.autoPoints ?? 0;
    result =
      earnedPoints >= q.points - 1e-6
        ? "correct"
        : earnedPoints > 0
          ? "partial"
          : "incorrect";
  }

  return {
    questionId: q.id,
    promptMd: q.promptMd,
    points: q.points,
    earnedPoints,
    result,
    yourAnswer,
    correctAnswer,
  };
}
