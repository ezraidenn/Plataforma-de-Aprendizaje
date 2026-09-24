"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { examAttempts } from "@/server/db/schema";
import { requireStudent } from "@/server/auth/guards";
import {
  getExam,
  listAttempts,
  startAttempt,
  saveAnswer,
  submitAttempt,
} from "@/server/services/exams";
import { buildReview } from "@/server/services/exam-review";
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
