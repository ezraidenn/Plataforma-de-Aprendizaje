import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { attemptAnswers } from "@/server/db/schema";
import {
  imageDragPlacement,
  listQuestions,
  matchingToken,
  orderingToken,
  type ExamAttempt,
  type Question,
  type QuestionOption,
} from "./exams";
import { parseClickAnswer, readImageClick, readImageDrag } from "@/lib/image-questions";
import { clickReviewBoard, dragReviewBoard, type ReviewBoard } from "@/lib/image-boards";
import type { ReviewEntry, ReviewResult } from "@/components/student/types";

/**
 * Desglose por pregunta de un intento calificado. Lleva la solución: quien lo
 * llama decide si el alumno ya puede verlo (regla de resultados visibles).
 * Vive fuera de las acciones para poder probarlo desde los smokes.
 */

type FullQuestion = Question & { options: QuestionOption[] };
type AnswerRow = typeof attemptAnswers.$inferSelect;

export function buildReview(attempt: ExamAttempt): ReviewEntry[] {
  const qs = listQuestions(attempt.examItemId);
  const byId = new Map(qs.map((q) => [q.id, q]));
  const answers = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attempt.id))
    .all();
  const ansByQ = new Map(answers.map((a) => [a.questionId, a]));

  // Se recorre una COPIA del sorteo, sin mutar attempt.questionOrder y sin
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

/** Lo que se lee cuando el alumno no contestó (o nada de lo que mandó cuenta). */
export const NO_ANSWER = "Sin respuesta";

type ImageQuestion = Pick<Question, "id" | "type" | "imageFileId" | "config">;

/**
 * Respuesta a una pregunta sobre imagen, leída igual que al calificar: el
 * resumen en texto y el tablero para dibujarla. Una pregunta que no se puede
 * mostrar (incompleta) queda sin tablero y en «Sin respuesta».
 */
function imageAnswer(
  q: ImageQuestion,
  answerText: string | null | undefined,
  attemptId: string
): { summary: string; board: ReviewBoard | null } {
  const drag = q.type === "image_drag" ? readImageDrag(q) : null;
  if (drag) {
    // Misma lectura de la respuesta que la calificación
    const placed = imageDragPlacement(drag.config, answerText, attemptId, q.id);
    const board = dragReviewBoard(drag.image, drag.config, placed);
    const summary = placed.some((p) => p !== undefined)
      ? `${board.zones.filter((z) => z.correct).length} de ${board.zones.length} lugares correctos`
      : NO_ANSWER;
    return { summary, board };
  }
  const click = q.type === "image_click" ? readImageClick(q) : null;
  if (click) {
    const marks = parseClickAnswer(answerText, click.config.spots.length);
    // Mismo emparejamiento que la calificación: cada marca acredita un solo punto
    const board = clickReviewBoard(click.image, click.config, marks);
    const summary =
      marks.length > 0 ? `${board.spots.filter((s) => s.hit).length} de ${board.spots.length} puntos señalados` : NO_ANSWER;
    return { summary, board };
  }
  return { summary: NO_ANSWER, board: null };
}

/**
 * Resumen de la respuesta a una pregunta sobre imagen: «N de M lugares
 * correctos», «N de M puntos señalados» o «Sin respuesta». Lo leen igual el
 * alumno en su revisión y el maestro al calificar.
 */
export function imageAnswerSummary(q: ImageQuestion, answerText: string | null | undefined, attemptId: string): string {
  return imageAnswer(q, answerText, attemptId).summary;
}

function selectedText(q: FullQuestion, ids: string[] | null): string {
  if (!ids || ids.length === 0) return NO_ANSWER;
  return ids
    .map((id) => q.options.find((o) => o.id === id)?.textMd ?? "—")
    .join(", ");
}

function reviewEntry(q: FullQuestion, ans: AnswerRow | null, attemptId: string): ReviewEntry {
  let yourAnswer = NO_ANSWER;
  let correctAnswer: string | null = null;
  let board: ReviewBoard | undefined;

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
      yourAnswer = ans?.answerText?.trim() || NO_ANSWER;
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
          : NO_ANSWER;
      correctAnswer = steps.map((st, i) => `${i + 1}. ${st}`).join(" · ");
      break;
    }
    case "image_drag":
    case "image_click": {
      const image = imageAnswer(q, ans?.answerText, attemptId);
      if (!image.board) break;
      yourAnswer = image.summary;
      correctAnswer = "Mira la imagen con la solución";
      board = image.board;
      break;
    }
    case "open_text": {
      yourAnswer = ans?.answerText?.trim() || NO_ANSWER;
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
    ...(board ? { board } : {}),
  };
}
