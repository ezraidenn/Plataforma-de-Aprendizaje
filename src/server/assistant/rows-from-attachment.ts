import "server-only";
import { readSheetRows } from "@/server/services/sheet-colors";
import { extractText } from "@/server/services/text-extract";
import { splitRosterChunks, interpretStudentsChunkWithRetry } from "@/server/services/ai-student-import";
import { normalizeStudentEmail, normalizeStudentName } from "@/lib/student-draft";
import type { ColorFamily } from "@/lib/attachment-summary";
import type { AiOpts } from "@/server/services/ai-client";

/**
 * Del archivo a las filas que revisará el usuario. Con una hoja de cálculo se
 * leen las columnas directamente (sin gastar tokens) y se puede filtrar por el
 * color con que están pintadas; con un documento de texto se trocea y lo lee la
 * IA, como en «Importar con IA».
 */

export type PersonRow = { fullName: string; email: string; group: string };
export type RowsResult = { rows: PersonRow[]; note: string };

export type Source = { bytes: Buffer; fileName: string } | { text: string };
export type RowsOpts = { sheet?: string; color?: ColorFamily; ai?: AiOpts };

const clean = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const NAME_WORDS = ["nombre", "alumno", "estudiante", "participante", "trabajador", "empleado"];
const EMAIL_WORDS = ["correo", "email", "e-mail", "mail"];
const GROUP_WORDS = ["grupo", "turno", "generacion", "equipo", "area", "departamento"];

/** Qué columna es cada cosa, por su encabezado. null = no parece una lista de personas. */
export function headerIndex(headers: string[]): { name: number; email: number; group: number } | null {
  const find = (words: string[]) => headers.findIndex((h) => words.some((w) => clean(h).includes(w)));
  const name = find(NAME_WORDS);
  const email = find(EMAIL_WORDS);
  if (name < 0 && email < 0) return null;
  return { name, email, group: find(GROUP_WORDS) };
}

export const MAX_PEOPLE_ROWS = 5_000;

export async function peopleRows(source: Source, opts: RowsOpts): Promise<RowsResult> {
  if ("text" in source) return fromText(source.text, opts);

  const sheets = await readSheetRows(source.bytes, source.fileName);
  if (sheets.length === 0) {
    const { text } = await extractText(source.bytes, source.fileName);
    return fromText(text, opts);
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

  const [header, ...body] = sheet.rows;
  const idx = headerIndex(header?.cells ?? []);
  if (!idx) {
    const { text } = await extractText(source.bytes, source.fileName);
    return fromText(text, opts);
  }

  let wanted = body;
  if (opts.color) {
    wanted = body.filter((r) => r.color === opts.color);
    if (wanted.length === 0) notes.push(`Ninguna fila está pintada de ${opts.color}.`);
  }

  const rows = wanted.slice(0, MAX_PEOPLE_ROWS).map((r) => ({
    fullName: normalizeStudentName(idx.name >= 0 ? (r.cells[idx.name] ?? "") : ""),
    email: normalizeStudentEmail(idx.email >= 0 ? (r.cells[idx.email] ?? "") : ""),
    group: idx.group >= 0 ? (r.cells[idx.group] ?? "").trim() : "",
  }));
  if (wanted.length > MAX_PEOPLE_ROWS) notes.push(`Solo tomé las primeras ${MAX_PEOPLE_ROWS} filas.`);
  return { rows, note: notes.join(" ") };
}

/** Documento o texto pegado: lo lee la IA por tramos (como «Importar con IA»). */
async function fromText(text: string, opts: RowsOpts): Promise<RowsResult> {
  if (!opts.ai) throw new Error("Este archivo necesita la IA para leerse y no hay clave configurada.");
  const chunks = splitRosterChunks(text);
  const rows: PersonRow[] = [];
  for (const chunk of chunks) {
    const drafts = await interpretStudentsChunkWithRetry(chunk, opts.ai);
    for (const d of drafts) {
      rows.push({
        fullName: normalizeStudentName(d.fullName),
        email: normalizeStudentEmail(d.email),
        group: d.group ?? "",
      });
      if (rows.length >= MAX_PEOPLE_ROWS) break;
    }
    if (rows.length >= MAX_PEOPLE_ROWS) break;
  }
  const note = opts.color ? "El filtro por color solo funciona con hojas de cálculo; tomé todas las filas." : "";
  return { rows, note };
}
