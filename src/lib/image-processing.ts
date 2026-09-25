/**
 * Preparación de imágenes en el navegador antes de subirlas (canvas → Blob):
 * íconos sin márgenes transparentes, y la foto de fondo recortada o girada.
 * Solo navegador: usa `createImageBitmap` y `document`. La geometría pura
 * (límites del dibujo, recolocar lugares) vive en image-layout.
 */
import { alphaBounds, type CropRect } from "./image-layout";
import { round4 } from "./image-questions";
import { pixelRect, scaledSize } from "./photo-crop";
import { EDITOR_IMAGE_MAX_BYTES } from "./upload-types";

/** Lado mayor máximo de un ícono guardado. */
export const MAX_ICON_SIDE = 800;
/** Máximo que acepta la subida (una imagen del editor). */
export const MAX_UPLOAD_BYTES = EDITOR_IMAGE_MAX_BYTES;
/** Lo más grande que sale una foto recortada o girada: más, se reduce (memoria; Safari en iPhone no pasa de ~16 MP). */
export const MAX_PHOTO_PIXELS = 16_000_000;
/** Cada cuántos píxeles (en cada eje) se mira si la foto tiene transparencia. */
const ALPHA_STRIDE = 16;
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

/** El lienzo en el formato pedido (JPEG, con esa calidad). */
function encode(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality = 0.9): Promise<Blob> {
  return new Promise<Blob>((ok, fail) =>
    canvas.toBlob(
      (b) => (b ? ok(b) : fail(new Error("El navegador no exportó la imagen"))),
      type,
      type === "image/jpeg" ? quality : undefined
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

/** Una operación sobre la foto de fondo: recortarla a un rectángulo relativo o girarla 90°. */
export type PhotoOp = { crop: CropRect } | { rotate: "cw" | "ccw" };
/**
 * La foto transformada, lista para subir. `aspect`: alto / ancho del
 * resultado. `crop`: el recorte hecho de verdad (a píxeles enteros, relativo a
 * la foto de antes): con él se recolocan lugares y puntos.
 */
export type TransformedPhoto = { blob: Blob; aspect: number; name: string; crop?: CropRect };

/** Algún píxel con transparencia, mirando uno de cada ALPHA_STRIDE en cada eje (y la última fila y columna). */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const rows = new Set<number>([height - 1]);
  for (let y = 0; y < height; y += ALPHA_STRIDE) rows.add(y);
  for (const y of rows) {
    // Fila por fila: una foto grande no se copia entera a la memoria
    const data = ctx.getImageData(0, y, width, 1).data;
    if (data[(width - 1) * 4 + 3] < 255) return true;
    for (let x = 0; x < width; x += ALPHA_STRIDE) if (data[x * 4 + 3] < 255) return true;
  }
  return false;
}

/** Un problema con un mensaje para el maestro (no uno técnico del navegador): se muestra tal cual. */
export class PhotoError extends Error {}

/** Decodifica con la orientación de la foto; si el navegador no acepta esa opción, sin ella (la proporción se revisa después). */
async function decodeOriented(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(blob);
  }
}

/**
 * Recorta o gira 90° la foto, a su resolución (hasta MAX_PHOTO_PIXELS: si el
 * trozo pasa de ahí, sale reducido). El recorte se redondea a píxeles como
 * `pixelRect` (sin pasar de diez a uno). Formato: un PNG sigue en PNG si cabe
 * (un plano o un diagrama no se ensucia); si no, JPEG 0.9, salvo que tenga
 * transparencia (PNG). Si pasa de MAX_UPLOAD_BYTES: JPEG 0.8 (sin
 * transparencia) y luego cada vez al 85 % hasta que quepa, el alto calculado
 * desde el ancho (`scaledSize`). El nombre es el de la foto con «-recorte» o
 * «-girada». `aspect`: la proporción con la que se ve en el editor; si la
 * foto leída no cuadra con ella (más de un 1 %: orientación EXIF que el
 * navegador no aplicó), no se toca. Lanza PhotoError con un mensaje para el
 * maestro, o Error si el navegador no la puede leer o exportar.
 */
export async function transformPhoto(
  src: Blob,
  op: PhotoOp,
  { name = src instanceof File ? src.name : "foto", aspect }: { name?: string; aspect?: number } = {}
): Promise<TransformedPhoto> {
  const bitmap = await decodeOriented(src);
  const canvas = document.createElement("canvas");
  const smaller = document.createElement("canvas");
  try {
    const { width: W, height: H } = bitmap;
    if (aspect && Math.abs(H / W / aspect - 1) > 0.01) {
      throw new PhotoError(
        "La foto no se leyó con la forma que se ve en el editor (su orientación no cuadra): recórtala o gírala en tu equipo y súbela con «Cambiar foto»."
      );
    }
    const rect = "crop" in op ? pixelRect(op.crop, W, H) : { x: 0, y: 0, w: W, h: H };
    const turn = "rotate" in op ? op.rotate : null;
    // Lo que sale, reducido desde el principio si pasa de MAX_PHOTO_PIXELS
    const k = Math.min(1, Math.sqrt(MAX_PHOTO_PIXELS / (rect.w * rect.h)));
    const size = k < 1 ? scaledSize(rect.w, rect.h, k) : { w: rect.w, h: rect.h };
    canvas.width = turn ? size.h : size.w;
    canvas.height = turn ? size.w : size.h;
    // Un JPEG no tiene transparencia: ni se lee. Lo demás, sin la tarjeta gráfica (se lee más rápido)
    const mayBeClear = src.type !== "image/jpeg";
    const ctx = canvas.getContext("2d", { willReadFrequently: mayBeClear });
    if (!ctx) throw new Error("Sin contexto 2d para preparar la foto");
    ctx.imageSmoothingQuality = "high";
    if (turn) {
      // A la derecha, (x, y) → (alto − y, x); a la izquierda, (x, y) → (y, ancho − x)
      const cw = turn === "cw";
      ctx.translate(cw ? size.h : 0, cw ? 0 : size.w);
      ctx.rotate(cw ? Math.PI / 2 : -Math.PI / 2);
    }
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, size.w, size.h);
    const clear = () => mayBeClear && hasTransparency(ctx, canvas.width, canvas.height);
    let type: "image/png" | "image/jpeg" = src.type === "image/png" || clear() ? "image/png" : "image/jpeg";
    let quality = 0.9;
    let blob = await encode(canvas, type, quality);
    // Un PNG que no cabe: sin transparencia, pasa a JPEG
    if (blob.size > MAX_UPLOAD_BYTES && type === "image/png" && src.type === "image/png" && !clear()) {
      type = "image/jpeg";
      blob = await encode(canvas, type, quality);
    }
    if (blob.size > MAX_UPLOAD_BYTES && type === "image/jpeg") {
      quality = 0.8;
      blob = await encode(canvas, type, quality);
    }
    let out = canvas;
    for (let scale = 0.85; blob.size > MAX_UPLOAD_BYTES; scale *= 0.85) {
      if (scale < 0.05) throw new PhotoError("La foto quedó demasiado pesada: usa una más ligera.");
      const s = scaledSize(canvas.width, canvas.height, scale);
      smaller.width = s.w;
      smaller.height = s.h;
      const sctx = smaller.getContext("2d");
      if (!sctx) throw new Error("Sin contexto 2d para reducir la foto");
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(canvas, 0, 0, s.w, s.h);
      out = smaller;
      blob = await encode(smaller, type, quality);
    }
    const base = name.replace(/\.[^.]+$/, "").replace(/-(recorte|girada)$/, "") || "foto";
    return {
      blob,
      aspect: round4(out.height / out.width),
      name: `${base}-${turn ? "girada" : "recorte"}.${type === "image/png" ? "png" : "jpg"}`,
      ...(turn ? {} : { crop: { x: rect.x / W, y: rect.y / H, w: rect.w / W, h: rect.h / H } }),
    };
  } finally {
    bitmap.close();
    release(canvas, smaller);
  }
}
