/**
 * El rectángulo del recorte de la foto en el editor: tiradores, proporciones,
 * mover y agrandar o achicar con el teclado. Puro (sin DOM): lo usa
 * `image-photo-tools.tsx` y lo prueba `pnpm smoke:image`.
 *
 * Todo en coordenadas de la foto (`CropRect`: x y ancho en fracciones del
 * ancho; y y alto, del alto). Una proporción es alto / ancho en píxeles: con
 * la foto de proporción `aspect`, un rectángulo de ancho `w` la tiene si su
 * alto es `R · w / aspect`. El rectángulo nunca sale de la foto, no baja de
 * MIN_CROP por lado ni deja una foto más de MAX_CROP_RATIO veces más ancha que
 * alta (ni al revés), un poco menos del diez a uno que se acepta.
 *
 * También, en píxeles: el recorte redondeado que se hará de verdad
 * (`pixelRect`, `snapCrop`) y el tamaño de una foto reducida (`scaledSize`),
 * siempre dentro de ese diez a uno (`validAspect`).
 */
import type { CropRect } from "./image-layout";
import { MAX_ASPECT, clamp } from "./image-questions";

export type { CropRect };

/** Lo más chico que se deja recortar: esta fracción de cada lado de la foto. */
export const MIN_CROP = 0.05;
/** Lo más alargado que se deja el recorte (alto / ancho, o al revés): un poco adentro de lo que se acepta (MAX_ASPECT). */
export const MAX_CROP_RATIO = MAX_ASPECT - 0.01;
/** Lo que se acepta de verdad (`validAspect`), ya en píxeles enteros. */
const MAX_RATIO = MAX_ASPECT;
/** La foto entera: el recorte con el que se empieza. */
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type CropChoice = "free" | "original" | "1:1" | "4:3" | "16:9";

/** Proporción (alto / ancho) de una elección, en la orientación de la foto (una foto vertical recorta 3:4); null: libre. */
export function cropRatio(choice: CropChoice, aspect: number): number | null {
  const tall = aspect > 1;
  switch (choice) {
    case "free":
      return null;
    case "original":
      return aspect;
    case "1:1":
      return 1;
    case "4:3":
      return tall ? 4 / 3 : 3 / 4;
    case "16:9":
      return tall ? 16 / 9 : 9 / 16;
  }
}

const r9 = (n: number) => Math.round(n * 1e9) / 1e9;
const tidy = (r: CropRect): CropRect => ({ x: r9(r.x), y: r9(r.y), w: r9(r.w), h: r9(r.h) });

/** Es la foto entera (o casi): recortar no cambiaría nada. */
export function isFullCrop(r: CropRect): boolean {
  return r.x < 1e-3 && r.y < 1e-3 && r.w > 1 - 1e-3 && r.h > 1 - 1e-3;
}

/** Un rectángulo en píxeles enteros. */
export type PixelRect = { x: number; y: number; w: number; h: number };

/**
 * El recorte `r` en píxeles enteros de una imagen de W×H (al menos 1×1). Si
 * al redondear quedaría de más de diez a uno (o al revés), el lado corto se
 * agranda lo justo (1 px), sin salir de la imagen: la de W×H ya cumple.
 */
export function pixelRect(r: CropRect, W: number, H: number): PixelRect {
  let x = clamp(Math.round(r.x * W), 0, W - 1);
  let y = clamp(Math.round(r.y * H), 0, H - 1);
  let w = clamp(Math.round((r.x + r.w) * W) - x, 1, W - x);
  let h = clamp(Math.round((r.y + r.h) * H) - y, 1, H - y);
  if (h > MAX_RATIO * w) {
    w = Math.min(W, Math.ceil(h / MAX_RATIO));
    x = Math.min(x, W - w);
  }
  if (w > MAX_RATIO * h) {
    h = Math.min(H, Math.ceil(w / MAX_RATIO));
    y = Math.min(y, H - h);
  }
  return { x, y, w, h };
}

/** El recorte tal como se hará en una imagen de W×H: redondeado a píxeles, en fracciones otra vez. */
export function snapCrop(r: CropRect, W: number, H: number): CropRect {
  const p = pixelRect(r, W, H);
  return { x: p.x / W, y: p.y / H, w: p.w / W, h: p.h / H };
}

/**
 * Una imagen de w×h reducida a `scale`: el ancho redondeado y el alto
 * calculado desde él (no redondeados cada uno por su lado), sin pasar de diez
 * a uno.
 */
export function scaledSize(w: number, h: number, scale: number): { w: number; h: number } {
  const sw = Math.max(1, Math.round(w * scale));
  const sh = clamp(Math.round((sw * h) / w), Math.max(1, Math.ceil(sw / MAX_RATIO)), sw * MAX_RATIO);
  return { w: sw, h: sh };
}

/** El rectángulo de ancho `w` y alto `h` con centro en (cx, cy), corrido lo justo para quedar dentro de la foto. */
function centered(cx: number, cy: number, w: number, h: number): CropRect {
  return tidy({ x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h });
}

/** Límites del ancho de un rectángulo de proporción R (en px), dado el ancho y el alto que hay. */
function widthLimits(R: number, aspect: number, roomW: number, roomH: number): { min: number; max: number } {
  const max = Math.min(roomW, (roomH * aspect) / R);
  return { min: Math.min(max, Math.max(MIN_CROP, (MIN_CROP * aspect) / R)), max };
}

