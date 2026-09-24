/**
 * Subida de un archivo a /api/uploads (streaming por body; metadatos por
 * headers). Solo cliente. Devuelve el fileId o lanza Error con mensaje legible.
 */
export type UploadKind = "course_source" | "submission" | "resource" | "attachment" | "cover" | "editor_image";

/** `accept` de los campos que suben imágenes del editor (las mismas que admite el servidor). */
export const EDITOR_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export async function uploadFile(file: File, kind: UploadKind): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Kind": kind,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
  } catch {
    throw new Error("No se pudo subir el archivo. Revisa tu conexión con el servidor.");
  }
  const data = (await res.json().catch(() => ({}))) as { fileId?: string; error?: string };
  if (!res.ok || !data.fileId) {
    throw new Error(data.error ?? "No se pudo subir el archivo. Revisa tu conexión con el servidor.");
  }
  return data.fileId;
}
