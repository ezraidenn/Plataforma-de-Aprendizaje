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
import {
  PRECISION_RADIUS,
  imageClickHits,
  parseClickAnswer,
  readImageClick,
  readImageDrag,
} from "@/lib/image-questions";
import type { ImageItemView, ReviewBoard, ReviewEntry, ReviewResult } from "@/components/student/types";

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
    case "image_drag": {
      const drag = readImageDrag(q);
      if (!drag) break;
      const c = drag.config;
      // Misma lectura de la respuesta que la calificación
      const placed = imageDragPlacement(c, ans?.answerText, attemptId, q.id);
      const views = new Map<string, ImageItemView>(c.elements.map(({ id, ...view }) => [id, view]));
      const zones = c.zones.map((z, i) => {
        const put = placed[i];
        return {
          x: z.x,
          y: z.y,
          correct: put === z.elementId,
          placed: put ? (views.get(put) ?? null) : null,
          // La config ya se validó: cada lugar apunta a un elemento que existe
          expected: views.get(z.elementId)!,
        };
      });
      if (placed.some((p) => p !== undefined)) {
        yourAnswer = `${zones.filter((z) => z.correct).length} de ${zones.length} lugares correctos`;
      }
      correctAnswer = "Mira la imagen con la solución";
      board = { kind: "drag", image: drag.image, aspect: c.aspect, iconSize: c.iconSize, zones };
      break;
    }
    case "image_click": {
      const click = readImageClick(q);
      if (!click) break;
      const c = click.config;
      const marks = parseClickAnswer(ans?.answerText, c.spots.length);
      // Mismo emparejamiento que la calificación: cada marca acredita un solo punto
      const hits = imageClickHits(c, marks);
      if (marks.length > 0) {
        yourAnswer = `${hits.filter(Boolean).length} de ${c.spots.length} puntos señalados`;
      }
      correctAnswer = "Mira la imagen con la solución";
      board = {
        kind: "click",
        image: click.image,
        aspect: c.aspect,
        radius: PRECISION_RADIUS[c.precision],
        spots: c.spots.map((s, i) => ({ x: s.x, y: s.y, hit: hits[i] })),
        marks,
      };
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
    ...(board ? { board } : {}),
  };
}
