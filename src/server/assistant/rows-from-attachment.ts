import "server-only";
import { readSheetRows } from "@/server/services/sheet-colors";
import { extractText } from "@/server/services/text-extract";
import { splitRosterChunks, interpretStudentsChunkWithRetry } from "@/server/services/ai-student-import";
import { interpretCoursesChunkWithRetry } from "@/server/services/ai-course-import";
import { normalizeStudentEmail, normalizeStudentName } from "@/lib/student-draft";
import type { ColorFamily } from "@/lib/attachment-summary";
import type { AiOpts } from "@/server/services/ai-client";

/**
 * Del archivo a las filas que revisará el usuario. Con una hoja de cálculo se
 * leen las columnas directamente (sin gastar tokens) y se puede filtrar por el
 * color con que están pintadas; con un documento de texto se trocea y lo lee la
 * IA, como en «Importar con IA». Lo mismo sirve para personas (`peopleRows`) y
 * para cursos (`courseRows`): solo cambian los encabezados que se buscan.
 */

export type PersonRow = { fullName: string; email: string; group: string };
export type RowsResult = { rows: PersonRow[]; note: string };

/** Lo que trae cada renglón de una lista de cursos; la vigencia se valida al armar la tabla. */
export type CourseRow = { title: string; description: string; validity: string };
export type CourseRowsResult = { rows: CourseRow[]; note: string };

export type Source = { bytes: Buffer; fileName: string } | { text: string };
export type RowsOpts = { sheet?: string; color?: ColorFamily; ai?: AiOpts };
export type CourseRowsOpts = { sheet?: string; ai?: AiOpts };

const clean = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const NAME_WORDS = ["nombre", "alumno", "estudiante", "participante", "trabajador", "empleado"];
const EMAIL_WORDS = ["correo", "email", "e-mail", "mail"];
const GROUP_WORDS = ["grupo", "turno", "generacion", "equipo", "area", "departamento"];

const TITLE_WORDS = ["titulo", "curso", "nombre del curso"];
const DESC_WORDS = ["descripcion", "detalle"];
const VALIDITY_WORDS = ["vigencia", "meses", "validez"];

/** Busca la primera columna cuyo encabezado contenga alguna de esas palabras. */
const finder = (headers: string[]) => (words: string[]) =>
  headers.findIndex((h) => words.some((w) => clean(h).includes(w)));

export type ColumnIndex = { name: number; email: number; group: number };
export type CourseColumnIndex = { title: number; description: number; validity: number };

/** Qué columna es cada cosa, por su encabezado. null = no parece una lista de personas. */
export function headerIndex(headers: string[]): ColumnIndex | null {
  const find = finder(headers);
  const name = find(NAME_WORDS);
  const email = find(EMAIL_WORDS);
  if (name < 0 && email < 0) return null;
  return { name, email, group: find(GROUP_WORDS) };
}

/** Igual, para una lista de cursos: sin columna de título no hay nada que crear. */
export function courseHeaderIndex(headers: string[]): CourseColumnIndex | null {
  const find = finder(headers);
  const title = find(TITLE_WORDS);
  if (title < 0) return null;
  return { title, description: find(DESC_WORDS), validity: find(VALIDITY_WORDS) };
}

/** Las listas reales traen título arriba («LISTA DE ASISTENCIA», la fecha…): el encabezado se busca un poco más abajo. */
const HEADER_SEARCH_ROWS = 8;

/** Cómo se lee una clase de lista: qué columnas busca, cómo arma la fila y quién la lee si no hay columnas. */
type RowSpec<I, R> = {
  indexOf: (headers: string[]) => I | null;
  fromCells: (cells: string[], idx: I) => R;
  /** Texto que no viene en columnas: lo lee la IA (o lanza si no hay clave). */
  viaAi: (text: string) => Promise<R[]>;
};

/** Primera fila que parece el encabezado; lo de arriba se descarta y lo de abajo son los datos. */
function findHeader<I>(rows: { cells: string[] }[], indexOf: (headers: string[]) => I | null): { at: number; idx: I } | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const idx = indexOf(rows[i]?.cells ?? []);
    if (idx) return { at: i, idx };
  }
  return null;
}

function personFrom(cells: string[], idx: ColumnIndex): PersonRow {
  return {
    fullName: normalizeStudentName(idx.name >= 0 ? (cells[idx.name] ?? "") : ""),
    email: normalizeStudentEmail(idx.email >= 0 ? (cells[idx.email] ?? "") : ""),
    group: idx.group >= 0 ? (cells[idx.group] ?? "").trim() : "",
  };
}

function courseFrom(cells: string[], idx: CourseColumnIndex): CourseRow {
  const at = (i: number) => (i >= 0 ? (cells[i] ?? "").replace(/\s+/g, " ").trim() : "");
  return { title: at(idx.title), description: at(idx.description), validity: at(idx.validity) };
}

export const MAX_PEOPLE_ROWS = 5_000;