/**
 * Al elegir una proporción: el rectángulo más grande que la tiene dentro del
 * recorte de ahora, con su mismo centro (desde la foto entera: el más grande
 * de la foto, al centro). Nunca más chico que el mínimo.
 */
export function fitCropRatio(r: CropRect, R: number, aspect: number): CropRect {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const lim = widthLimits(R, aspect, 1, 1);
  const w = clamp(Math.min(r.w, (r.h * aspect) / R), lim.min, lim.max);
  return centered(cx, cy, w, (R * w) / aspect);
}

/** Mover el rectángulo entero, sin salir de la foto. */
export function moveCrop(r: CropRect, dx: number, dy: number): CropRect {
  return tidy({ ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) });
}

/** + y −: agrandar o achicar desde el centro, con su proporción, entre el mínimo y la foto entera. */
export function scaleCrop(r: CropRect, factor: number): CropRect {
  const f = clamp(factor, Math.max(MIN_CROP / r.w, MIN_CROP / r.h), Math.min(1 / r.w, 1 / r.h));
  return centered(r.x + r.w / 2, r.y + r.h / 2, r.w * f, r.h * f);
}

/**
 * Arrastrar un tirador desde el rectángulo `start` (d: lo que se movió el
 * puntero, en fracciones de la foto). Libre (R null): cada tirador mueve sus
 * lados; si la foto quedaría de más de MAX_CROP_RATIO a uno, el lado
 * arrastrado se detiene (en una esquina, se acorta el lado que sobra). Con proporción: la
 * esquina de enfrente queda fija y manda el lado que más se movió; un tirador
 * de lado cambia también el otro lado, desde el centro.
 */
export function resizeCrop(start: CropRect, handle: CropHandle, d: { dx: number; dy: number }, R: number | null, aspect: number): CropRect {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  if (R !== null) return tidy(resizeLocked(start, { west, east, north, south }, d, R, aspect));

  let left = start.x;
  let rgt = right;
  let top = start.y;
  let bot = bottom;
  if (west) left = clamp(left + d.dx, 0, rgt - MIN_CROP);
  if (east) rgt = clamp(rgt + d.dx, left + MIN_CROP, 1);
  if (north) top = clamp(top + d.dy, 0, bot - MIN_CROP);
  if (south) bot = clamp(bot + d.dy, top + MIN_CROP, 1);
  let w = rgt - left;
  let h = bot - top;
  const ratio = (h / w) * aspect;
  const corner = (west || east) && (north || south);
  const [lo, hi] = [1 / MAX_CROP_RATIO, MAX_CROP_RATIO];
  if (ratio > hi || ratio < lo) {
    const tooTall = ratio > hi;
    // Se ajusta el lado que se arrastra; en una esquina, se acorta el que sobra
    const fixWidth = corner ? !tooTall : west || east;
    if (fixWidth) {
      w = (h * aspect) / (tooTall ? hi : lo);
      if (west) left = rgt - w;
      else if (east) rgt = left + w;
      else left = (left + rgt) / 2 - w / 2;
    } else {
      h = (w * (tooTall ? hi : lo)) / aspect;
      if (north) top = bot - h;
      else if (south) bot = top + h;
      else top = (top + bot) / 2 - h / 2;
    }
  }
  return tidy({ x: left, y: top, w, h });
}

function resizeLocked(
  start: CropRect,
  side: { west: boolean; east: boolean; north: boolean; south: boolean },
  d: { dx: number; dy: number },
  R: number,
  aspect: number
): CropRect {
  const { west, east, north, south } = side;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  const candW = start.w + (east ? d.dx : west ? -d.dx : 0);
  const candH = start.h + (south ? d.dy : north ? -d.dy : 0);
  if ((west || east) && (north || south)) {
    // Esquina: la de enfrente queda fija; manda el lado que más cambió
    const fw = candW / start.w;
    const fh = candH / start.h;
    const f = Math.abs(fw - 1) >= Math.abs(fh - 1) ? fw : fh;
    const lim = widthLimits(R, aspect, east ? 1 - start.x : right, south ? 1 - start.y : bottom);
    const w = clamp(start.w * f, lim.min, lim.max);
    const h = (R * w) / aspect;
    return { x: east ? start.x : right - w, y: south ? start.y : bottom - h, w, h };
  }
  if (west || east) {
    // Lado izquierdo o derecho: el alto acompaña, centrado
    const lim = widthLimits(R, aspect, east ? 1 - start.x : right, 2 * Math.min(cy, 1 - cy));
    const w = clamp(candW, lim.min, lim.max);
    const h = (R * w) / aspect;
    return { x: east ? start.x : right - w, y: cy - h / 2, w, h };
  }
  // Lado de arriba o de abajo: el ancho acompaña, centrado
  const lim = widthLimits(R, aspect, 2 * Math.min(cx, 1 - cx), south ? 1 - start.y : bottom);
  const w = clamp((candH * aspect) / R, lim.min, lim.max);
  const h = (R * w) / aspect;
  return { x: cx - w / 2, y: south ? start.y : bottom - h, w, h };
}
