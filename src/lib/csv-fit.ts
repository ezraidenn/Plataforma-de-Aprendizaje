import { isImageQuestionType } from "./image-questions";

/**
 * ¿Cabe la pregunta en el CSV/Excel de exámenes? Es el único criterio para
 * exportar (las que no caben se omiten y se cuentan), para «reemplazar» (se
 * conservan en su lugar) y para los avisos de los diálogos y del asistente.
 *
 * - Sobre imagen: nunca (la foto y las posiciones no se escriben en una celda).
 * - Clasificar en grupos: solo si todas sus tarjetas son de texto.
 * - Lo demás (completar incluido): siempre.
 *
 * Acepta la config sin validar: se lee también de lo ya guardado.
 */
export function csvRepresentable(q: { type: string; config?: unknown }): boolean {
  if (isImageQuestionType(q.type)) return false;
  if (q.type === "categorize") {
    const cards = (q.config as { cards?: unknown } | null | undefined)?.cards;
    return Array.isArray(cards) && cards.every((k) => (k as { kind?: unknown } | null)?.kind === "text");
  }
  return true;
}
