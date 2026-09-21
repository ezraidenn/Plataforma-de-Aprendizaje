import "server-only";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import {
  itemAssignments,
  assignmentSubmissions,
  assignmentAttachments,
  submissionFiles,
  itemProgress,
  courseItems,
  courses,
  files,
} from "@/server/db/schema";
import { canAccess, ensureItemProgress, getEnrollment } from "./progress";
import { notify } from "./notifications";
import { getFileRecord } from "./storage";
import { currentEnrollmentIdForItem } from "./enrollment-scope";
import { enqueueJob } from "@/server/jobs/queue";
import type { FileEntry } from "./resources";

export type ItemAssignment = typeof itemAssignments.$inferSelect;
export type AssignmentSubmission = typeof assignmentSubmissions.$inferSelect;

export function getAssignmentDetail(itemId: string): ItemAssignment | null {
  return db.select().from(itemAssignments).where(eq(itemAssignments.itemId, itemId)).get() ?? null;
}

export function updateAssignmentSettings(
  itemId: string,
  patch: Partial<
    Pick<
      ItemAssignment,
      "instructionsMd" | "dueAt" | "maxScore" | "allowedFileTypes" | "allowResubmission" | "allowLate"
    >
  >
) {
  db.update(itemAssignments).set(patch).where(eq(itemAssignments.itemId, itemId)).run();
}

// ─── Adjuntos del maestro (instrucciones en PDF, plantillas, etc.) ───────────

export function listAssignmentAttachments(itemId: string): FileEntry[] {
  return db
    .select({
      id: assignmentAttachments.id,
      fileId: assignmentAttachments.fileId,
      position: assignmentAttachments.position,
      originalName: files.originalName,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
    })
    .from(assignmentAttachments)
    .innerJoin(files, eq(assignmentAttachments.fileId, files.id))
    .where(eq(assignmentAttachments.itemId, itemId))
    .orderBy(asc(assignmentAttachments.position))
    .all();
}

export function addAssignmentAttachment(itemId: string, fileId: string, actor: { id: string; role: string }) {
  const record = getFileRecord(fileId);
  if (!record || record.kind !== "attachment") throw new Error("Archivo no válido");
  // Solo se enlaza un archivo que subió quien edita, o el admin: así nadie
  // engancha a su curso el archivo de otro maestro para abrirlo
  if (record.uploadedBy !== actor.id && actor.role !== "admin") {
    throw new Error("Ese archivo no lo subiste tú");
  }
  const last = db
    .select({ m: max(assignmentAttachments.position) })
    .from(assignmentAttachments)
    .where(eq(assignmentAttachments.itemId, itemId))
    .get()?.m;
  db.insert(assignmentAttachments)
    .values({ id: nanoid(), itemId, fileId, position: (last ?? -1) + 1 })
    .run();
  enqueueJob("relocate_files", { fileId });
}

export function removeAssignmentAttachment(itemId: string, entryId: string) {
  db.delete(assignmentAttachments)
    .where(and(eq(assignmentAttachments.id, entryId), eq(assignmentAttachments.itemId, itemId)))
    .run();
}

/** Ítem/curso de un adjunto, para autorizar su descarga a alumnos. */
export function attachmentItemForFile(fileId: string) {
  return (
    db
      .select({ itemId: assignmentAttachments.itemId, courseId: courseItems.courseId })
      .from(assignmentAttachments)
      .innerJoin(courseItems, eq(assignmentAttachments.itemId, courseItems.id))
      .where(eq(assignmentAttachments.fileId, fileId))
      .get() ?? null
  );
}

// ─── Entregas ────────────────────────────────────────────────────────────────

/**
 * Entregas del alumno en una tarea dentro de UNA matrícula (la indicada o la
 * del ciclo vigente): la tarea calificada en 2026 no bloquea la de 2027.
 */
export function listStudentSubmissions(
  itemId: string,
  studentId: string,
  enrollmentId?: string
): AssignmentSubmission[] {
  const scope = enrollmentId ?? currentEnrollmentIdForItem(itemId, studentId);
  if (!scope) return [];
  return db
    .select()
    .from(assignmentSubmissions)
    .where(
      and(eq(assignmentSubmissions.itemId, itemId), eq(assignmentSubmissions.enrollmentId, scope))
    )
    .orderBy(desc(assignmentSubmissions.submittedAt))
    .all();
}

