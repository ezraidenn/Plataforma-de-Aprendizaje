import { questionProblem, type QuestionShape } from "./question-validation";
import type { ImageQuestionType } from "./image-questions";

/**
 * Pregunta interpretada (por la IA) que el maestro revisa antes de importar.
 * Puro: lo usan el servidor y el diálogo. Sin las preguntas sobre imagen:
 * necesitan foto y posiciones, y la IA no las crea.
 */
export type DraftType = Exclude<QuestionShape["type"], ImageQuestionType>;

export type QuestionDraft = {
  /** Id local (no es de la BD) */
  key: string;
  type: DraftType;
  prompt: string;
  points: number;
  /** single/multiple/true_false */
  options: { text: string; correct: boolean }[];
  /** short_text */
  accepted: string[];
  /** matching */
  pairs: { left: string; right: string }[];
  /** ordering, en el orden correcto */
  steps: string[];
  /** Avisos («no se indica la respuesta correcta», …) */
  issues: string[];
  /**
   * Archivo de donde salió (solo con varios archivos). Vive en el navegador para
   * revisar: no se guarda ni sale en el CSV (cleanDrafts lo descarta).
   */
  source?: string;
};

/** Etiquetas de cada tipo, iguales a las del editor. */
export const DRAFT_TYPE_LABEL: Record<DraftType, string> = {
  single_choice: "Opción única",
  multiple_choice: "Opción múltiple",
  true_false: "Verdadero/Falso",
  short_text: "Respuesta corta",
  matching: "Relacionar columnas",
  ordering: "Ordenar pasos",
  open_text: "Texto abierto",
};

/** Borrador → entrada del servicio (misma forma que el editor y el CSV). */
export function draftToInput(d: QuestionDraft): QuestionShape {
  const base = { type: d.type, promptMd: d.prompt.trim(), points: d.points };
  switch (d.type) {
    case "single_choice":
    case "multiple_choice":
    case "true_false":
      return {
        ...base,
        options: d.options
          .filter((o) => o.text.trim())
          .map((o) => ({ textMd: o.text.trim(), isCorrect: o.correct })),
      };
    case "short_text":
      return { ...base, config: { accepted: d.accepted.map((a) => a.trim()).filter(Boolean) } };
    case "matching":
      return {
        ...base,
        config: {
          pairs: d.pairs
            .filter((p) => p.left.trim() && p.right.trim())
            .map((p) => ({ left: p.left.trim(), right: p.right.trim() })),
        },
      };
    case "ordering":
      return { ...base, config: { steps: d.steps.map((s) => s.trim()).filter(Boolean) } };
    default:
      return base;
  }
}

/** El problema que impide importar este borrador, o null. */
export const draftProblem = (d: QuestionDraft): string | null => questionProblem(draftToInput(d));