/** Sin clave de IA no se puede leer un documento que no viene en columnas. */
const NEEDS_AI = "Este archivo necesita la IA para leerse y no hay clave configurada.";

export async function peopleRows(source: Source, opts: RowsOpts): Promise<RowsResult> {
  return readRows(source, opts, {
    indexOf: headerIndex,
    fromCells: personFrom,
    async viaAi(text) {
      if (!opts.ai) throw new Error(NEEDS_AI);
      const rows: PersonRow[] = [];
      for (const chunk of splitRosterChunks(text)) {
        for (const d of await interpretStudentsChunkWithRetry(chunk, opts.ai)) {
          rows.push({ fullName: normalizeStudentName(d.fullName), email: normalizeStudentEmail(d.email), group: d.group ?? "" });
          if (rows.length >= MAX_PEOPLE_ROWS) return rows;
        }
      }
      return rows;
    },
  });
}

export async function courseRows(source: Source, opts: CourseRowsOpts): Promise<CourseRowsResult> {
  return readRows(source, opts, {
    indexOf: courseHeaderIndex,
    fromCells: courseFrom,
    async viaAi(text) {
      if (!opts.ai) throw new Error(NEEDS_AI);
      const rows: CourseRow[] = [];
      for (const chunk of splitRosterChunks(text)) {
        for (const d of await interpretCoursesChunkWithRetry(chunk, opts.ai)) {
          rows.push({ title: d.title, description: d.description, validity: d.validityMonths === null ? "" : String(d.validityMonths) });
          if (rows.length >= MAX_PEOPLE_ROWS) return rows;
        }
      }
      return rows;
    },
  });
}

async function readRows<I, R>(
  source: Source,
  opts: { sheet?: string; color?: ColorFamily },
  spec: RowSpec<I, R>
): Promise<{ rows: R[]; note: string }> {
  if ("text" in source) return fromText(source.text, opts, spec);

  const sheets = await readSheetRows(source.bytes, source.fileName);
  if (sheets.length === 0) {
    const { text } = await extractText(source.bytes, source.fileName);
    return fromText(text, opts, spec);
  }

  const notes: string[] = [];
  let sheet = sheets[0];
  if (opts.sheet) {
    const wanted = sheets.find((s) => clean(s.name) === clean(opts.sheet!));
    if (wanted) sheet = wanted;
    else notes.push(`No encontré la hoja «${opts.sheet}»; usé «${sheet.name}».`);
  } else if (sheets.length > 1) {
    notes.push(`El archivo tiene ${sheets.length} hojas; usé «${sheet.name}».`);
  }

  const header = findHeader(sheet.rows, spec.indexOf);
  if (!header) {
    const { text } = await extractText(source.bytes, source.fileName);
    return fromText(text, opts, spec);
  }

  let wanted = sheet.rows.slice(header.at + 1);
  if (opts.color) {
    wanted = wanted.filter((r) => r.color === opts.color);
    if (wanted.length === 0) notes.push(`Ninguna fila está pintada de ${opts.color}.`);
  }

  const rows = wanted.slice(0, MAX_PEOPLE_ROWS).map((r) => spec.fromCells(r.cells, header.idx));
  if (wanted.length > MAX_PEOPLE_ROWS) notes.push(`Solo tomé las primeras ${MAX_PEOPLE_ROWS} filas.`);
  return { rows, note: notes.join(" ") };
}

const SEPARATORS = [",", ";", "\t"];

/** Una línea de texto en columnas, con comillas como en el CSV de la plantilla. */
function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim());
}

/**
 * Texto que ya viene en columnas (pegado de una hoja, o un CSV): se lee aquí
 * mismo, sin gastar IA. null = no parece una tabla de esa clase.
 */
function tableFromText<I, R>(text: string, spec: RowSpec<I, R>): R[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  for (const sep of SEPARATORS) {
    if (!lines.slice(0, HEADER_SEARCH_ROWS).some((l) => l.includes(sep))) continue;
    const rows = lines.map((l) => ({ cells: splitRow(l, sep) }));
    const header = findHeader(rows, spec.indexOf);
    if (!header || rows[header.at].cells.length < 2) continue;
    const body = rows.slice(header.at + 1, header.at + 1 + MAX_PEOPLE_ROWS);
    if (body.length === 0) continue;
    return body.map((r) => spec.fromCells(r.cells, header.idx));
  }
  return null;
}

/** Documento o texto pegado: en columnas se lee solo; si no, lo lee la IA por tramos. */
async function fromText<I, R>(
  text: string,
  opts: { color?: ColorFamily },
  spec: RowSpec<I, R>
): Promise<{ rows: R[]; note: string }> {
  const note = opts.color ? "El filtro por color solo funciona con hojas de cálculo; tomé todas las filas." : "";
  const table = tableFromText(text, spec);
  if (table) return { rows: table, note };
  return { rows: await spec.viaAi(text), note };
}
