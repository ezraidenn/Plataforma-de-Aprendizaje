import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { and, eq, lte, gte, or, isNull, asc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import {
  jobs,
  itemDocuments,
  exams,
  courseItems,
  courses,
  enrollments,
  notifications,
} from "@/server/db/schema";
import { getFileRecord, absolutePathFor, storageRoot, registerFile } from "@/server/services/storage";
import {
  itemContext,
  isReferenced,
  relocateFile,
  relocateCourseFiles,
  relocateItemFiles,
} from "@/server/services/storage-layout";
import { deleteFile } from "@/server/services/storage";
import { coursePath, fileNameFor } from "@/server/services/storage-paths";
import { issueCertificate } from "@/server/services/certificates";
import { listAttempts, computeFinalScorePercent } from "@/server/services/exam-scoring";
import { notify } from "@/server/services/notifications";
import { runResultsAvailable } from "@/server/services/exam-results";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 3;

export { enqueueJob } from "./queue";

// ─── Handlers ────────────────────────────────────────────────────────────────

/** PPT/PPTX → PDF con LibreOffice headless; luego mismo flujo que un PDF. */
/**
 * Acomoda los archivos en su carpeta legible tras renombrar o reordenar. Se
 * hace en segundo plano: sobre un NAS cada movimiento es una operación de red
 * y no debe bloquear la interfaz del maestro.
 */
async function handleRelocateFiles(payload: {
  courseId?: string;
  itemId?: string;
  fileId?: string;
}) {
  if (payload.fileId) {
    await relocateFile(payload.fileId);
    return;
  }
  if (payload.itemId) {
    const r = await relocateItemFiles(payload.itemId);
    if (r.failed > 0) throw new Error(`No se pudieron mover ${r.failed} archivo(s)`);
    return;
  }
  if (payload.courseId) {
    const r = await relocateCourseFiles(payload.courseId);
    if (r.failed > 0) throw new Error(`No se pudieron mover ${r.failed} archivo(s)`);
  }
}

/**
 * Borra del disco los archivos que quedaron sin dueño tras eliminar un curso o
 * una lección. Comprueba una por una que nada los referencie: si el archivo se
 * reutilizó en otro sitio, se conserva.
 */
async function handleCleanupFiles(payload: { fileIds?: string[] }) {
  for (const fileId of payload.fileIds ?? []) {
    if (!isReferenced(fileId)) {
      await deleteFile(fileId).catch((err) => {
        console.error("No se pudo borrar el archivo", fileId, err);
      });
    }
  }
}

async function handleConvertPpt(payload: { itemId: string }) {
  const doc = db
    .select()
    .from(itemDocuments)
    .where(eq(itemDocuments.itemId, payload.itemId))
    .get();
  if (!doc?.sourceFileId) throw new Error("El ítem ya no tiene archivo fuente");

  const source = getFileRecord(doc.sourceFileId);
  if (!source) throw new Error("Archivo fuente no encontrado");

  db.update(itemDocuments)
    .set({ processingStatus: "processing", processingError: null })
    .where(eq(itemDocuments.itemId, payload.itemId))
    .run();

  const sofficePath = process.env.SOFFICE_PATH ?? "soffice";
  const srcAbs = absolutePathFor(source.storedPath);
  const outDir = path.join(storageRoot(), "tmp", `convert-${payload.itemId}`);
  await fs.mkdir(outDir, { recursive: true });

  try {
    await execFileAsync(
      sofficePath,
      ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", outDir, srcAbs],
      { timeout: 3 * 60_000, windowsHide: true }
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        "LibreOffice no está instalado o SOFFICE_PATH es incorrecto. Instálalo para convertir PPT."
      );
    }
    throw new Error("La conversión falló. Revisa que el archivo no esté dañado ni protegido con contraseña.");
  }

  // LibreOffice nombra la salida como el archivo fuente con .pdf
  const expected = path.join(
    outDir,
    path.basename(srcAbs, path.extname(srcAbs)) + ".pdf"
  );
  let pdfBytes: Buffer;
  try {
    pdfBytes = await fs.readFile(expected);
  } catch {
    throw new Error("La conversión no produjo un PDF. Revisa el archivo original.");
  }

  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();

  // Guardar el PDF resultante junto a su lección, con nombre legible
  const renderId = nanoid();
  const ctx = itemContext(payload.itemId);
  const relPath = ctx
    ? coursePath(
        {
          courseTitle: ctx.courseTitle,
          folderTitle: ctx.folderTitle,
          folderPosition: ctx.folderPosition,
          itemTitle: ctx.itemTitle,
          itemPosition: ctx.itemPosition,
        },
        fileNameFor({
          title: ctx.itemTitle,
          ext: ".pdf",
          position: ctx.itemPosition,
          suffix: "convertido",
        })
      )
    : path.posix.join("_Sistema", "course_render", String(new Date().getFullYear()), `${renderId}.pdf`);

  const absOut = path.join(storageRoot(), relPath);
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  await fs.writeFile(absOut, pdfBytes);
  const { createHash } = await import("node:crypto");

  registerFile({
    id: renderId,
    originalName: source.originalName.replace(/\.(pptx?|PPTX?)$/, ".pdf"),
    relPath,
    mimeType: "application/pdf",
    sizeBytes: pdfBytes.length,
    sha256: createHash("sha256").update(pdfBytes).digest("hex"),
    uploadedBy: source.uploadedBy,
    kind: "course_render",
  });

  // El original (PPT/PDF) también se acomoda junto a su lección
  await relocateFile(source.id).catch(() => {});

  db.update(itemDocuments)
    .set({
      renderFileId: renderId,
      pageCount,
      processingStatus: "ready",
      processingError: null,
    })
    .where(eq(itemDocuments.itemId, payload.itemId))
    .run();

  await fs.rm(outDir, { recursive: true, force: true });
}

