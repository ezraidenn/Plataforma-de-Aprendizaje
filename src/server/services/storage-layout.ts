import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  assignmentAttachments,
  certificates,
  assignmentSubmissions,
  certificateTemplates,
  courseItems,
  courses,
  files,
  itemDocuments,
  itemResourceFiles,
  submissionFiles,
  users,
} from "@/server/db/schema";
import {
  coursePath,
  fileNameFor,
  submissionPath,
  systemPath,
  TOP,
  joinRelative,
  safeName,
} from "./storage-paths";
import { getFileRecord, moveFile } from "./storage";

/**
 * Decide DÓNDE debe vivir cada archivo dentro de la raíz, siguiendo la
 * jerarquía visible del curso. Es el puente entre la base de datos (que manda
 * sobre la ruta) y el árbol legible que ve el operador en el NAS.
 */

/** Carpeta donde aterrizan las subidas hasta que se asocian a un ítem. */
export const INCOMING = joinRelative(TOP.system, "Entrantes");

type ItemContext = {
  courseTitle: string;
  folderTitle: string | null;
  folderPosition: number | null;
  itemTitle: string;
  itemPosition: number;
};

/** Curso, carpeta contenedora y posición de una lección. */
export function itemContext(itemId: string): ItemContext | null {
  const item = db.select().from(courseItems).where(eq(courseItems.id, itemId)).get();
  if (!item) return null;
  const course = db.select().from(courses).where(eq(courses.id, item.courseId)).get();
  if (!course) return null;

  let folderTitle: string | null = null;
  let folderPosition: number | null = null;
  if (item.parentId) {
    const parent = db.select().from(courseItems).where(eq(courseItems.id, item.parentId)).get();
    if (parent?.kind === "folder") {
      folderTitle = parent.title;
      folderPosition = parent.position;
    }
  }
  return {
    courseTitle: course.title,
    folderTitle,
    folderPosition,
    itemTitle: item.title,
    itemPosition: item.position,
  };
}

function courseFilePath(ctx: ItemContext, fileName: string): string {
  return coursePath(
    {
      courseTitle: ctx.courseTitle,
      folderTitle: ctx.folderTitle,
      folderPosition: ctx.folderPosition,
      itemTitle: ctx.itemTitle,
      itemPosition: ctx.itemPosition,
    },
    fileName
  );
}

/**
 * Ruta legible que le corresponde a un archivo según sus referencias en la
 * base de datos. Devuelve null si el archivo no está asociado a nada todavía
 * (queda en `_Sistema/Entrantes`).
 */
