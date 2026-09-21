import "server-only";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import { itemDocuments } from "@/server/db/schema";
import { getFileRecord, absolutePathFor } from "./storage";
import { enqueueJob } from "@/server/jobs/queue";

/**
 * Asocia un archivo subido a un ítem de tipo documento.
 * - PDF: cuenta páginas al momento (pdf-lib) y queda `ready` — el visor usa
 *   el propio PDF con pdf.js, no se rasteriza nada.
 * - PPT/PPTX: queda `pending` hasta que el worker de conversión (Fase 3)
 *   lo convierta con LibreOffice.
 */
export async function attachDocumentFile(
  itemId: string,
  fileId: string,
  actor: { id: string; role: string }
) {
  const record = getFileRecord(fileId);
  if (!record) throw new Error("Archivo no encontrado");
  // Solo un original de documento (no una entrega, un recurso, etc.)…
  if (record.kind !== "course_source") throw new Error("Archivo no válido");
  // …y que subió quien edita, o el admin: así nadie engancha a su curso el
  // archivo de otro maestro (ni el de un alumno) para abrirlo o moverlo
  if (record.uploadedBy !== actor.id && actor.role !== "admin") {
    throw new Error("Ese archivo no lo subiste tú");
  }

  const ext = record.originalName.toLowerCase().split(".").pop() ?? "";

  if (ext === "pdf") {
    const bytes = await fs.readFile(absolutePathFor(record.storedPath));
    let pageCount: number;
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      pageCount = pdf.getPageCount();
    } catch {
      db.update(itemDocuments)
        .set({
          sourceFileId: fileId,
          sourceType: "pdf",
          processingStatus: "error",
          processingError:
            "No pudimos leer este PDF. Revisa que no esté dañado ni protegido con contraseña.",
        })
        .where(eq(itemDocuments.itemId, itemId))
        .run();
      return { status: "error" as const };
    }

    db.update(itemDocuments)
      .set({
        sourceFileId: fileId,
        renderFileId: fileId,
        sourceType: "pdf",
        pageCount,
        processingStatus: "ready",
        processingError: null,
      })
      .where(eq(itemDocuments.itemId, itemId))
      .run();
    enqueueJob("relocate_files", { itemId });
    return { status: "ready" as const, pageCount };
  }

  if (ext === "ppt" || ext === "pptx") {
    db.update(itemDocuments)
      .set({
        sourceFileId: fileId,
        renderFileId: null,
        sourceType: ext,
        pageCount: null,
        processingStatus: "pending",
        processingError: null,
      })
      .where(eq(itemDocuments.itemId, itemId))
      .run();
    enqueueJob("convert_ppt", { itemId });
    return { status: "pending" as const };
  }

  throw new Error("Formato no soportado: sube un PDF, PPT o PPTX");
}

export function getDocumentDetail(itemId: string) {
  return db.select().from(itemDocuments).where(eq(itemDocuments.itemId, itemId)).get() ?? null;
}