async function handleGenerateCertificate(payload: { enrollmentId: string }) {
  const cert = await issueCertificate(payload.enrollmentId);
  if (!cert) {
    // Sin plantilla asignada o matrícula no aprobada: nada que hacer (no es error)
    return;
  }
}

// ─── Loop del worker ─────────────────────────────────────────────────────────

async function processJob(job: typeof jobs.$inferSelect) {
  db.update(jobs)
    .set({ status: "running", startedAt: new Date(), attempts: job.attempts + 1 })
    .where(eq(jobs.id, job.id))
    .run();

  try {
    const payload = job.payload as never;
    if (job.type === "relocate_files") await handleRelocateFiles(payload);
    else if (job.type === "cleanup_files") await handleCleanupFiles(payload);
    else if (job.type === "convert_ppt") await handleConvertPpt(payload);
    else if (job.type === "generate_certificate") await handleGenerateCertificate(payload);
    else if (job.type === "process_pdf") {
      // Los PDF se procesan inline al subir; job reservado por compatibilidad
    }

    db.update(jobs).set({ status: "done", finishedAt: new Date() }).where(eq(jobs.id, job.id)).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const willRetry = job.attempts + 1 < MAX_ATTEMPTS;
    db.update(jobs)
      .set({
        status: willRetry ? "pending" : "error",
        errorMessage: message,
        runAfter: willRetry ? new Date(Date.now() + 30_000) : null,
        finishedAt: willRetry ? null : new Date(),
      })
      .where(eq(jobs.id, job.id))
      .run();

    // Reflejar el error en el documento para que el maestro lo vea
    if (job.type === "convert_ppt" && !willRetry) {
      const payload = job.payload as { itemId?: string };
      if (payload.itemId) {
        db.update(itemDocuments)
          .set({ processingStatus: "error", processingError: message })
          .where(eq(itemDocuments.itemId, payload.itemId))
          .run();
      }
    }
  }
}

// ─── Recordatorios de fecha límite ───────────────────────────────────────────

const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000; // avisar 48 h antes del cierre

/**
 * Exámenes que cierran en <= 48 h: notifica a los matriculados activos que aún
 * no lo aprueban. Un solo aviso por (alumno, examen): se deduplica contra las
 * notificaciones ya enviadas.
 */
export function runDeadlineReminders(now = Date.now()) {
  const closing = db
    .select({
      itemId: exams.itemId,
      closesAt: exams.closesAt,
      passScore: exams.passScore,
      itemTitle: courseItems.title,
      courseId: courseItems.courseId,
      courseTitle: courses.title,
      courseStatus: courses.status,
    })
    .from(exams)
    .innerJoin(courseItems, eq(exams.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(
      and(
        gte(exams.closesAt, new Date(now)),
        lte(exams.closesAt, new Date(now + REMINDER_WINDOW_MS)),
        eq(courses.status, "published")
      )
    )
    .all();

  for (const exam of closing) {
    const enrolled = db
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, exam.courseId), eq(enrollments.status, "active")))
      .all();

    for (const { studentId } of enrolled) {
      const fullExam = db.select().from(exams).where(eq(exams.itemId, exam.itemId)).get()!;
      const pct = computeFinalScorePercent(fullExam, listAttempts(exam.itemId, studentId));
      const approved = pct !== null && (fullExam.passScore === null || pct >= fullExam.passScore);
      if (approved) continue;

      const already = db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, studentId),
            eq(notifications.type, "deadline_reminder"),
            sql`json_extract(${notifications.payload}, '$.itemId') = ${exam.itemId}`
          )
        )
        .get();
      if (already) continue;

      notify(studentId, "deadline_reminder", {
        courseId: exam.courseId,
        courseTitle: exam.courseTitle,
        itemId: exam.itemId,
        itemTitle: exam.itemTitle,
        closesAt: exam.closesAt?.getTime(),
      });
    }
  }
}

let started = false;

/** Arranca el loop del worker (una sola vez por proceso). Conversiones en serie. */
export function startWorker() {
  if (started) return;
  started = true;

  // Recordatorios de cierre: al arrancar y cada hora
  try {
    runDeadlineReminders();
  } catch (err) {
    console.error("[worker] recordatorios:", err);
  }
  setInterval(() => {
    try {
      runDeadlineReminders();
    } catch (err) {
      console.error("[worker] recordatorios:", err);
    }
  }, 60 * 60_000);

  // Resultados «al cierre»: avisar a los alumnos en cuanto cierra el examen
  const resultsPass = () => {
    try {
      runResultsAvailable();
    } catch (err) {
      console.error("[worker] resultados:", err);
    }
  };
  resultsPass();
  setInterval(resultsPass, 5 * 60_000);

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // Rescatar jobs "running" huérfanos de un reinicio (más de 10 min)
      db.update(jobs)
        .set({ status: "pending" })
        .where(
          and(eq(jobs.status, "running"), lte(jobs.startedAt, new Date(Date.now() - 10 * 60_000)))
        )
        .run();

      const next = db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.status, "pending"),
            or(isNull(jobs.runAfter), lte(jobs.runAfter, new Date()))
          )
        )
        .orderBy(asc(jobs.createdAt))
        .limit(1)
        .get();

      if (next) await processJob(next);
    } catch (err) {
      console.error("[worker] error en el loop:", err);
    } finally {
      busy = false;
    }
  }, POLL_INTERVAL_MS);

  console.log("[worker] iniciado: convert_ppt, generate_certificate, relocate_files, cleanup_files");
}