export function desiredPathForFile(fileId: string): string | null {
  const rec = getFileRecord(fileId);
  if (!rec) return null;
  const ext = "." + (rec.originalName.split(".").pop() ?? "").toLowerCase();
  const hasExt = rec.originalName.includes(".");

  // ─── Documento de lección (PPT/PDF original y su conversión) ──────────────
  const asDoc = db
    .select()
    .from(itemDocuments)
    .where(eq(itemDocuments.sourceFileId, fileId))
    .get();
  if (asDoc) {
    const ctx = itemContext(asDoc.itemId);
    if (ctx) {
      return courseFilePath(
        ctx,
        fileNameFor({ title: ctx.itemTitle, ext: hasExt ? ext : "", position: ctx.itemPosition })
      );
    }
  }
  const asRender = db
    .select()
    .from(itemDocuments)
    .where(eq(itemDocuments.renderFileId, fileId))
    .get();
  if (asRender) {
    const ctx = itemContext(asRender.itemId);
    if (ctx) {
      // Si el original ya era PDF no hay conversión que distinguir
      const source = asRender.sourceFileId ? getFileRecord(asRender.sourceFileId) : null;
      const sourceWasPdf = source?.mimeType === "application/pdf";
      return courseFilePath(
        ctx,
        fileNameFor({
          title: ctx.itemTitle,
          ext: ".pdf",
          position: ctx.itemPosition,
          suffix: sourceWasPdf ? undefined : "convertido",
        })
      );
    }
  }

  // ─── Archivos de un recurso descargable ───────────────────────────────────
  const asResource = db
    .select()
    .from(itemResourceFiles)
    .where(eq(itemResourceFiles.fileId, fileId))
    .get();
  if (asResource) {
    const ctx = itemContext(asResource.itemId);
    if (ctx) {
      // Carpeta por lección: un recurso suele tener varios archivos
      const dir = courseFilePath(
        ctx,
        fileNameFor({ title: ctx.itemTitle, position: ctx.itemPosition })
      );
      return joinRelative(dir, safeName(rec.originalName));
    }
  }

  // ─── Material de apoyo de una tarea ───────────────────────────────────────
  const asAttachment = db
    .select()
    .from(assignmentAttachments)
    .where(eq(assignmentAttachments.fileId, fileId))
    .get();
  if (asAttachment) {
    const ctx = itemContext(asAttachment.itemId);
    if (ctx) {
      const dir = courseFilePath(
        ctx,
        fileNameFor({ title: ctx.itemTitle, position: ctx.itemPosition })
      );
      return joinRelative(dir, "Material de apoyo", safeName(rec.originalName));
    }
  }

  // ─── Entrega de un alumno ─────────────────────────────────────────────────
  const asSubmissionFile = db
    .select({ submissionId: submissionFiles.submissionId })
    .from(submissionFiles)
    .where(eq(submissionFiles.fileId, fileId))
    .get();
  const submissionId =
    asSubmissionFile?.submissionId ??
    db
      .select({ id: assignmentSubmissions.id })
      .from(assignmentSubmissions)
      .where(eq(assignmentSubmissions.fileId, fileId))
      .get()?.id;
  if (submissionId) {
    const sub = db
      .select()
      .from(assignmentSubmissions)
      .where(eq(assignmentSubmissions.id, submissionId))
      .get();
    if (sub) {
      const item = db.select().from(courseItems).where(eq(courseItems.id, sub.itemId)).get();
      const course = item
        ? db.select().from(courses).where(eq(courses.id, item.courseId)).get()
        : null;
      const student = db.select().from(users).where(eq(users.id, sub.studentId)).get();
      if (item && course && student) {
        return submissionPath({
          courseTitle: course.title,
          itemTitle: item.title,
          studentName: student.fullName,
          submittedAt: sub.submittedAt,
          fileName: rec.originalName,
        });
      }
    }
  }

  // ─── Portada de curso ─────────────────────────────────────────────────────
  const asCover = db.select().from(courses).where(eq(courses.coverFileId, fileId)).get();
  if (asCover) {
    return joinRelative(
      TOP.courses,
      safeName(asCover.title),
      `_Portada${hasExt ? ext : ".jpg"}`
    );
  }

  // ─── Fondo de plantilla de certificado ────────────────────────────────────
  const asTemplateBg = db
    .select()
    .from(certificateTemplates)
    .where(eq(certificateTemplates.backgroundFileId, fileId))
    .get();
  if (asTemplateBg) {
    return systemPath("templates", `${safeName(asTemplateBg.name)}${hasExt ? ext : ""}`);
  }

  // ─── Identidad e imágenes del editor (no cuelgan de un curso) ─────────────
  if (rec.kind === "branding") return systemPath("identity", rec.originalName);
  if (rec.kind === "editor_image") return systemPath("editor", rec.originalName);

  return null;
}

/**
 * Mueve un archivo a la ruta que le toca ahora. Se llama cuando el archivo se
 * asocia a un ítem (tras subirlo) y cuando cambian los títulos o el orden.
 * Devuelve la ruta final, o null si no aplica.
 */
export async function relocateFile(fileId: string): Promise<string | null> {
  const desired = desiredPathForFile(fileId);
  if (!desired) return null;
  const rec = getFileRecord(fileId);
  if (!rec || rec.storedPath === desired) return rec?.storedPath ?? null;
  return moveFile(fileId, desired);
}

