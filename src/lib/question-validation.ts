import { IMAGE_QUESTION_TYPES, imageClickProblem, imageDragProblem } from "./image-questions";
import { categorizeProblem } from "./categorize";
import { clozeProblem } from "./cloze";

/**
 * Validación de una pregunta, pura (sin BD): la usa el servicio al guardar y
 * el diálogo de IA para marcar lo que falta antes de importar. Los textos son
 * los mismos que ve el maestro en el editor.
 */
export type QuestionShape = {
  type:
    | "single_choice"
    | "multiple_choice"
    | "true_false"
    | "short_text"
    | "matching"
    | "ordering"
    | "open_text"
    | "image_drag"
    | "image_click"
    | "categorize"
    | "cloze";
  promptMd: string;
  points: number;
  config?: unknown;
  options?: { textMd: string; isCorrect: boolean }[];
  /** Foto de fondo de las preguntas sobre imagen (id de archivo). */
  imageFileId?: string | null;
};

/** null = válida; si no, el primer problema encontrado. */
export function questionProblem(input: QuestionShape): string | null {
  if (!input.promptMd.trim()) return "La pregunta necesita un enunciado";
  if (!(input.points > 0)) return "Los puntos deben ser mayores a cero";

  if (input.type === "single_choice" || input.type === "true_false") {
    const opts = input.options ?? [];
    if (opts.length < 2) return "Agrega al menos dos opciones";
    if (opts.filter((o) => o.isCorrect).length !== 1) return "Marca exactamente una opción correcta";
  }
  if (input.type === "multiple_choice") {
    const opts = input.options ?? [];
    if (opts.length < 2) return "Agrega al menos dos opciones";
    if (!opts.some((o) => o.isCorrect)) return "Marca al menos una opción correcta";
  }
  if (input.type === "short_text") {
    const accepted = (input.config as { accepted?: string[] } | undefined)?.accepted ?? [];
    if (accepted.filter((a) => a.trim()).length === 0) return "Agrega al menos una respuesta aceptada";
  }
  if (input.type === "matching") {
    const pairs = (input.config as { pairs?: { left: string; right: string }[] } | undefined)?.pairs ?? [];
    if (pairs.length < 2) return "Agrega al menos dos pares para relacionar";
  }
  if (input.type === "ordering") {
    const steps = (input.config as { steps?: string[] } | undefined)?.steps ?? [];
    const clean = steps.map((s) => s.trim());
    if (clean.length < 3) return "Agrega al menos tres pasos para ordenar";
    if (clean.length > 10) return "Usa como máximo diez pasos";
    if (clean.some((s) => !s)) return "Ningún paso puede quedar vacío";
    if (new Set(clean.map((s) => s.toLowerCase())).size !== clean.length) {
      return "Hay pasos repetidos: cada paso debe ser distinto";
    }
  }
  if (input.type === "image_drag") return imageDragProblem(input.config, !!input.imageFileId);
  if (input.type === "image_click") return imageClickProblem(input.config, !!input.imageFileId);
  if (input.type === "categorize") return categorizeProblem(input.config);
  if (input.type === "cloze") return clozeProblem(input.config);
  return null;
}

/**
 * Tipos que el CSV/Excel no puede escribir ni leer: exportar los omite (y los
 * cuenta) y «reemplazar» los conserva en su lugar.
 * TEMPORAL: «Clasificar en grupos» y «Completar el texto» están aquí solo hasta
 * que el CSV tenga sus columnas (tarea 6 del plan); entonces el criterio pasa a
 * ser por pregunta («cabe en el CSV»: clasificar solo si no tiene íconos).
 */
export const NOT_IN_CSV_TYPES = [...IMAGE_QUESTION_TYPES, "categorize", "cloze"] as const;
export type NotInCsvType = (typeof NOT_IN_CSV_TYPES)[number];
export function isNotInCsvType(t: string): t is NotInCsvType {
  return (NOT_IN_CSV_TYPES as readonly string[]).includes(t);
}
