/**
 * Los formatos de Excel que la plataforma sabe leer, reconocidos por sus
 * encabezados. Puro y compartido: sin base de datos ni importaciones de
 * servidor, para poder probarlo solo.
 *
 * Aquí vive también `normalizeHeader`, que `csv-core.ts` reexporta: el
 * reconocimiento y el parseo del CSV tienen que comparar los encabezados con
 * la MISMA regla, o un archivo que se reconoce no se podría leer después.
 */

export type ExcelFormat = "alumnos" | "cursos" | "matricula" | "lecciones" | "examen";

export const FORMAT_LABELS: Record<ExcelFormat, string> = {
  alumnos: "alumnos",
  cursos: "cursos",
  matricula: "matrícula",
  lecciones: "lecciones",
  examen: "examen",
};

/** Encabezados normalizados (minúsculas, sin acentos, _ por espacios). */
export function normalizeHeader(h: string): string {
  return (h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Columna → cómo puede venir escrita. Son los mismos alias que aceptan los
 * validadores (`bulk-roster`, `bulk-lessons`, `exam-csv`) más los encabezados
 * naturales de una lista hecha a mano («Nombre completo», «E-mail»).
 */
const ALIASES: Record<string, string[]> = {
  id: ["id"],
  nombre: ["nombre", "nombre_completo", "alumno", "estudiante"],
  correo: ["correo", "correo_electronico", "email", "e_mail", "mail"],
  accion: ["accion", "action"],
  titulo: ["titulo", "title"],
  descripcion: ["descripcion", "detalle"],
  vigencia: ["vigencia", "validez", "meses"],
  requerido: ["requerido", "obligatorio_para_completar"],
  secuencia: ["secuencia"],
  visible: ["visible"],
  segundos_minimos: ["segundos_minimos", "segundos", "seg_minimos"],
  tipo: ["tipo"],
  pregunta: ["pregunta", "enunciado"],
  puntos: ["puntos", "pts", "valor"],
  opcion_1: ["opcion_1", "opcion_a", "opcion1"],
};

/**
 * Qué formato es una fila de encabezados. El orden importa: la matrícula trae
 * «nombre» y «correo» igual que una lista de alumnos, y lo que la distingue es
 * la columna «accion», así que se comprueba antes.
 */
export function detectFormat(headers: string[]): ExcelFormat | null {
  const seen = new Set((headers ?? []).map(normalizeHeader).filter(Boolean));
  const found = new Set<string>();
  for (const [column, names] of Object.entries(ALIASES)) {
    if (names.some((n) => seen.has(n))) found.add(column);
  }
  const all = (...columns: string[]) => columns.every((c) => found.has(c));
  const some = (...columns: string[]) => columns.some((c) => found.has(c));

  if (all("id", "titulo") && some("requerido", "secuencia", "visible", "segundos_minimos")) return "lecciones";
  if (all("correo", "accion")) return "matricula";
  if (all("tipo", "pregunta") && some("puntos", "opcion_1")) return "examen";
  if (all("nombre", "correo")) return "alumnos";
  if (found.has("titulo") && some("descripcion", "vigencia") && !found.has("id")) return "cursos";
  return null;
}