/** Todos los archivos que cuelgan de un curso (para renombrados en cascada). */
export function fileIdsForCourse(courseId: string): string[] {
  const items = db
    .select({ id: courseItems.id })
    .from(courseItems)
    .where(eq(courseItems.courseId, courseId))
    .all()
    .map((i) => i.id);

  const ids = new Set<string>();
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (course?.coverFileId) ids.add(course.coverFileId);

  for (const itemId of items) {
    const doc = db.select().from(itemDocuments).where(eq(itemDocuments.itemId, itemId)).get();
    if (doc?.sourceFileId) ids.add(doc.sourceFileId);
    if (doc?.renderFileId) ids.add(doc.renderFileId);

    for (const r of db
      .select({ fileId: itemResourceFiles.fileId })
      .from(itemResourceFiles)
      .where(eq(itemResourceFiles.itemId, itemId))
      .all()) {
      ids.add(r.fileId);
    }
    for (const a of db
      .select({ fileId: assignmentAttachments.fileId })
      .from(assignmentAttachments)
      .where(eq(assignmentAttachments.itemId, itemId))
      .all()) {
      ids.add(a.fileId);
    }
    for (const s of db
      .select({ id: assignmentSubmissions.id, fileId: assignmentSubmissions.fileId })
      .from(assignmentSubmissions)
      .where(eq(assignmentSubmissions.itemId, itemId))
      .all()) {
      if (s.fileId) ids.add(s.fileId);
      for (const sf of db
        .select({ fileId: submissionFiles.fileId })
        .from(submissionFiles)
        .where(eq(submissionFiles.submissionId, s.id))
        .all()) {
        ids.add(sf.fileId);
      }
    }
  }
  return [...ids];
}

/** Archivos de una lección (para cuando solo cambia su título o posición). */
export function fileIdsForItem(itemId: string): string[] {
  const ids = new Set<string>();
  const doc = db.select().from(itemDocuments).where(eq(itemDocuments.itemId, itemId)).get();
  if (doc?.sourceFileId) ids.add(doc.sourceFileId);
  if (doc?.renderFileId) ids.add(doc.renderFileId);
  for (const r of db
    .select({ fileId: itemResourceFiles.fileId })
    .from(itemResourceFiles)
    .where(eq(itemResourceFiles.itemId, itemId))
    .all()) {
    ids.add(r.fileId);
  }
  for (const a of db
    .select({ fileId: assignmentAttachments.fileId })
    .from(assignmentAttachments)
    .where(eq(assignmentAttachments.itemId, itemId))
    .all()) {
    ids.add(a.fileId);
  }
  return [...ids];
}

/**
 * Reubica en segundo plano todos los archivos de un curso. Los errores se
 * registran pero no interrumpen: el verificador de integridad los reporta.
 */
export async function relocateCourseFiles(courseId: string): Promise<{ moved: number; failed: number }> {
  let moved = 0;
  let failed = 0;
  for (const fileId of fileIdsForCourse(courseId)) {
    try {
      const before = getFileRecord(fileId)?.storedPath;
      const after = await relocateFile(fileId);
      if (after && after !== before) moved++;
    } catch (err) {
      failed++;
      console.error("No se pudo reubicar el archivo", fileId, err);
    }
  }
  return { moved, failed };
}

/** Igual que el anterior, pero solo para una lección. */
export async function relocateItemFiles(itemId: string): Promise<{ moved: number; failed: number }> {
  let moved = 0;
  let failed = 0;
  for (const fileId of fileIdsForItem(itemId)) {
    try {
      const before = getFileRecord(fileId)?.storedPath;
      const after = await relocateFile(fileId);
      if (after && after !== before) moved++;
    } catch (err) {
      failed++;
      console.error("No se pudo reubicar el archivo", fileId, err);
    }
  }
  return { moved, failed };
}

/**
 * ¿Alguna tabla referencia este archivo? Un archivo referenciado pero sin ruta
 * legible (el PDF de un certificado) no es basura: solo no vive en el árbol.
 */
export function isReferenced(fileId: string): boolean {
  if (desiredPathForFile(fileId) !== null) return true;
  const asCert = db
    .select({ id: certificates.id })
    .from(certificates)
    .where(eq(certificates.pdfFileId, fileId))
    .get();
  return !!asCert;
}

/** Archivos huérfanos: existen en `files` pero nada los referencia. */
export function unreferencedFileIds(): string[] {
  return db
    .select({ id: files.id })
    .from(files)
    .all()
    .filter((f) => !isReferenced(f.id))
    .map((f) => f.id);
}

/** Filas cuyo archivo ya no está en disco, o cuya ruta debería cambiar. */
export function layoutDrift(): { fileId: string; from: string; to: string }[] {
  const out: { fileId: string; from: string; to: string }[] = [];
  for (const f of db.select().from(files).all()) {
    const desired = desiredPathForFile(f.id);
    if (desired && desired !== f.storedPath) {
      out.push({ fileId: f.id, from: f.storedPath, to: desired });
    }
  }
  return out;
}

