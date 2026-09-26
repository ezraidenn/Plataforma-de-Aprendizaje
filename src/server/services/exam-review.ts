import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { attemptAnswers } from "@/server/db/schema";
import { listQuestions, type ExamAttempt, type Question, type QuestionOption } from "./exams";
import { categorizePlacement, clozePlacement, imageDragPlacement, matchingToken, orderingToken } from "./exam-answers";
import { parseClickAnswer, readImageClick, readImageDrag } from "@/lib/image-questions";
import { clickReviewBoard, dragReviewBoard, type ReviewBoard } from "@/lib/image-boards";
import type { AnswerBoard } from "@/lib/answer-boards";
import { categorizeBoard, categorizeHits, categorizeSolutionText, readCategorize } from "@/lib/categorize";
import { clozeBoard, clozeHits, clozeSolutionText, readCloze } from "@/lib/cloze";
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

type BoardQuestion = Pick<Question, "id" | "type" | "config">;

/**
 * Respuesta a clasificar o completar, leída igual que al calificar: el resumen
 * en texto, la solución en texto y el tablero. null si la pregunta no se puede
 * mostrar (incompleta) o es de otro tipo.
 */
function boardAnswer(
  q: BoardQuestion,
  answerText: string | null | undefined,
  attemptId: string
): { summary: string; solution: string; board: AnswerBoard } | null {
  const cat = q.type === "categorize" ? readCategorize(q) : null;
  if (cat) {
    const placed = categorizePlacement(cat, answerText, attemptId, q.id);
    const hits = categorizeHits(cat, placed);
    return {
      summary: Object.keys(placed).length > 0 ? `${hits.filter(Boolean).length} de ${hits.length} tarjetas bien` : NO_ANSWER,
      solution: categorizeSolutionText(cat),
      board: categorizeBoard(cat, placed),
    };
  }
  const cloze = q.type === "cloze" ? readCloze(q) : null;
  if (cloze) {
    const given = clozePlacement(cloze, answerText, attemptId, q.id);
    const hits = clozeHits(cloze, given);
    return {
      summary: given.some((g) => g !== undefined) ? `${hits.filter(Boolean).length} de ${hits.length} huecos bien` : NO_ANSWER,
      solution: clozeSolutionText(cloze),
      board: clozeBoard(cloze, given),
    };
  }
  return null;
}

/**
 * Resumen de la respuesta a clasificar o completar: «N de M tarjetas bien»,
 * «N de M huecos bien» o «Sin respuesta». Lo leen igual el alumno en su
 * revisión y el maestro al calificar.
 */
export function boardAnswerSummary(q: BoardQuestion, answerText: string | null | undefined, attemptId: string): string {
  return boardAnswer(q, answerText, attemptId)?.summary ?? NO_ANSWER;
}

/**
 * «Completar» en modo escribir: lo que escribió el alumno en cada hueco, en
 * corto («1: París · 2: roma · 3: —»), para el maestro al calificar (como en
 * respuesta corta, que ve lo escrito). Leído igual que al calificar. null en
 * otro modo, sin nada escrito o si la pregunta no se puede mostrar.
 */
export function clozeWrittenText(q: BoardQuestion, answerText: string | null | undefined, attemptId: string): string | null {
  const cloze = q.type === "cloze" ? readCloze(q) : null;
  if (!cloze || cloze.mode !== "write") return null;
  const given = clozePlacement(cloze, answerText, attemptId, q.id);
  if (!given.some((g) => g !== undefined)) return null;
  return given.map((g, i) => `${i + 1}: ${g ?? "—"}`).join(" · ");
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
  let answerBoard: AnswerBoard | undefined;

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
    case "categorize":
    case "cloze": {
      // Como las de imagen: una pregunta incompleta queda sin tablero y en «Sin respuesta»
      const answer = boardAnswer(q, ans?.answerText, attemptId);
      if (!answer) break;
      yourAnswer = answer.summary;
      correctAnswer = answer.solution;
      answerBoard = answer.board;
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
    ...(answerBoard ? { answerBoard } : {}),
  };
}
