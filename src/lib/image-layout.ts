/**
 * Geometría de «arrastrar a la imagen»: tamaño efectivo de cada elemento,
 * cajas (con proporción y giro), píxeles con mínimos de legibilidad, límites
 * del dibujo de un ícono, y lugares y puntos recolocados al recortar o girar
 * la foto. Puro (sin DOM ni BD): lo usan el servidor, el alumno, el editor y
 * las pruebas. Coordenadas relativas a la foto: x en fracciones del ancho, y
 * en fracciones del alto; `aspect` = alto / ancho.
 */
import {
  DEFAULT_ICON_SIZE,
  DEFAULT_TEXT_SIZE,
  ICON_PX,
  ICON_SIZE_RANGE,
  SNAP_RADIUS,
  TEXT_SIZE_RANGE,
  clamp01,
  normalizeRotation,
  round4,
  validAspect,
  type IconSize,
  type ImageClickConfig,
  type ImageDragConfig,
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

/** Rectángulo de la foto: x y ancho en fracciones del ancho; y y alto, del alto. */
export type CropRect = { x: number; y: number; w: number; h: number };
type AnyConfig = ImageDragConfig | ImageClickConfig;

const inside = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const clampTo = (n: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, n));

/**
 * El tamaño de un elemento (el suyo o, si es de antes, el de `iconSize`)
 * multiplicado por `scale`, dentro de lo que el editor ofrece con una foto de
 * proporción `aspect`; `bound`: el tope que lo detuvo, si alguno.
 */
function rescaled(e: ImageElement, iconSize: IconSize | undefined, scale: number, aspect: number): { size: number; bound: "max" | "min" | null } {
  const range = e.kind === "icon" ? iconSizeRange(aspect) : TEXT_SIZE_RANGE;
  const raw = elementSize(e, iconSize) * scale;
  return { size: round4(clampTo(raw, range)), bound: raw > range[1] ? "max" : raw < range[0] ? "min" : null };
}

/** Los elementos con su tamaño ya escrito y escalado (`rescaled`). Su proporción y su giro no cambian. */
function scaledElements(c: ImageDragConfig, scale: number, aspect: number): ImageElement[] {
  return c.elements.map((e) => ({ ...e, size: rescaled(e, c.iconSize, scale, aspect).size }));
}

/**
 * Cuántos elementos se quedan en su tamaño máximo o mínimo al escalarlos por
 * `scale` con una foto nueva de proporción `aspect` (recortar: 1 / ancho del
 * recorte; girar: 1 / aspect de antes): se verán distintos que antes.
 */
export function boundSizes(c: ImageDragConfig, scale: number, aspect: number): { max: number; min: number } {
  const bounds = c.elements.map((e) => rescaled(e, c.iconSize, scale, aspect).bound);
  return { max: bounds.filter((b) => b === "max").length, min: bounds.filter((b) => b === "min").length };
}

/**
 * La config tras recortar la foto a `crop`: lugares (o puntos) recolocados
 * para seguir sobre lo mismo, los que quedan fuera quitados (y contados), y
 * tamaños que se ven igual sobre la foto (el ancho nuevo es `crop.w` del de
 * antes). Sin `iconSize`: cada elemento lleva el suyo.
 */
export function cropConfig(type: "image_drag" | "image_click", config: AnyConfig, crop: CropRect): { config: AnyConfig; removed: number } {
  const move = (p: Point): Point => ({ x: round4((p.x - crop.x) / crop.w), y: round4((p.y - crop.y) / crop.h) });
  const aspect = round4((crop.h / crop.w) * config.aspect);
  if (type === "image_click") {
    const c = config as ImageClickConfig;
    const spots = c.spots.map(move);
    const kept = spots.filter(inside);
    return { config: { ...c, aspect, spots: kept }, removed: spots.length - kept.length };
  }
  const c = config as ImageDragConfig;
  const zones = c.zones.map((z) => ({ ...z, ...move(z) }));
  const kept = zones.filter(inside);
  const { iconSize: _old, ...rest } = c;
  void _old;
  return {
    config: { ...rest, aspect, elements: scaledElements(c, 1 / crop.w, aspect), zones: kept },
    removed: zones.length - kept.length,
  };
}

/**
 * La config tras girar la foto 90° a la derecha (cw) o a la izquierda (ccw):
 * lugares y puntos girados con ella. Los elementos no giran (son símbolos que
 * deben verse derechos); el ancho nuevo es el alto de antes (ancho × aspect),
 * así que el mismo tamaño en píxeles es `size / aspect`.
 */
