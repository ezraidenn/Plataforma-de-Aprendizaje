import { NextRequest, NextResponse } from "next/server";
import { apiUser } from "@/server/auth/guards";
import { saveStream, type FileKind } from "@/server/services/storage";
import { canEditBranding } from "@/server/services/profile";
import { EDITOR_IMAGE_MAX_BYTES, resolveUploadMime } from "@/lib/upload-types";

export const runtime = "nodejs";

const ALLOWED_KINDS: FileKind[] = [
  "course_source",
  "submission",
  "template_bg",
  "cover",
  "branding",
  "resource",
  "attachment",
  "editor_image",
  "assistant_attachment",
];

const MAX_BYTES: Record<string, number> = {
  course_source: 300 * 1024 * 1024, // PPT/PDF pesados
  submission: 25 * 1024 * 1024,
  template_bg: 20 * 1024 * 1024,
  cover: 10 * 1024 * 1024,
  branding: 6 * 1024 * 1024, // logo (2 MB, validado en servicio) o foto de portada (6 MB)
  resource: 200 * 1024 * 1024,
  attachment: 50 * 1024 * 1024,
  editor_image: EDITOR_IMAGE_MAX_BYTES,
  assistant_attachment: 10 * 1024 * 1024, // el servidor lo lee entero para resumirlo
};

/**
 * Subida con streaming directo a storage/ (el cuerpo nunca se buffer-ea completo).
 * Metadatos por headers: X-File-Name (URI-encoded), X-File-Kind.
 */
export async function POST(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const kind = (request.headers.get("x-file-kind") ?? "") as FileKind;
  if (!ALLOWED_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
  }

  // Estudiantes solo pueden subir entregas de tarea
  if (user.role === "student" && kind !== "submission") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  // Identidad (logo/portada): admin o maestro con permiso
  if (kind === "branding" && !canEditBranding(user)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const rawName = request.headers.get("x-file-name");
  if (!rawName) return NextResponse.json({ error: "Falta el nombre del archivo" }, { status: 400 });
  const originalName = decodeURIComponent(rawName);

  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  const maxBytes = MAX_BYTES[kind];
  if (contentLength > maxBytes) {
    return NextResponse.json(
      { error: `El archivo excede el límite de ${Math.round(maxBytes / 1024 / 1024)} MB` },
      { status: 413 }
    );
  }

  if (!request.body) return NextResponse.json({ error: "Cuerpo vacío" }, { status: 400 });

  // Cada clase admite ciertos tipos (imágenes, PDF/PPT…); el tipo guardado es
  // el que se usará al servirlo, así que no se acepta cualquier declaración
  const resolved = resolveUploadMime(kind, originalName, request.headers.get("content-type"));
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const mimeType = resolved.mime;

  try {
    const result = await saveStream({
      stream: request.body,
      originalName,
      mimeType,
      kind,
      uploadedBy: user.id,
    });
    return NextResponse.json({ fileId: result.id, sizeBytes: result.sizeBytes });
  } catch (err) {
    console.error("Error al guardar archivo:", err);
    return NextResponse.json({ error: "No se pudo guardar el archivo" }, { status: 500 });
  }
}
