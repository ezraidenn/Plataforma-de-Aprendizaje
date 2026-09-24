/**
 * Geometría de «arrastrar a la imagen»: tamaño efectivo de cada elemento,
 * cajas (con proporción y giro), píxeles con mínimos de legibilidad y límites
 * del dibujo de un ícono. Puro (sin DOM ni BD): lo usan el servidor, el
 * alumno, el editor y las pruebas. Coordenadas relativas a la foto: x en
 * fracciones del ancho, y en fracciones del alto; `aspect` = alto / ancho.
 */
import {
  DEFAULT_ICON_SIZE,
  DEFAULT_TEXT_SIZE,
  ICON_PX,
  ICON_SIZE_RANGE,
  SNAP_RADIUS,
  TEXT_SIZE_RANGE,
  normalizeRotation,
  validAspect,
  type IconSize,
  type ImageElement,
  type ImageItemView,
  type Point,
} from "./image-questions";

export { DEFAULT_ICON_SIZE, DEFAULT_TEXT_SIZE, ICON_SIZE_RANGE, TEXT_SIZE_RANGE, normalizeRotation };

/** Ancho de referencia con el que se pensaron los tamaños viejos (sm/md/lg en px). */
export const REF_WIDTH = 700;
/** Mínimos de legibilidad en pantallas chicas. */
export const MIN_ICON_PX = 24;
export const MIN_TEXT_PX = 11;

type Sized = Pick<ImageElement, "kind" | "size" | "ratio" | "rotation">;

/** Tamaño efectivo: el suyo; si es de antes, el de `iconSize` (íconos) o la letra por defecto (texto). */
export function elementSize(e: Pick<ImageElement, "kind" | "size">, iconSize?: IconSize): number {
  if (typeof e.size === "number" && Number.isFinite(e.size)) return e.size;
  if (e.kind === "text") return DEFAULT_TEXT_SIZE;
  return iconSize ? ICON_PX[iconSize] / REF_WIDTH : DEFAULT_ICON_SIZE;
}

/** Proporción (alto / ancho) del dibujo de un ícono; 1 para textos o si falta. */
export function elementRatio(e: Pick<ImageElement, "kind" | "ratio">): number {
  return e.kind === "icon" && validAspect(e.ratio) ? e.ratio : 1;
}

/** Un elemento tal como se dibuja: sin id, con tamaño, proporción y giro resueltos. */
export function elementView(e: ImageElement, iconSize?: IconSize): Required<Pick<ImageItemView, "kind" | "size" | "ratio" | "rotation">> & Pick<ImageItemView, "text" | "fileId"> {
  return {
    kind: e.kind,
    ...(e.kind === "text" ? { text: e.text } : { fileId: e.fileId }),
    size: elementSize(e, iconSize),
    ratio: elementRatio(e),
    rotation: typeof e.rotation === "number" && Number.isFinite(e.rotation) ? normalizeRotation(e.rotation) : 0,
  };
}

/** Caja de un ícono en píxeles de pantalla, sin bajar de MIN_ICON_PX en su lado corto. */
export function iconBoxPx(size: number, ratio: number, boardWidth: number): { w: number; h: number } {
  let w = size * (boardWidth > 0 ? boardWidth : REF_WIDTH);
  let h = w * ratio;
  const short = Math.min(w, h);
  if (short > 0 && short < MIN_ICON_PX) {
    w *= MIN_ICON_PX / short;
    h *= MIN_ICON_PX / short;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** Tamaño de letra en píxeles, sin bajar de MIN_TEXT_PX. */
export function textPx(size: number, boardWidth: number): number {
  return Math.max(MIN_TEXT_PX, Math.round(size * (boardWidth > 0 ? boardWidth : REF_WIDTH) * 10) / 10);
}

/** Radio de encaje de un elemento: el general o, si es grande, la mitad de su ancho. */
export function snapRadiusFor(size: number): number {
  return Math.max(SNAP_RADIUS, size / 2);
}

/** Caja relativa: centro, ancho (fracción del ancho), alto (fracción del alto), giro. */
export type Box = { cx: number; cy: number; w: number; h: number; rotation: number; aspect: number };
export type Bounds = { left: number; right: number; top: number; bottom: number };

/**
 * Caja de un elemento centrado en `center`. `sizePx` es su tamaño relativo al
 * ANCHO en ambos ejes (w = ancho/anchoFoto, h = alto/anchoFoto), como se mide en
 * pantalla; aquí el alto pasa a fracciones del alto de la foto.
 */
export function elementBox(center: Point, sizeRel: { w: number; h: number }, rotation: number, aspect: number): Box {
  return { cx: center.x, cy: center.y, w: sizeRel.w, h: sizeRel.h / aspect, rotation, aspect };
}

/** Caja envolvente (sin giro) de una caja girada, en coordenadas de la foto. */
export function boxBounds(b: Box): Bounds {
  const t = (b.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  // Se gira en unidades del ancho (los dos ejes en la misma escala) y se vuelve
  const w = b.w;
  const h = b.h * b.aspect;
  const W = w * c + h * s;
  const H = (w * s + h * c) / b.aspect;
  const r = (n: number) => Math.round(n * 1e9) / 1e9;
  return { left: r(b.cx - W / 2), right: r(b.cx + W / 2), top: r(b.cy - H / 2), bottom: r(b.cy + H / 2) };
}

/** Límites del dibujo en un RGBA (alfa > umbral); null si todo es transparente. */
export function alphaBounds(data: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 8): { x: number; y: number; w: number; h: number } | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
