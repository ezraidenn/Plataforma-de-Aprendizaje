import { isImageQuestionType } from "./image-questions";
import { categorizeCsvRepresentable, formatGroupsCsv, parseGroupsCsv, readCategorize, type CategorizeConfig } from "./categorize";
import { readCloze } from "./cloze";

/**
 * Las preguntas que no caben en el CSV/Excel de exámenes, en palabras: la
 * regla de `csvRepresentable`. La usan todos los avisos (el diálogo del CSV,
 * las notas del Excel y el asistente), para que digan lo mismo. Va tras «las
 * preguntas…», «es…» o «son…».
 */
export const NOT_IN_CSV_RULE =
  "sobre imagen, o de clasificar con tarjetas de ícono, con «:» en el nombre de un grupo, con «;» en una tarjeta o con «|» en un grupo o una tarjeta";

/**
 * ¿Se puede escribir la pregunta en el CSV, aunque no vuelva igual o no
 * valide? No: las preguntas sobre imagen (la foto y las posiciones no se
 * escriben en una celda) y las de clasificar con alguna tarjeta de ícono. Lo
 * usa «Descargar como CSV» de la IA, que escribe también los borradores a
 * medio corregir: al volver a subirlos, su fila dice qué falta.
 *
 * Acepta la config sin validar.
 */
export function csvWritable(q: { type: string; config?: unknown }): boolean {
  if (isImageQuestionType(q.type)) return false;
  if (q.type === "categorize") {
    const cards = (q.config as { cards?: unknown } | null | undefined)?.cards;
    return !Array.isArray(cards) || !cards.some((k) => (k as { kind?: unknown } | null)?.kind === "icon");
  }
  return true;
}

/**
 * ¿Cabe la pregunta en el CSV/Excel de exámenes (se escribe y vuelve igual)?
 * Es el único criterio para exportar el examen (las que no caben se omiten y
 * se cuentan), para «reemplazar» (se conservan en su lugar) y para los avisos
 * de los diálogos y del asistente (`NOT_IN_CSV_RULE`).
 *
 * - Sobre imagen: nunca (ver `csvWritable`).
 * - Clasificar en grupos: solo si todas sus tarjetas son de texto y la celda
 *   «grupos» vuelve igual (un «:» en el nombre de un grupo, un «;» en una
 *   tarjeta o un «|» en cualquiera de los dos la partiría distinto).
 * - Completar el texto: si está completa (sus distractores nunca llevan «|»).
 * - Lo demás: siempre.
 *
 * Acepta la config sin validar: se lee también de lo ya guardado. Una config
 * rota no cabe: al «reemplazar» se conserva en vez de perderse.
 */
export function csvRepresentable(q: { type: string; config?: unknown }): boolean {
  if (!csvWritable(q)) return false;
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
