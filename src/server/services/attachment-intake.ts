import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { aiAttachments, aiConversations, files } from "@/server/db/schema";
import { extractText, formatOf, ScannedPdfError } from "./text-extract";
import { readSheetRows, type SheetData } from "./sheet-colors";
import { readFileBytes } from "./storage";
import type { AttachmentSummary, ColorFamily, SheetSummary } from "@/lib/attachment-summary";

/**
 * Un archivo adjunto al asistente: se lee en el servidor, se resume (lo único
 * que verá la IA) y el resumen se guarda con la conversación. El texto y las
 * filas completas se vuelven a sacar del archivo cuando una herramienta los
 * necesita: no viajan al modelo ni se guardan duplicados.
 */

const SAMPLE_ROWS = 5;

/**
 * Columnas vacías del final: LibreOffice rellena la tabla hasta la última
 * columna usada de la hoja, así que una lista de dos columnas puede llegar con
 * celdas vacías a la derecha. Solo se recorta lo que ve la IA.
 */
function trimRight(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1].trim() === "") end--;
  return cells.slice(0, end);
}

/** Resumen de un archivo ya leído (sin tocar la base). */
export async function summarizeAttachment(bytes: Buffer, fileName: string): Promise<AttachmentSummary> {
  const format = formatOf(fileName);
  // Un CSV de alumnos también es una hoja: LibreOffice lo abre igual, así que
  // se ven sus columnas. Si no se pudo leer así (sin LibreOffice), sigue por la
  // rama de documento como cualquier texto.
  const isCsv = fileName.toLowerCase().endsWith(".csv");

  if (format === "sheet" || isCsv) {
    const sheets = await readSheetRows(bytes, fileName).catch((err: unknown) => {
      if (isCsv) return [] as SheetData[];
      throw err;
    });
    if (sheets.length > 0) return sheetSummary(fileName, sheets);
  }

  if (format === null) return { fileName, kind: "image", sheets: [], chars: 0 };

  try {
    const { text } = await extractText(bytes, fileName);
    return { fileName, kind: "doc", sheets: [], chars: text.length };
  } catch (err) {
    // Un PDF escaneado se admite: la herramienta lo leerá como imagen. Se
    // guardan sus páginas para poder decir de qué tamaño es sin volver a abrirlo
    if (err instanceof ScannedPdfError) return { fileName, kind: "image", sheets: [], chars: 0, pages: err.pages };
    throw err;
  }
}

/** Hojas ya leídas → resumen: encabezados, muestra y colores de cada una. */
function sheetSummary(fileName: string, sheets: SheetData[]): AttachmentSummary {
  const summarized: SheetSummary[] = sheets.map((sheet) => {
    const [header, ...rows] = sheet.rows;
    const colors: Partial<Record<ColorFamily, number>> = {};
    for (const row of rows) if (row.color) colors[row.color] = (colors[row.color] ?? 0) + 1;
    return {
      name: sheet.name,
      rowCount: rows.length,
      headers: trimRight(header?.cells ?? []),
      sample: rows.slice(0, SAMPLE_ROWS).map((r) => trimRight(r.cells)),
      colors,
    };
  });
  const chars = sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.cells.join("").length, 0), 0);
  return { fileName, kind: "sheet", sheets: summarized, chars };
}

/** Guarda el adjunto en la conversación y devuelve su id y resumen. */
export async function attachToConversation(opts: {
  conversationId: string;
  fileId: string;
  userId: string;
}): Promise<{ id: string; summary: AttachmentSummary }> {
  const file = db
    .select({ id: files.id, name: files.originalName, uploadedBy: files.uploadedBy })
    .from(files)
    .where(eq(files.id, opts.fileId))
    .get();
  if (!file || file.uploadedBy !== opts.userId) throw new Error("No encontramos ese archivo.");
  const owns = db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, opts.conversationId), eq(aiConversations.userId, opts.userId)))
    .get();
  if (!owns) throw new Error("No encontramos esa conversación.");

  const bytes = await readFileBytes(opts.fileId);
  const summary = await summarizeAttachment(bytes, file.name);
  const id = nanoid();
  db.insert(aiAttachments).values({ id, conversationId: opts.conversationId, fileId: file.id, summary }).run();
  return { id, summary };
}

export type StoredAttachment = { id: string; fileId: string | null; summary: AttachmentSummary };

/**
 * Adjuntos de la conversación (todos, o los que se pidan por id), del más
 * viejo al más nuevo: quien pida el último tiene que poder fiarse del orden.
 */
export function attachmentsOf(conversationId: string, ids?: string[]): StoredAttachment[] {
  const rows = db
    .select({ id: aiAttachments.id, fileId: aiAttachments.fileId, summary: aiAttachments.summary })
    .from(aiAttachments)
    .where(
      ids?.length
        ? and(eq(aiAttachments.conversationId, conversationId), inArray(aiAttachments.id, ids))
        : eq(aiAttachments.conversationId, conversationId)
    )
    .orderBy(asc(aiAttachments.createdAt))
    .all();
  return rows.map((r) => ({ id: r.id, fileId: r.fileId, summary: r.summary as AttachmentSummary }));
}

/** Bytes del archivo de un adjunto, para procesarlo completo. */
export async function attachmentBytes(attachment: StoredAttachment): Promise<{ bytes: Buffer; fileName: string }> {
  if (!attachment.fileId) throw new Error("El archivo adjunto ya no está disponible.");
  const file = db.select({ name: files.originalName }).from(files).where(eq(files.id, attachment.fileId)).get();
  if (!file) throw new Error("El archivo adjunto ya no está disponible.");
  return { bytes: await readFileBytes(attachment.fileId), fileName: file.name };
}
