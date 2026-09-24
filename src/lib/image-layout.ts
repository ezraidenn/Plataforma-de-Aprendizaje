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

/** Un elemento tal como se dibuja: sin id, con tamaño, proporción y giro resueltos. */
export type ElementView = Pick<ImageItemView, "kind" | "text" | "fileId"> & { size: number; ratio: number; rotation: number };

/**
 * Tamaño efectivo (ícono: su lado mayor; texto: su letra). El suyo; si es de
 * antes, el de `iconSize` (íconos: eran tarjetas cuadradas, su lado es el lado
 * mayor) o la letra por defecto (texto).
 */
export function elementSize(e: Pick<ImageElement, "kind" | "size">, iconSize?: IconSize): number {
  if (typeof e.size === "number" && Number.isFinite(e.size)) return e.size;
  if (e.kind === "text") return DEFAULT_TEXT_SIZE;
  return iconSize ? ICON_PX[iconSize] / REF_WIDTH : DEFAULT_ICON_SIZE;
}

/** Proporción (alto / ancho) del dibujo de un ícono; 1 para textos o si falta. */
export function elementRatio(e: Pick<ImageElement, "kind" | "ratio">): number {
  return e.kind === "icon" && validAspect(e.ratio) ? e.ratio : 1;
}

/** La vista de un elemento; `iconSize` es el tamaño común de las preguntas de antes. */
export function elementView(e: ImageElement, iconSize?: IconSize): ElementView {
  return {
    kind: e.kind,
    ...(e.kind === "text" ? { text: e.text } : { fileId: e.fileId }),
    size: elementSize(e, iconSize),
    ratio: elementRatio(e),
    rotation: typeof e.rotation === "number" && Number.isFinite(e.rotation) ? normalizeRotation(e.rotation) : 0,
  };
}

/**
 * Caja de un ícono en píxeles de pantalla. `size` es su LADO MAYOR (fracción
 * del ancho de la foto): así un tamaño se ve igual de grande con cualquier
 * forma. El lado mayor no baja de MIN_ICON_PX (como en el banco).
 */
export function iconBoxPx(size: number, ratio: number, boardWidth: number): { w: number; h: number } {
  const long = Math.max(MIN_ICON_PX, size * (boardWidth > 0 ? boardWidth : REF_WIDTH));
  const short = (n: number) => Math.max(1, Math.round(n));
  return ratio <= 1 ? { w: Math.round(long), h: short(long * ratio) } : { w: short(long / ratio), h: Math.round(long) };
}

/**
 * Tamaños de ícono que el editor ofrece con una foto de esta proporción. El
 * lado mayor tampoco pasa del 90 % del alto de la foto: así el ícono cabe en
 * ella con cualquier giro. Solo acota en fotos muy apaisadas (alto menor que
 * 0.56 del ancho); en las demás manda ICON_SIZE_RANGE.
 */
export function iconSizeRange(aspect: number): readonly [number, number] {
  const [min, max] = ICON_SIZE_RANGE;
  const fits = validAspect(aspect) ? Math.floor(aspect * 0.9 * 1000) / 1000 : max;
  return [min, Math.max(min, Math.min(max, fits))];
}

/** En un tablero de este ancho, el elemento se ve más grande que su tamaño (al mínimo de legibilidad). */
export function shownAtMinimum(kind: ImageElement["kind"], size: number, boardWidth: number): boolean {
  if (boardWidth <= 0) return false;
  return size * boardWidth < (kind === "icon" ? MIN_ICON_PX : MIN_TEXT_PX);
}

/** Tamaño de letra en píxeles, sin bajar de MIN_TEXT_PX. */
export function textPx(size: number, boardWidth: number): number {
  return Math.max(MIN_TEXT_PX, Math.round(size * (boardWidth > 0 ? boardWidth : REF_WIDTH) * 10) / 10);
}

/** Radio de encaje de un elemento: el general o, si es grande, la mitad de su tamaño (en un ícono, de su lado mayor). */
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

/**
 * Dos cajas con giro (de la misma foto) se enciman: prueba de ejes
 * separadores sobre sus cuatro lados, en unidades del ancho (el alto por
 * `aspect`), donde el giro no deforma. Tocarse por un borde no cuenta.
 */
export function boxesOverlap(a: Box, b: Box): boolean {
  const axes = (k: Box) => {
    const t = (k.rotation * Math.PI) / 180;
    return [
      [Math.cos(t), Math.sin(t)],
      [-Math.sin(t), Math.cos(t)],
    ];
  };
  const corners = (k: Box) => {
    const [[ux, uy], [vx, vy]] = axes(k);
    const [hw, hh] = [k.w / 2, (k.h * k.aspect) / 2];
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([i, j]) => [k.cx + i * hw * ux + j * hh * vx, k.cy * k.aspect + i * hw * uy + j * hh * vy]);
  };
  const [ca, cb] = [corners(a), corners(b)];
  for (const [ax, ay] of [...axes(a), ...axes(b)]) {
    const pa = ca.map(([x, y]) => x * ax + y * ay);
    const pb = cb.map(([x, y]) => x * ax + y * ay);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
  }
  return true;
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
