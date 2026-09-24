/**
 * Preparación de imágenes en el navegador antes de subirlas (canvas → Blob).
 * Solo navegador: usa `createImageBitmap` y `document`. La geometría pura
 * (límites del dibujo) vive en image-layout.
 */
import { alphaBounds } from "./image-layout";
import { round4 } from "./image-questions";

/** Lado mayor máximo de un ícono guardado. */
export const MAX_ICON_SIDE = 800;
/** Más píxeles que esto: se reduce antes de leerla (no hace falta leer cada píxel de una foto enorme). */
const MAX_READ_PIXELS = 16_000_000;
/** Lado de la versión chica con la que se revisa si un ícono ya subido tiene margen. */
const INSPECT_SIDE = 256;
/** Un ícono opaco que en PNG pesa más que esto (una foto, no una señal) se prueba también en JPEG. */
const PNG_HEAVY_BYTES = 150 * 1024;

/** Un ícono listo para subir. `trimmed`: se le quitó margen transparente. */
export type PreparedIcon = { blob: Blob; ratio: number; name: string; trimmed: boolean };
/** Lo que se sabe de un ícono ya subido: su proporción y si le sobra margen transparente. */
export type IconInspection = { ratio: number; margin: boolean };

type Rect = { x: number; y: number; w: number; h: number };

/** Proporción (alto / ancho) dentro de lo que se acepta: de 0.1 a 10. */
const clampRatio = (r: number) => Math.min(10, Math.max(0.1, r));
/** Lienzo de w×h con la proporción dentro de lo aceptado (se completa con margen transparente). */
const paddedSize = (w: number, h: number) => ({ w: Math.max(w, Math.ceil(h / 10)), h: Math.max(h, Math.ceil(w / 10)) });
/** Suelta la memoria de los lienzos sin esperar al recolector. */
function release(...canvases: HTMLCanvasElement[]) {
  for (const c of canvases) {
    c.width = 0;
    c.height = 0;
  }
}

/** Ningún píxel del rectángulo tiene transparencia. */
function opaqueWithin(data: Uint8ClampedArray, width: number, r: Rect): boolean {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) if (data[(y * width + x) * 4 + 3] < 255) return false;
  }
  return true;
}

/** El lienzo en el formato pedido. */
function encode(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg"): Promise<Blob> {
  return new Promise<Blob>((ok, fail) =>
    canvas.toBlob(
      (b) => (b ? ok(b) : fail(new Error("El navegador no exportó la imagen"))),
      type,
      type === "image/jpeg" ? 0.9 : undefined
    )
  );
}

/** Decodifica con la orientación de la foto; si es enorme, ya reducida. */
async function decode(blob: Blob): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const pixels = bitmap.width * bitmap.height;
  if (pixels <= MAX_READ_PIXELS) return bitmap;
  const k = Math.sqrt(MAX_READ_PIXELS / pixels);
  try {
    return await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * k)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * k)),
      resizeQuality: "high",
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Ícono listo para subir: sin márgenes transparentes y con el lado mayor
 * hasta MAX_ICON_SIDE. En PNG, que no mancha los colores planos de una señal;
 * un JPG sigue en JPEG 0.9, y un ícono opaco que en PNG pesa mucho (una foto)
 * se queda con el más chico de los dos. Un JPG no se lee píxel a píxel: solo se
 * reduce. Un GIF animado queda fijo. Si el dibujo es más de diez veces más
 * ancho que alto (o al revés), se completa con margen transparente hasta esa
 * proporción, la máxima que se acepta.
 *
 * null si la imagen es toda transparente (no hay dibujo). Lanza Error si el
 * navegador no la puede leer.
 */
export async function prepareIcon(file: File): Promise<PreparedIcon | null> {
  const bitmap = await decode(file);
  const read = document.createElement("canvas");
  const out = document.createElement("canvas");
  try {
    const { width, height } = bitmap;
    let crop: Rect = { x: 0, y: 0, w: width, h: height };
    let opaque = true;
    if (file.type !== "image/jpeg") {
      read.width = width;
      read.height = height;
      const ctx = read.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Sin contexto 2d para leer la imagen");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, width, height).data;
      const box = alphaBounds(data, width, height);
      if (!box) return null;
      crop = box;
      opaque = opaqueWithin(data, width, box);
    }
    const scale = Math.min(1, MAX_ICON_SIDE / Math.max(crop.w, crop.h));
    const w = Math.max(1, Math.round(crop.w * scale));
    const h = Math.max(1, Math.round(crop.h * scale));
    const size = paddedSize(w, h);
    out.width = size.w;
    out.height = size.h;
    const octx = out.getContext("2d");
    if (!octx) throw new Error("Sin contexto 2d para preparar la imagen");
    octx.imageSmoothingQuality = "high";
    // El recorte, directo del bitmap y centrado
    octx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, Math.floor((out.width - w) / 2), Math.floor((out.height - h) / 2), w, h);
    // Un margen añadido para la proporción es transparente: ahí no sirve JPEG
    const opaqueOut = opaque && out.width === w && out.height === h;
    let jpeg = opaqueOut && file.type === "image/jpeg";
    let blob = await encode(out, jpeg ? "image/jpeg" : "image/png");
    if (opaqueOut && !jpeg && blob.size > PNG_HEAVY_BYTES) {
      const lighter = await encode(out, "image/jpeg");
      if (lighter.size < blob.size) {
        blob = lighter;
        jpeg = true;
      }
    }
    const base = file.name.replace(/\.[^.]+$/, "") || "icono";
    const kept = paddedSize(crop.w, crop.h);
    return {
      blob,
      ratio: round4(out.height / out.width),
      name: `${base}.${jpeg ? "jpg" : "png"}`,
      trimmed: kept.w < width || kept.h < height,
    };
  } finally {
    bitmap.close();
    release(read, out);
  }
}

/**
 * Revisa un ícono ya subido: su proporción y si le sobra margen transparente
 * (sobre una versión chica: un margen de menos del 1 % no cuenta). Lanza
 * Error si el navegador no lo puede leer.
 */
export async function inspectIcon(blob: Blob): Promise<IconInspection> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    const ratio = round4(clampRatio(bitmap.height / bitmap.width));
    if (blob.type === "image/jpeg") return { ratio, margin: false };
    const k = Math.min(1, INSPECT_SIDE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { ratio, margin: false };
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const box = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    // Lo que quedaría tras recortar (con la proporción completada, si hace falta)
    const kept = box ? paddedSize(box.w, box.h) : null;
    return { ratio, margin: !!kept && (kept.w < canvas.width - 1 || kept.h < canvas.height - 1) };
  } finally {
    bitmap.close();
    release(canvas);
  }
}
