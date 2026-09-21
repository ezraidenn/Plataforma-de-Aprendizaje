import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/server/db";
import {
  assignmentAttachments,
  assignmentSubmissions,
  certificates,
  certificateTemplates,
  courseItems,
  courses,
  itemDocuments,
  itemResourceFiles,
  questions,
  submissionFiles,
} from "@/server/db/schema";

/**
 * Archivos por maestro: cada maestro abre solo los de SUS cursos.
 * Alumnos y admin tienen su propia regla en /api/files/[fileId].
 *
 * Cada referencia es una consulta con join hasta `courses` filtrada por el
 * dueño: si ALGUNA fila que apunta al archivo cuelga de un curso suyo, lo abre.
 * Así un archivo referenciado desde varios cursos se revisa completo.
 */

type FileRef = { id: string; kind: string; uploadedBy: string };
type RefCheck = (fileId: string, userId: string) => boolean;

// Públicos (identidad, portadas) o imágenes pegadas en textos, que sube quien
// edita (puede ser el admin trabajando en un curso ajeno)
const ALWAYS = new Set(["branding", "cover", "editor_image"]);

// ─── Una función por referencia ──────────────────────────────────────────────

/** Documento de un curso suyo (original, PDF final o miniatura). */
function inOwnDocument(fileId: string, userId: string): boolean {
  const row = db
    .select({ id: courses.id })
    .from(itemDocuments)
    .innerJoin(courseItems, eq(itemDocuments.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(
      and(
        eq(courses.ownerId, userId),
        or(
          eq(itemDocuments.sourceFileId, fileId),
          eq(itemDocuments.renderFileId, fileId),
          eq(itemDocuments.thumbnailFileId, fileId)
        )
      )
    )
    .get();
  return row !== undefined;
}

/** Archivo de un recurso descargable de un curso suyo. */
function inOwnResource(fileId: string, userId: string): boolean {
  const row = db
    .select({ id: courses.id })
    .from(itemResourceFiles)
    .innerJoin(courseItems, eq(itemResourceFiles.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(and(eq(itemResourceFiles.fileId, fileId), eq(courses.ownerId, userId)))
    .get();
  return row !== undefined;
}

/** Adjunto del maestro en una tarea de un curso suyo. */
function inOwnAttachment(fileId: string, userId: string): boolean {
  const row = db
    .select({ id: courses.id })
    .from(assignmentAttachments)
    .innerJoin(courseItems, eq(assignmentAttachments.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(and(eq(assignmentAttachments.fileId, fileId), eq(courses.ownerId, userId)))
    .get();
  return row !== undefined;
}

/** Archivo principal (histórico) de una entrega en una tarea de un curso suyo. */
function inOwnSubmission(fileId: string, userId: string): boolean {
  const row = db
    .select({ id: courses.id })
    .from(assignmentSubmissions)
    .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(and(eq(assignmentSubmissions.fileId, fileId), eq(courses.ownerId, userId)))
    .get();
  return row !== undefined;
}

/** Uno de los archivos (submission_files) de una entrega en un curso suyo. */
function inOwnSubmissionFiles(fileId: string, userId: string): boolean {
  const row = db
    .select({ id: courses.id })
    .from(submissionFiles)
    .innerJoin(assignmentSubmissions, eq(submissionFiles.submissionId, assignmentSubmissions.id))
    .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(and(eq(submissionFiles.fileId, fileId), eq(courses.ownerId, userId)))
    .get();
  return row !== undefined;
}

/** PDF de un certificado emitido en un curso suyo. */
function inOwnCertificate(fileId: string, userId: string): boolean {
  const row = db
    .select({ id: courses.id })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(and(eq(certificates.pdfFileId, fileId), eq(courses.ownerId, userId)))
    .get();
  return row !== undefined;
}

/**
 * Fondo de plantilla: la plantilla es suya, o la usa algún curso suyo (el
 * admin puede asignarle a su curso una plantilla de otro).
 */
function inOwnOrUsedTemplate(fileId: string, userId: string): boolean {
  const own = db
    .select({ id: certificateTemplates.id })
    .from(certificateTemplates)
    .where(and(eq(certificateTemplates.backgroundFileId, fileId), eq(certificateTemplates.ownerId, userId)))
    .get();
  if (own) return true;
  const used = db
    .select({ id: courses.id })
    .from(certificateTemplates)
    .innerJoin(courses, eq(courses.certificateTemplateId, certificateTemplates.id))
    .where(and(eq(certificateTemplates.backgroundFileId, fileId), eq(courses.ownerId, userId)))
    .get();
  return used !== undefined;
}

/** Imagen de una pregunta de un examen de un curso suyo. */
function inOwnQuestion(fileId: string, userId: string): boolean {
  const row = db
    .select({ id: courses.id })
    .from(questions)
    .innerJoin(courseItems, eq(questions.examItemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(and(eq(questions.imageFileId, fileId), eq(courses.ownerId, userId)))
    .get();
  return row !== undefined;
}

// Referencias que se revisan según el tipo del archivo
const CHECKS_BY_KIND = new Map<string, RefCheck[]>([
  ["course_source", [inOwnDocument]],
  ["course_render", [inOwnDocument]],
  ["thumbnail", [inOwnDocument]],
  ["resource", [inOwnResource]],
  ["attachment", [inOwnAttachment]],
  ["submission", [inOwnSubmission, inOwnSubmissionFiles]],
  ["certificate", [inOwnCertificate]],
  ["template_bg", [inOwnOrUsedTemplate]],
]);

/**
 * ¿Puede este maestro abrir el archivo? Siempre los públicos, las imágenes
 * del editor y lo que subió él; lo demás, solo si cuelga de un curso suyo.
 * Un tipo desconocido o un archivo sin referencias: no.
 */
export function teacherCanAccessFile(userId: string, record: FileRef): boolean {
  if (ALWAYS.has(record.kind)) return true;
  if (record.uploadedBy === userId) return true;
  // Las imágenes de pregunta no tienen tipo propio: se revisan con cualquier tipo
  const checks = [...(CHECKS_BY_KIND.get(record.kind) ?? []), inOwnQuestion];
  return checks.some((refersFromOwnCourse) => refersFromOwnCourse(record.id, userId));
}
