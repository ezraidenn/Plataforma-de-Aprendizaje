/**
 * Preparación de imágenes en el navegador antes de subirlas (canvas → Blob).
 * Solo navegador: usa `createImageBitmap` y `document`. La geometría pura
 * (límites del dibujo) vive en image-layout.
 */
import { alphaBounds } from "./image-layout";
import { round4 } from "./image-questions";

/** Lado mayor máximo de un ícono guardado. */
export const MAX_ICON_SIDE = 800;

/** Un ícono listo para subir: el PNG, su proporción (alto / ancho) y su nombre. */
export type PreparedIcon = { blob: Blob; ratio: number; name: string };

/**
 * Ícono listo para subir: sin márgenes transparentes y con el lado mayor
 * hasta MAX_ICON_SIDE, en PNG (conserva la transparencia). Un JPG no tiene
 * transparencia: solo se reduce. Un GIF animado queda fijo. Si el dibujo es
 * más de diez veces más ancho que alto (o al revés), se completa con margen
 * transparente hasta esa proporción, la máxima que se acepta.
 *
 * null si la imagen es toda transparente (no hay dibujo). Lanza Error si el
 * navegador no la puede leer.
 */
export async function prepareIcon(file: File): Promise<PreparedIcon | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const src = document.createElement("canvas");
    src.width = bitmap.width;
    src.height = bitmap.height;
    const ctx = src.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No se pudo leer la imagen");
    ctx.drawImage(bitmap, 0, 0);
    let crop = { x: 0, y: 0, w: src.width, h: src.height };
    if (file.type !== "image/jpeg") {
      const box = alphaBounds(ctx.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
      if (!box) return null;
      crop = box;
    }
    const scale = Math.min(1, MAX_ICON_SIDE / Math.max(crop.w, crop.h));
    const w = Math.max(1, Math.round(crop.w * scale));
    const h = Math.max(1, Math.round(crop.h * scale));
    // Lienzo con la proporción dentro de lo aceptado; el dibujo, centrado
    const out = document.createElement("canvas");
    out.width = Math.max(w, Math.ceil(h / 10));
    out.height = Math.max(h, Math.ceil(w / 10));
    const octx = out.getContext("2d");
    if (!octx) throw new Error("No se pudo preparar la imagen");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(src, crop.x, crop.y, crop.w, crop.h, Math.floor((out.width - w) / 2), Math.floor((out.height - h) / 2), w, h);
    const blob = await new Promise<Blob>((ok, fail) =>
      out.toBlob((b) => (b ? ok(b) : fail(new Error("No se pudo preparar la imagen"))), "image/png")
    );
    const base = file.name.replace(/\.[^.]+$/, "") || "icono";
    return { blob, ratio: round4(out.height / out.width), name: `${base}.png` };
  } finally {
    bitmap.close();
  }
}
