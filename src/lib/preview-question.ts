import type { RunnerQuestion } from "@/components/student/types";
import type { QuestionDraft } from "./question-draft";
import { shuffledOrder } from "./ordering";

/**
 * Pregunta de la vista previa «Ver como alumno»: lo mismo que recibe el
 * alumno (RunnerQuestion) más el texto de la respuesta correcta, que solo ve
 * el maestro al encender «Mostrar respuestas correctas». Todo es local: los
 * tokens no son los del servidor y nada se califica.
 */
export type PreviewQuestion = RunnerQuestion & {
  /** Respuesta correcta en texto; null en las abiertas */
  answerText: string | null;
};

function shuffle<T>(items: T[]): T[] {
  return shuffledOrder(items.length).map((i) => items[i]);
}

/** Borrador → pregunta de vista previa, revuelta como la ve el alumno. */
export function draftToPreview(d: QuestionDraft): PreviewQuestion {
  const withOptions = d.type === "single_choice" || d.type === "multiple_choice" || d.type === "true_false";
  const correct = d.options.filter((o) => o.correct).map((o) => o.text);
  const answerText =
    withOptions
      ? correct.join(" · ") || null
      : d.type === "short_text"
        ? d.accepted.join(" · ") || null
        : d.type === "matching"
          ? d.pairs.map((p) => `${p.left} → ${p.right}`).join(" · ") || null
          : d.type === "ordering"
            ? d.steps.map((s, i) => `${i + 1}. ${s}`).join(" · ") || null
            : null;

  return {
    id: d.key,
    type: d.type,
    promptMd: d.prompt,
    points: d.points,
    options: withOptions ? d.options.map((o, i) => ({ id: `${d.key}-o${i}`, text: o.text })) : [],
    matching:
      d.type === "matching"
        ? {
            lefts: d.pairs.map((p) => p.left),
            rights: shuffle(d.pairs.map((p, i) => ({ token: `${d.key}-r${i}`, text: p.right }))),
          }
        : null,
    ordering:
      d.type === "ordering"
        ? { steps: shuffledOrder(d.steps.length).map((i) => ({ token: `${d.key}-s${i}`, text: d.steps[i] })) }
        : null,
    answerText,
  };
}

/** Pregunta guardada en la BD → borrador (para «Ver como alumno» del examen actual). */
export function questionToDraft(q: {
  id: string;
  type: QuestionDraft["type"];
  promptMd: string;
  points: number;
  config: unknown;
  options: { textMd: string; isCorrect: boolean }[];
}): QuestionDraft {
  const config = (q.config ?? {}) as { accepted?: string[]; pairs?: { left: string; right: string }[]; steps?: string[] };
  return {
    key: q.id,
    type: q.type,
    prompt: q.promptMd,
    points: q.points,
    options: q.options.map((o) => ({ text: o.textMd, correct: o.isCorrect })),
    accepted: Array.isArray(config.accepted) ? config.accepted : [],
    pairs: Array.isArray(config.pairs) ? config.pairs : [],
    steps: Array.isArray(config.steps) ? config.steps : [],
    issues: [],
  };
}