/** Archivos de una entrega (incluye el `fileId` histórico si no está en submission_files). */
export function listSubmissionFiles(submission: AssignmentSubmission): FileEntry[] {
  const rows = db
    .select({
      id: submissionFiles.id,
      fileId: submissionFiles.fileId,
      position: submissionFiles.position,
      originalName: files.originalName,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
    })
    .from(submissionFiles)
    .innerJoin(files, eq(submissionFiles.fileId, files.id))
    .where(eq(submissionFiles.submissionId, submission.id))
    .orderBy(asc(submissionFiles.position))
    .all();
  if (submission.fileId && !rows.some((r) => r.fileId === submission.fileId)) {
    const f = getFileRecord(submission.fileId);
    if (f) {
      rows.unshift({
        id: `legacy-${submission.id}`,
        fileId: f.id,
        position: -1,
        originalName: f.originalName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
      });
    }
  }
  return rows;
}

/**
 * Entrega (o re-entrega) de tarea. Valida acceso, fecha límite y política de
 * reentrega. Acepta texto de respuesta y/o varios archivos (estilo Teams).
 * Marca el ítem como completado (Completado ≠ Calificado) y notifica al
 * maestro dueño del curso.
 */
export function submitAssignment(opts: {
  courseId: string;
  studentId: string;
  itemId: string;
  /** Compat: un solo archivo. Preferir `fileIds`. */
  fileId?: string | null;
  fileIds?: string[];
  answerText?: string;
  comment?: string;
}): AssignmentSubmission {
  const access = canAccess(opts.courseId, opts.studentId, opts.itemId);
  if (!access.allowed) throw new Error("Esta tarea está bloqueada");

  const assignment = getAssignmentDetail(opts.itemId);
  if (!assignment) throw new Error("Tarea no encontrada");

  const fileIds = Array.from(new Set([...(opts.fileId ? [opts.fileId] : []), ...(opts.fileIds ?? [])]));
  const answerText = (opts.answerText ?? "").trim();
  if (fileIds.length === 0 && !answerText) {
    throw new Error("Escribe una respuesta o adjunta al menos un archivo");
  }
  if (fileIds.length > 10) throw new Error("Máximo 10 archivos por entrega");
  for (const fid of fileIds) {
    const f = getFileRecord(fid);
    if (!f || f.kind !== "submission" || f.uploadedBy !== opts.studentId) {
      throw new Error("Uno de los archivos de tu entrega no es válido. Súbelo de nuevo.");
    }
  }

  const now = new Date();
  const isLate = assignment.dueAt !== null && now.getTime() > assignment.dueAt.getTime();
  if (isLate && !assignment.allowLate) {
    throw new Error("La fecha de entrega ya pasó y esta tarea no acepta entregas tardías");
  }

  const previous = listStudentSubmissions(opts.itemId, opts.studentId);
  if (previous.length > 0 && !assignment.allowResubmission) {
    throw new Error("Esta tarea no permite reemplazar la entrega");
  }
  // Una entrega ya calificada solo se reemplaza si fue devuelta para corrección
  const latest = previous[0];
  if (latest && latest.status === "graded") {
    throw new Error(
      "Tu entrega ya fue calificada; pide a tu instructor que la devuelva si necesitas corregirla"
    );
  }

  const id = nanoid();
  db.transaction(() => {
    db.insert(assignmentSubmissions)
      .values({
        id,
        itemId: opts.itemId,
        studentId: opts.studentId,
        enrollmentId: getEnrollment(opts.courseId, opts.studentId)?.id ?? null,
        fileId: fileIds[0] ?? null,
        answerText,
        comment: opts.comment ?? "",
        submittedAt: now,
        isLate,
      })
      .run();
    fileIds.forEach((fileId, position) => {
      db.insert(submissionFiles).values({ id: nanoid(), submissionId: id, fileId, position }).run();
    });
  });

  // Los archivos entregados se acomodan en Entregas\<Curso>\<Tarea>\<Alumno>
  for (const fileId of fileIds) enqueueJob("relocate_files", { fileId });

  // El ítem-tarea queda consumido al entregar
  const enrollment = getEnrollment(opts.courseId, opts.studentId);
  if (enrollment) {
    const ip = ensureItemProgress(enrollment.id, opts.itemId);
    db.update(itemProgress)
      .set({
        status: "completed",
        percent: 100,
        completedAt: ip.completedAt ?? now,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(itemProgress.id, ip.id))
      .run();
  }

  // Notificar al maestro dueño del curso
  const item = db.select().from(courseItems).where(eq(courseItems.id, opts.itemId)).get();
  const course = item
    ? db.select().from(courses).where(eq(courses.id, item.courseId)).get()
    : null;
  if (course) {
    notify(course.ownerId, "assignment_submitted", {
      courseId: course.id,
      courseTitle: course.title,
      itemId: opts.itemId,
      itemTitle: item!.title,
      studentId: opts.studentId,
      submissionId: id,
    });
  }

  return db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, id)).get()!;
}
