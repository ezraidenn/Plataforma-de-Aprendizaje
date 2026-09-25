/**
 * Preparación de imágenes en el navegador antes de subirlas (canvas → Blob):
 * íconos sin márgenes transparentes, y la foto de fondo recortada o girada.
 * Solo navegador: usa `createImageBitmap` y `document`. La geometría pura
 * (límites del dibujo, recolocar lugares) vive en image-layout.
 */
import { alphaBounds, type CropRect } from "./image-layout";
import { round4 } from "./image-questions";

/** Lado mayor máximo de un ícono guardado. */
export const MAX_ICON_SIDE = 800;
/** Máximo que acepta la subida (una imagen del editor). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
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

/** Un rectángulo relativo en píxeles enteros de una imagen de W×H (al menos 1×1). */
function pixelRect(r: CropRect, W: number, H: number) {
  const x = Math.min(W - 1, Math.max(0, Math.round(r.x * W)));
  const y = Math.min(H - 1, Math.max(0, Math.round(r.y * H)));
  const right = Math.min(W, Math.max(x + 1, Math.round((r.x + r.w) * W)));
  const bottom = Math.min(H, Math.max(y + 1, Math.round((r.y + r.h) * H)));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Recorta (a la resolución original) o gira 90° la foto. Sale en JPEG 0.9 si
 * no tiene transparencia; si la tiene, en PNG. Si pasa de MAX_UPLOAD_BYTES:
 * JPEG 0.8 (sin transparencia) y luego cada vez al 85 % hasta que quepa. El
 * nombre es el de la foto con «-recorte» o «-girada». Lanza Error si el
 * navegador no la puede leer o exportar.
 */
export async function transformPhoto(src: Blob, op: PhotoOp, name = src instanceof File ? src.name : "foto"): Promise<TransformedPhoto> {
  const bitmap = await createImageBitmap(src, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  const smaller = document.createElement("canvas");
  try {
    const { width: W, height: H } = bitmap;
    const rect = "crop" in op ? pixelRect(op.crop, W, H) : null;
    canvas.width = rect ? rect.w : H;
    canvas.height = rect ? rect.h : W;
    // Un JPEG no tiene transparencia: ni se lee. Lo demás, sin la tarjeta gráfica (se lee más rápido)
    const mayBeClear = src.type !== "image/jpeg";
    const ctx = canvas.getContext("2d", { willReadFrequently: mayBeClear });
    if (!ctx) throw new Error("Sin contexto 2d para preparar la foto");
    if (rect) ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    else if ("rotate" in op) {
      // A la derecha, (x, y) → (H − y, x); a la izquierda, (x, y) → (y, W − x)
      const cw = op.rotate === "cw";
      ctx.translate(cw ? H : 0, cw ? 0 : W);
      ctx.rotate(cw ? Math.PI / 2 : -Math.PI / 2);
      ctx.drawImage(bitmap, 0, 0);
    }
    const clear = mayBeClear && hasTransparency(ctx, canvas.width, canvas.height);
    const type = clear ? "image/png" : "image/jpeg";
    let quality = 0.9;
    let out = canvas;
    let blob = await encode(canvas, type, quality);
    if (blob.size > MAX_UPLOAD_BYTES && !clear) {
      quality = 0.8;
      blob = await encode(canvas, type, quality);
    }
    for (let scale = 0.85; blob.size > MAX_UPLOAD_BYTES; scale *= 0.85) {
      if (scale < 0.05) throw new Error("La foto quedó demasiado pesada: usa una más ligera");
      smaller.width = Math.max(1, Math.round(canvas.width * scale));
      smaller.height = Math.max(1, Math.round(canvas.height * scale));
      const sctx = smaller.getContext("2d");
      if (!sctx) throw new Error("Sin contexto 2d para reducir la foto");
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      out = smaller;
      blob = await encode(smaller, type, quality);
    }
    const base = name.replace(/\.[^.]+$/, "").replace(/-(recorte|girada)$/, "") || "foto";
    return {
      blob,
      aspect: round4(out.height / out.width),
      name: `${base}-${rect ? "recorte" : "girada"}.${clear ? "png" : "jpg"}`,
      ...(rect ? { crop: { x: rect.x / W, y: rect.y / H, w: rect.w / W, h: rect.h / H } } : {}),
    };
  } finally {
    bitmap.close();
    release(canvas, smaller);
  }
}
