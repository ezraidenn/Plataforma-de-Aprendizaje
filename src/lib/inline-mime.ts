/**
 * ¿Se puede servir este tipo `inline` (verse en el navegador) sin riesgo?
 * El tipo lo declara quien sube el archivo: un HTML o un SVG abierto en la
 * pestaña correría script en el origen de la app. Por eso solo PDF, imágenes
 * rasterizadas, video y audio se ven; todo lo demás se descarga.
 * (<img>/<video> ignoran Content-Disposition: logos y portadas se siguen viendo.)
 */
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/** Sin parámetros («; charset=…») y en minúsculas. */
const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

export function inlineAllowed(mime: string): boolean {
  const base = baseMime(mime);
  return INLINE_TYPES.has(base) || /^(video|audio)\/[a-z0-9][a-z0-9.+-]*$/.test(base);
}

/** Extensión del nombre neutro de una imagen del editor, según su tipo real. */
const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * `Content-Disposition` con que se sirve un archivo. Las imágenes del editor
 * (la foto y los íconos de las preguntas, las imágenes pegadas en un texto) van
 * SIN su nombre original: el alumno conoce su id (las fichas de ícono de
 * «Clasificar en grupos» y de «Arrastrar a la imagen») y un nombre como
 * «verduras-apio.png» le diría la respuesta. Salen como «imagen.<ext>» según su
 * tipo. Los demás archivos (documentos, entregas, certificados…) conservan el suyo.
 */
export function contentDisposition(
  file: { kind: string; mimeType: string; originalName: string },
  inline: boolean
): string {
  const mode = inline ? "inline" : "attachment";
  if (file.kind === "editor_image") {
    const ext = IMAGE_EXT[baseMime(file.mimeType)];
    return ext ? `${mode}; filename="imagen.${ext}"` : mode;
  }
  return `${mode}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
}
