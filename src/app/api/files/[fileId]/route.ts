import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { or, eq } from "drizzle-orm";
import { apiUser } from "@/server/auth/guards";
import { getFileRecord, absolutePathFor } from "@/server/services/storage";
import { db } from "@/server/db";
import { itemDocuments, courseItems, certificates } from "@/server/db/schema";
import { canAccess } from "@/server/services/progress";
import { resourceItemForFile, markResourceDownloaded } from "@/server/services/resources";
import { attachmentItemForFile } from "@/server/services/assignments";
import { teacherCanAccessFile } from "@/server/services/file-access";
import { inlineAllowed } from "@/lib/inline-mime";

export const runtime = "nodejs";


/**
 * Sirve archivos de storage/ con autorización y soporte HTTP Range.
 * Para estudiantes, el contenido de curso exige matrícula Y candado abierto
 * (canAccess): la URL directa no salta la secuencia. Un maestro solo abre los
 * archivos de sus cursos (teacherCanAccessFile); el admin, todos.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const record = getFileRecord(fileId);
  if (!record) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Logo/portada de empresa y portadas de curso: públicas (login y /verify sin sesión)
  const isPublic = record.kind === "branding" || record.kind === "cover";

  const user = isPublic ? null : await apiUser();
  if (!isPublic && !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (user?.role === "student") {
    if (record.kind === "course_source" || record.kind === "course_render") {
      const doc = db
        .select({ itemId: itemDocuments.itemId, courseId: courseItems.courseId })
        .from(itemDocuments)
        .innerJoin(courseItems, eq(itemDocuments.itemId, courseItems.id))
        .where(or(eq(itemDocuments.sourceFileId, fileId), eq(itemDocuments.renderFileId, fileId)))
        .get();
      if (!doc) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      const access = canAccess(doc.courseId, user.id, doc.itemId);
      if (!access.allowed) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    } else if (record.kind === "certificate") {
      // Solo el estudiante dueño del certificado puede descargarlo
      const cert = db
        .select({ studentId: certificates.studentId })
        .from(certificates)
        .where(eq(certificates.pdfFileId, fileId))
        .get();
      if (!cert || cert.studentId !== user.id) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
    } else if (record.kind === "resource" || record.kind === "attachment") {
      // Recursos y adjuntos de tarea: matrícula + candado abierto. Descargar un
      // recurso lo marca como visto (completitud del ítem).
      const ref =
        record.kind === "resource" ? resourceItemForFile(fileId) : attachmentItemForFile(fileId);
      if (!ref) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      const access = canAccess(ref.courseId, user.id, ref.itemId);
      if (!access.allowed) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      if (record.kind === "resource") {
        try {
          markResourceDownloaded(ref.courseId, user.id, ref.itemId);
        } catch {
          /* la descarga no debe fallar por el registro de progreso */
        }
      }
    } else if (record.kind !== "cover" && record.kind !== "editor_image") {
      // Entregas propias
      if (record.kind === "submission" && record.uploadedBy !== user.id) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
      if (record.kind === "template_bg") {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
    }
  }

  // Maestros: solo los archivos de sus cursos (el admin conserva acceso total)
  if (user?.role === "teacher" && !teacherCanAccessFile(user.id, record)) {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }

  let absPath: string;
  try {
    absPath = absolutePathFor(record.storedPath);
  } catch {
    return NextResponse.json({ error: "Archivo inválido" }, { status: 400 });
  }
  if (!fs.existsSync(absPath)) {
    return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
  }

  const size = record.sizeBytes;
  const rangeHeader = request.headers.get("range");

  // Se VE en el navegador solo si el tipo es seguro (PDF, imágenes, video,
  // audio); lo demás (HTML, SVG…) se descarga. ?download=1 fuerza descarga.
  const inline = inlineAllowed(record.mimeType) && !request.nextUrl.searchParams.get("download");
  const baseHeaders: Record<string, string> = {
    "Content-Type": record.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    // El navegador no adivina el tipo: nunca interpreta un archivo como HTML o script
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
  };

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    let start: number;
    let end: number;
    if (!match[1] && match[2]) {
      // Suffix-range (bytes=-N): los ÚLTIMOS N bytes del archivo
      start = Math.max(0, size - parseInt(match[2], 10));
      end = size - 1;
    } else {
      start = match[1] ? parseInt(match[1], 10) : 0;
      end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
    }
    if (start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    const stream = fs.createReadStream(absPath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(absPath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
