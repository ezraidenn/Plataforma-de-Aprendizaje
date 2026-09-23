import "server-only";
import { Readable } from "node:stream";
import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { aiConversations, aiExports } from "@/server/db/schema";
import { deleteFile, readFileBytes, saveStream } from "@/server/services/storage";

/**
 * Lo que el asistente deja para descargar (CSV de una consulta, contraseñas de
 * un alta, un Excel con formato). Vive con la conversación, solo lo abre su
 * dueño y caduca: son datos personales, no archivos del curso.
 *
 * Dos formas de guardarlo: el texto va en la fila (`content`) y lo binario en
 * el almacenamiento (`file_id`), porque un Excel son bytes. Al caducar se
 * borran los dos, fila y archivo.
 */

export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export const CSV_MIME = "text/csv";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** «movimientos-2026-09-22.csv»: el nombre con el que se descarga (fecha local). */
export function exportFileName(base: string, ext = "csv"): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${base}-${d.getFullYear()}-${mes}-${dia}.${ext}`;
}

export function createExport(conversationId: string, fileName: string, content: string): string {
  // Limpieza de fondo: nadie espera por ella para tener su descarga
  void purgeExports().catch(() => {});
  const id = nanoid();
  db.insert(aiExports)
    .values({
      id,
      conversationId,
      fileName,
      content,
      mime: CSV_MIME,
      expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
    })
    .run();
  return id;
}

/** Descarga binaria (Excel): los bytes van al almacenamiento y la fila apunta ahí. */
export async function createFileExport(
  conversationId: string,
  fileName: string,
  bytes: Buffer,
  mime: string,
  userId: string
): Promise<string> {
  await purgeExports().catch(() => 0);
  const { id: fileId } = await saveStream({
    stream: Readable.from(bytes),
    originalName: fileName,
    mimeType: mime,
    kind: "assistant_export",
    uploadedBy: userId,
  });
  const id = nanoid();
  db.insert(aiExports)
    .values({ id, conversationId, fileName, fileId, mime, expiresAt: new Date(Date.now() + EXPORT_TTL_MS) })
    .run();
  return id;
}

export type ExportInfo = { fileName: string; mime: string; content?: string; fileId?: string };

/** La descarga, solo para el dueño de la conversación y si no ha caducado. */
export function readExport(userId: string, exportId: string): ExportInfo | null {
  const row = db
    .select({
      fileName: aiExports.fileName,
      content: aiExports.content,
      fileId: aiExports.fileId,
      mime: aiExports.mime,
      expiresAt: aiExports.expiresAt,
    })
    .from(aiExports)
    .innerJoin(aiConversations, eq(aiExports.conversationId, aiConversations.id))
    .where(and(eq(aiExports.id, exportId), eq(aiConversations.userId, userId)))
    .get();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return {
    fileName: row.fileName,
    mime: row.mime,
    ...(row.content !== null ? { content: row.content } : {}),
    ...(row.fileId !== null ? { fileId: row.fileId } : {}),
  };
}

/** Los bytes que se sirven, vengan del texto de la fila o del archivo. */
export async function readExportBytes(
  userId: string,
  exportId: string
): Promise<{ fileName: string; mime: string; bytes: Buffer } | null> {
  const info = readExport(userId, exportId);
  if (!info) return null;
  if (info.fileId) {
    try {
      return { fileName: info.fileName, mime: info.mime, bytes: await readFileBytes(info.fileId) };
    } catch {
      // La fila sigue pero el archivo ya no está: para quien descarga es lo mismo
      return null;
    }
  }
  return { fileName: info.fileName, mime: info.mime, bytes: Buffer.from(info.content ?? "", "utf8") };
}

/** Borra las caducadas, con su archivo. Barato: se llama al crear una nueva. */
export async function purgeExports(): Promise<number> {
  // La misma hora para las dos consultas: así no se escapa ningún archivo de
  // una fila que caduque justo entre una y otra
  const now = new Date();
  const stale = db
    .select({ id: aiExports.id, fileId: aiExports.fileId })
    .from(aiExports)
    .where(lt(aiExports.expiresAt, now))
    .all();
  const removed = db.delete(aiExports).where(lt(aiExports.expiresAt, now)).run().changes;
  // Después de la fila: si algo falla al borrar el archivo lo recoge `storage:check`
  for (const row of stale) if (row.fileId) await deleteFile(row.fileId);
  return removed;
}
