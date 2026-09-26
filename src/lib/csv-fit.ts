import { isImageQuestionType } from "./image-questions";
import { categorizeCsvRepresentable, formatGroupsCsv, parseGroupsCsv, readCategorize, type CategorizeConfig } from "./categorize";
import { readCloze } from "./cloze";

/**
 * ¿Cabe la pregunta en el CSV/Excel de exámenes? Es el único criterio para
 * exportar (las que no caben se omiten y se cuentan), para «reemplazar» (se
 * conservan en su lugar) y para los avisos de los diálogos y del asistente.
 *
 * - Sobre imagen: nunca (la foto y las posiciones no se escriben en una celda).
 * - Clasificar en grupos: solo si todas sus tarjetas son de texto y la celda
 *   «grupos» vuelve igual (un «:» en el nombre de un grupo, o un «;» o «|» en
 *   un nombre o una tarjeta, la partiría distinto).
 * - Completar el texto: si está completa (sus distractores nunca llevan «|»).
 * - Lo demás: siempre.
 *
 * Acepta la config sin validar: se lee también de lo ya guardado. Una config
 * rota no cabe: al «reemplazar» se conserva en vez de perderse.
 */
export function csvRepresentable(q: { type: string; config?: unknown }): boolean {
  if (isImageQuestionType(q.type)) return false;
  if (q.type === "categorize") {
    const config = readCategorize({ config: q.config });
    if (!config || !categorizeCsvRepresentable(config)) return false;
    const back = parseGroupsCsv(formatGroupsCsv(config));
    return !("error" in back) && JSON.stringify(groupsShape(back)) === JSON.stringify(groupsShape(config));
  }
  if (q.type === "cloze") return readCloze({ config: q.config }) !== null;
  return true;
}

/** Cada grupo con su nombre y los textos de sus tarjetas, en orden: lo que la celda «grupos» tiene que conservar. */
function groupsShape(config: CategorizeConfig): [string, string[]][] {
  return config.groups.map((g) => [
    g.name.trim(),
    config.cards.filter((k) => k.groupId === g.id).map((k) => (k.text ?? "").trim()),
  ]);
}
