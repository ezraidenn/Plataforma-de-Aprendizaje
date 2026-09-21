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

export function inlineAllowed(mime: string): boolean {
  // Sin parámetros («; charset=…») y en minúsculas
  const base = mime.split(";")[0].trim().toLowerCase();
  return INLINE_TYPES.has(base) || /^(video|audio)\/[a-z0-9][a-z0-9.+-]*$/.test(base);
}
