import "server-only";
import { and, asc, eq, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { courseItems, files, itemLinks, itemProgress, itemResourceFiles } from "@/server/db/schema";
import { canAccess, ensureItemProgress, getEnrollment } from "./progress";
import { evaluateEnrollment } from "./rules-engine";
import { getFileRecord } from "./storage";
import { enqueueJob } from "@/server/jobs/queue";

export type ItemLink = typeof itemLinks.$inferSelect;
export type FileEntry = {
  id: string;
  fileId: string;
  position: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

// ─── Enlace externo ──────────────────────────────────────────────────────────

export function getLink(itemId: string): ItemLink | null {
  return db.select().from(itemLinks).where(eq(itemLinks.itemId, itemId)).get() ?? null;
}

export function updateLink(itemId: string, patch: { url?: string; description?: string }) {
  if (patch.url !== undefined) {
    const url = patch.url.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      throw new Error("La URL debe empezar con http:// o https://");
    }
    patch = { ...patch, url };
  }
  const existing = getLink(itemId);
  if (existing) {
    db.update(itemLinks).set(patch).where(eq(itemLinks.itemId, itemId)).run();
  } else {
    db.insert(itemLinks)
      .values({ itemId, url: patch.url ?? "", description: patch.description ?? "" })
      .run();
  }
}

// ─── Recurso descargable ─────────────────────────────────────────────────────

export function listResourceFiles(itemId: string): FileEntry[] {
  return db
    .select({
      id: itemResourceFiles.id,
      fileId: itemResourceFiles.fileId,
      position: itemResourceFiles.position,
      originalName: files.originalName,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
    })
    .from(itemResourceFiles)
    .innerJoin(files, eq(itemResourceFiles.fileId, files.id))
    .where(eq(itemResourceFiles.itemId, itemId))
    .orderBy(asc(itemResourceFiles.position))
    .all();
}

export function addResourceFile(itemId: string, fileId: string, actor: { id: string; role: string }) {
  const record = getFileRecord(fileId);
  if (!record || record.kind !== "resource") throw new Error("Archivo no válido");
  // Solo se enlaza un archivo que subió quien edita, o el admin: así nadie
  // engancha a su curso el archivo de otro maestro para abrirlo
  if (record.uploadedBy !== actor.id && actor.role !== "admin") {
    throw new Error("Ese archivo no lo subiste tú");
  }
  const last = db
    .select({ m: max(itemResourceFiles.position) })
    .from(itemResourceFiles)
    .where(eq(itemResourceFiles.itemId, itemId))
    .get()?.m;
  db.insert(itemResourceFiles)
    .values({ id: nanoid(), itemId, fileId, position: (last ?? -1) + 1 })
    .run();
  enqueueJob("relocate_files", { fileId });
}

export function removeResourceFile(itemId: string, entryId: string) {
  db.delete(itemResourceFiles)
    .where(and(eq(itemResourceFiles.id, entryId), eq(itemResourceFiles.itemId, itemId)))
    .run();
}

export function reorderResourceFiles(itemId: string, orderedEntryIds: string[]) {
  db.transaction(() => {
    orderedEntryIds.forEach((id, i) => {
      db.update(itemResourceFiles)
        .set({ position: i })
        .where(and(eq(itemResourceFiles.id, id), eq(itemResourceFiles.itemId, itemId)))
        .run();
    });
  });
}

/** Ítem (y curso) al que pertenece un archivo de recurso, para autorizar descargas. */
export function resourceItemForFile(fileId: string) {
  return (
    db
      .select({ itemId: itemResourceFiles.itemId, courseId: courseItems.courseId })
      .from(itemResourceFiles)
      .innerJoin(courseItems, eq(itemResourceFiles.itemId, courseItems.id))
      .where(eq(itemResourceFiles.fileId, fileId))
      .get() ?? null
  );
}

// ─── Completitud (estudiante) ────────────────────────────────────────────────

function completeSimpleItem(courseId: string, studentId: string, itemId: string) {
  const access = canAccess(courseId, studentId, itemId);
  if (!access.allowed) throw new Error("Este contenido está bloqueado");
  const enrollment = getEnrollment(courseId, studentId);
  if (!enrollment) throw new Error("No estás inscrito en este curso");
  const now = new Date();
  const ip = ensureItemProgress(enrollment.id, itemId);
  if (ip.status !== "completed") {
    db.update(itemProgress)
      .set({
        status: "completed",
        percent: 100,
        completedAt: now,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(itemProgress.id, ip.id))
      .run();
    evaluateEnrollment(enrollment.id);
  }
}

/** El enlace se da por visto al abrirlo. */
export function markLinkOpened(courseId: string, studentId: string, itemId: string) {
  const item = db.select().from(courseItems).where(eq(courseItems.id, itemId)).get();
  if (!item || item.courseId !== courseId || item.kind !== "link") {
    throw new Error("Enlace no encontrado");
  }
  completeSimpleItem(courseId, studentId, itemId);
}

/** El recurso se da por visto al descargar cualquiera de sus archivos. */
export function markResourceDownloaded(courseId: string, studentId: string, itemId: string) {
  const item = db.select().from(courseItems).where(eq(courseItems.id, itemId)).get();
  if (!item || item.courseId !== courseId || item.kind !== "resource") {
    throw new Error("Recurso no encontrado");
  }
  completeSimpleItem(courseId, studentId, itemId);
}