export function rotateConfig(type: "image_drag" | "image_click", config: AnyConfig, dir: "cw" | "ccw"): AnyConfig {
  const turn = (p: Point): Point => (dir === "cw" ? { x: round4(1 - p.y), y: round4(p.x) } : { x: round4(p.y), y: round4(1 - p.x) });
  const aspect = round4(1 / config.aspect);
  if (type === "image_click") {
    const c = config as ImageClickConfig;
    return { ...c, aspect, spots: c.spots.map(turn) };
  }
  const c = config as ImageDragConfig;
  const { iconSize: _old, ...rest } = c;
  void _old;
  return { ...rest, aspect, elements: scaledElements(c, 1 / c.aspect, aspect), zones: c.zones.map((z) => ({ ...z, ...turn(z) })) };
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

export type Guide = { axis: "x" | "y"; at: number };

const EPS = 1e-9;
const r9 = (n: number) => Math.round(n * 1e9) / 1e9;

/** La caja que envuelve a todas (al menos una). */
export function unionBounds(list: Bounds[]): Bounds {
  return {
    left: Math.min(...list.map((b) => b.left)),
    right: Math.max(...list.map((b) => b.right)),
    top: Math.min(...list.map((b) => b.top)),
    bottom: Math.max(...list.map((b) => b.bottom)),
  };
}

/** Líneas del imán en un eje: bordes y centro de la foto, de cada caja y, si hay, la cuadrícula. */
function guideLines(axis: "x" | "y", others: Bounds[], grid?: number | null): number[] {
  const out = [0, 0.5, 1];
  for (const o of others) out.push(...(axis === "x" ? [o.left, (o.left + o.right) / 2, o.right] : [o.top, (o.top + o.bottom) / 2, o.bottom]));
  if (grid) for (let v = grid; v < 1 - EPS; v += grid) out.push(r9(v));
  return out;
}

/**
 * Imán: cuánto mover `moving` para que su borde o centro (en cada eje) se pegue
 * al borde o centro más cercano de otra caja o de la foto (0, 0.5, 1), dentro
 * de los umbrales (en coordenadas de la foto). Devuelve el desplazamiento y las
 * guías que se ven tras pegar.
 */
export function snapMove(moving: Bounds, others: Bounds[], opts: { tx: number; ty: number; grid?: number | null }): { dx: number; dy: number; guides: Guide[] } {
  const lines = (axis: "x" | "y") => guideLines(axis, others, opts.grid);
  const best = (anchors: number[], targets: number[], t: number) => {
    let delta = 0;
    let dist = Infinity;
    for (const a of anchors) for (const g of targets) {
      const d = g - a;
      if (Math.abs(d) <= t && Math.abs(d) < dist) {
        dist = Math.abs(d);
        delta = d;
      }
    }
    return dist === Infinity ? null : r9(delta);
  };
  const xs = lines("x");
  const ys = lines("y");
  const ax = [moving.left, (moving.left + moving.right) / 2, moving.right];
  const ay = [moving.top, (moving.top + moving.bottom) / 2, moving.bottom];
  const dx = best(ax, xs, opts.tx) ?? 0;
  const dy = best(ay, ys, opts.ty) ?? 0;
  const guides: Guide[] = [];
  const seen = new Set<string>();
  const add = (axis: "x" | "y", at: number) => {
    const k = `${axis}${r9(at)}`;
    if (!seen.has(k)) {
      seen.add(k);
      guides.push({ axis, at: r9(at) });
    }
  };
  if (dx !== 0 || xs.some((g) => ax.some((a) => Math.abs(g - a) < EPS)))
    for (const a of ax) for (const g of xs) if (Math.abs(a + dx - g) < 1e-7) add("x", g);
  if (dy !== 0 || ys.some((g) => ay.some((a) => Math.abs(g - a) < EPS)))
    for (const a of ay) for (const g of ys) if (Math.abs(a + dy - g) < 1e-7) add("y", g);
  return { dx, dy, guides };
}

/**
 * Imán al estirar desde el centro: el factor que lleva el borde de `b` más
 * cercano a una línea del imán (las de `snapMove`) justo hasta ella, si está
 * dentro del umbral de su eje; null si ninguno. El centro no se mueve, así que
 * el borde de enfrente se mueve lo mismo. Entre ejes gana el más cercano en
 * proporción a su umbral (los dos umbrales son los mismos píxeles en pantalla).
 */
export function snapScale(
  b: Bounds,
  center: Point,
  others: Bounds[],
  opts: { tx: number; ty: number; grid?: number | null }
): { scale: number; guides: Guide[] } | null {
  const edges = [
    { axis: "x", at: b.left, half: center.x - b.left, sign: -1, t: opts.tx },
    { axis: "x", at: b.right, half: b.right - center.x, sign: 1, t: opts.tx },
    { axis: "y", at: b.top, half: center.y - b.top, sign: -1, t: opts.ty },
    { axis: "y", at: b.bottom, half: b.bottom - center.y, sign: 1, t: opts.ty },
  ] as const;
  let best: { rel: number; scale: number; guide: Guide } | null = null;
  for (const e of edges) {
    if (e.half <= EPS || e.t <= 0) continue;
    for (const g of guideLines(e.axis, others, opts.grid)) {
      const d = g - e.at;
      const rel = Math.abs(d) / e.t;
      if (rel > 1 || (best && rel >= best.rel)) continue;
      const scale = (e.half + e.sign * d) / e.half;
      if (scale > 0) best = { rel, scale: r9(scale), guide: { axis: e.axis, at: r9(g) } };
    }
  }
  return best && { scale: best.scale, guides: [best.guide] };
}

/** Centro pegado a la línea de cuadrícula más cercana. */
export function snapToGrid(p: Point, grid: number): Point {
  return { x: r9(Math.round(p.x / grid) * grid), y: r9(Math.round(p.y / grid) * grid) };
}

/**
 * Imán de un punto de «señalar» (no tiene caja): se pega a la línea de otro
 * punto, a los bordes y el centro de la foto y, con cuadrícula, a sus líneas.
 */
export function snapSpot(p: Point, others: Point[], opts: { tx: number; ty: number; grid?: number | null }): { p: Point; guides: Guide[] } {
  const box = (q: Point): Bounds => ({ left: q.x, right: q.x, top: q.y, bottom: q.y });
  const s = snapMove(box(p), others.map(box), opts);
  return { p: { x: clamp01(r9(p.x + s.dx)), y: clamp01(r9(p.y + s.dy)) }, guides: s.guides };
}

/** Zoom del lienzo del editor: los niveles de − y + (y sus topes). */
export const ZOOM_LEVELS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4] as const;
export const ZOOM_MIN = ZOOM_LEVELS[0];
export const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** El nivel siguiente (1) o anterior (−1), aunque el zoom esté entre dos niveles. */
export function zoomStep(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_LEVELS.find((l) => l > zoom + 1e-3) ?? ZOOM_MAX;
  return [...ZOOM_LEVELS].reverse().find((l) => l < zoom - 1e-3) ?? ZOOM_MIN;
}

