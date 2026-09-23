import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { aiConversations, aiExports } from "@/server/db/schema";

/**
 * Lo que el asistente deja para descargar (CSV de una consulta, contraseñas de
 * un alta). Vive con la conversación, solo lo abre su dueño y caduca: son
 * datos personales, no archivos del curso.
 */

export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export function createExport(conversationId: string, fileName: string, content: string): string {
  purgeExports();
  const id = nanoid();
  db.insert(aiExports)
    .values({ id, conversationId, fileName, content, expiresAt: new Date(Date.now() + EXPORT_TTL_MS) })
    .run();
  return id;
}

/** El CSV, solo para el dueño de la conversación y si no ha caducado. */
export function readExport(userId: string, exportId: string): { fileName: string; content: string } | null {
  const row = db
    .select({ fileName: aiExports.fileName, content: aiExports.content, expiresAt: aiExports.expiresAt })
    .from(aiExports)
    .innerJoin(aiConversations, eq(aiExports.conversationId, aiConversations.id))
    .where(and(eq(aiExports.id, exportId), eq(aiConversations.userId, userId)))
    .get();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { fileName: row.fileName, content: row.content };
}

/** Borra las caducadas. Barato: se llama al crear una nueva. */
export function purgeExports(): number {
  return db.delete(aiExports).where(lt(aiExports.expiresAt, new Date())).run().changes;
}
