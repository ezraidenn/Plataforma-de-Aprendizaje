/**
 * Qué tipo de archivo admite cada clase de subida. Puro: lo usa /api/uploads
 * y se prueba en `pnpm smoke:scope`.
 *
 * El tipo lo declara el navegador (cabecera Content-Type): se acepta si está
 * en la lista de esa clase. Si no manda tipo —pasa con .pptx en equipos sin
 * Office— se deduce por la extensión. Entregas, recursos y adjuntos admiten
 * cualquier archivo; solo se sanea el tipo. Al servirlos, /api/files manda
 * `nosniff` y solo muestra en línea tipos seguros (src/lib/inline-mime.ts).
 */

const PNG = "image/png";
const JPEG = "image/jpeg";
const WEBP = "image/webp";
const GIF = "image/gif";
const PDF = "application/pdf";
const PPT = "application/vnd.ms-powerpoint";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TXT = "text/plain";
const CSV = "text/csv";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS = "application/vnd.ms-excel";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC = "application/msword";
const ODS = "application/vnd.oasis.opendocument.spreadsheet";
const ODT = "application/vnd.oasis.opendocument.text";

const BY_EXTENSION: Record<string, string> = {
  png: PNG,
  jpg: JPEG,
  jpeg: JPEG,
  webp: WEBP,
  gif: GIF,
  pdf: PDF,
  ppt: PPT,
  pptx: PPTX,
  txt: TXT,
  csv: CSV,
  xlsx: XLSX,
  xls: XLS,
  docx: DOCX,
  doc: DOC,
  ods: ODS,
  odt: ODT,
};

/** Nombres alternativos que mandan algunos navegadores */
const ALIASES: Record<string, string> = {
  "image/jpg": JPEG,
  "image/pjpeg": JPEG,
  "application/x-pdf": PDF,
};

const RULES: Record<string, { allowed: string[]; error: string }> = {
  editor_image: { allowed: [PNG, JPEG, WEBP, GIF], error: "Solo imágenes PNG, JPG, WEBP o GIF" },
  branding: { allowed: [PNG, JPEG, WEBP], error: "Solo imágenes PNG, JPG o WEBP" },
  cover: { allowed: [PNG, JPEG, WEBP], error: "Solo imágenes PNG, JPG o WEBP" },
  template_bg: { allowed: [PDF, PNG, JPEG], error: "Solo PDF, PNG o JPG" },
  course_source: { allowed: [PDF, PPT, PPTX], error: "Solo PDF, PPT o PPTX" },
  // Adjunto del asistente: lo que el servidor sabe leer (o mirar, si es imagen)
  assistant_attachment: {
    allowed: [PDF, PNG, JPEG, WEBP, GIF, TXT, CSV, XLSX, XLS, DOCX, DOC, PPT, PPTX, ODS, ODT],
    error: "Solo Excel, CSV, Word, PDF, PowerPoint, texto o imágenes",
  },
};

function normalize(mime: string | null | undefined): string {
  const bare = (mime ?? "").split(";")[0].trim().toLowerCase();
  return ALIASES[bare] ?? bare;
}

function extensionMime(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

export type UploadMimeResult = { ok: true; mime: string } | { ok: false; error: string };

/** Tipo con el que se guarda el archivo, o por qué se rechaza. */
export function resolveUploadMime(
  kind: string,
  fileName: string,
  declared: string | null | undefined
): UploadMimeResult {
  const mime = normalize(declared);
  const unknown = mime === "" || mime === "application/octet-stream";
  const rule = RULES[kind];

  if (!rule) {
    // Cualquier archivo: se conserva el tipo si tiene forma válida
    if (!unknown && /^[a-z0-9]+\/[a-z0-9.+-]+$/.test(mime)) return { ok: true, mime };
    return { ok: true, mime: extensionMime(fileName) ?? "application/octet-stream" };
  }

  if (rule.allowed.includes(mime)) return { ok: true, mime };
  if (unknown) {
    const byName = extensionMime(fileName);
    if (byName && rule.allowed.includes(byName)) return { ok: true, mime: byName };
  }
  return { ok: false, error: rule.error };
}