/**
 * Ctrl+rueda: una muesca de la rueda del ratón va al nivel siguiente o al
 * anterior; los pasos finos (el pellizco del trackpad llega como Ctrl+rueda
 * con desplazamientos chicos) acercan o alejan poco a poco.
 */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  if (deltaY === 0) return zoom;
  if (deltaMode !== 0 || Math.abs(deltaY) >= 50) return zoomStep(zoom, deltaY < 0 ? 1 : -1);
  return Math.round(clampZoom(zoom * Math.exp(-deltaY / 100)) * 1e4) / 1e4;
}

/** Separación de la cuadrícula: cada 10 % de la foto, o cada 5 % desde el 200 %. */
export function gridStepFor(zoom: number): number {
  return zoom >= 2 - 1e-9 ? 0.05 : 0.1;
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Desplazamiento de cada caja para alinearlas con el borde o centro del conjunto. */
export function alignDeltas(boxes: Bounds[], mode: AlignMode): { dx: number; dy: number }[] {
  const L = Math.min(...boxes.map((b) => b.left));
  const R = Math.max(...boxes.map((b) => b.right));
  const T = Math.min(...boxes.map((b) => b.top));
  const B = Math.max(...boxes.map((b) => b.bottom));
  return boxes.map((b) => {
    switch (mode) {
      case "left": return { dx: r9(L - b.left), dy: 0 };
      case "right": return { dx: r9(R - b.right), dy: 0 };
      case "hcenter": return { dx: r9((L + R) / 2 - (b.left + b.right) / 2), dy: 0 };
      case "top": return { dx: 0, dy: r9(T - b.top) };
      case "bottom": return { dx: 0, dy: r9(B - b.bottom) };
      case "vcenter": return { dx: 0, dy: r9((T + B) / 2 - (b.top + b.bottom) / 2) };
    }
  });
}

/**
 * Repartir: el tramo va del principio de la primera caja al final de la que
 * más lejos llega (no siempre la última en empezar: una caja ancha puede
 * abarcar a otras); las cajas, en el orden en que empiezan, quedan con el
 * mismo espacio libre entre ellas dentro de ese tramo. `gap` es ese espacio
 * (para mostrarlo un momento); negativo si no caben (quien llama no reparte).
 */
export function distributeDeltas(boxes: Bounds[], axis: "x" | "y"): { deltas: { dx: number; dy: number }[]; gap: number } {
  const lo = (b: Bounds) => (axis === "x" ? b.left : b.top);
  const hi = (b: Bounds) => (axis === "x" ? b.right : b.bottom);
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => lo(p.b) - lo(q.b));
  const span = Math.max(...boxes.map(hi)) - lo(order[0].b);
  const sizes = order.reduce((s, p) => s + hi(p.b) - lo(p.b), 0);
  const gap = r9((span - sizes) / (order.length - 1));
  const deltas = boxes.map(() => ({ dx: 0, dy: 0 }));
  let cursor = lo(order[0].b);
  for (const p of order) {
    const d = r9(cursor - lo(p.b));
    deltas[p.i] = axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor += hi(p.b) - lo(p.b) + gap;
  }
  return { deltas, gap };
}
