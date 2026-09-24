/**
 * Preguntas sobre imagen: «arrastrar a la imagen» (image_drag) y «señalar en
 * la imagen» (image_click). Matemática pura (sin BD ni DOM), compartida por el
 * servidor, el navegador y las pruebas. Las coordenadas son relativas a la
 * foto (0–1); `aspect` = alto / ancho, para medir círculos y no óvalos.
 */

export type IconSize = "sm" | "md" | "lg";
export type Precision = "sm" | "md" | "lg";
export type Point = { x: number; y: number };

export type ImageElement = { id: string; kind: "icon" | "text"; fileId?: string; text?: string };
export type ImageZone = Point & { elementId: string };
export type ImageDragConfig = { aspect: number; iconSize: IconSize; elements: ImageElement[]; zones: ImageZone[] };
export type ImageClickConfig = { aspect: number; precision: Precision; spots: Point[] };

export const MAX_ELEMENTS = 20;
export const MAX_ZONES = 30;
export const MAX_SPOTS = 10;
export const MAX_LABEL = 60;

/** Lado del ícono en píxeles de pantalla, según el tamaño elegido. */
export const ICON_PX: Record<IconSize, number> = { sm: 40, md: 56, lg: 72 };
/** Radio de acierto al señalar, como fracción del ANCHO de la foto. */
export const PRECISION_RADIUS: Record<Precision, number> = { sm: 0.03, md: 0.05, lg: 0.08 };
/** Distancia (fracción del ancho) a la que un elemento soltado se encaja en una sombra. */
export const SNAP_RADIUS = 0.08;

const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
const validAspect = (a: unknown) => typeof a === "number" && Number.isFinite(a) && a >= 0.1 && a <= 10;

/** Distancia entre dos puntos relativos, en fracciones del ancho de la foto. */
export function relDistance(a: Point, b: Point, aspect: number): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
}

/** null = válida; si no, el primer problema (texto que ve el maestro). */
export function imageDragProblem(config: unknown, hasImage: boolean): string | null {
  if (!hasImage) return "Sube la foto de la pregunta";
  const c = config as Partial<ImageDragConfig> | null;
  if (!c || !Array.isArray(c.elements) || !Array.isArray(c.zones)) return "Configura la pregunta";
  if (!validAspect(c.aspect)) return "Vuelve a subir la foto";
  if (!["sm", "md", "lg"].includes(c.iconSize as string)) return "Elige el tamaño de los íconos";
  if (c.elements.length > MAX_ELEMENTS) return `Usa como máximo ${MAX_ELEMENTS} elementos`;
  const ids = new Set<string>();
  for (const e of c.elements) {
    if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id)) return "Hay elementos repetidos";
    ids.add(e.id);
    if (e.kind === "icon" && !e.fileId) return "Hay un ícono sin imagen";
    if (e.kind === "text" && !(e.text ?? "").trim()) return "Hay una etiqueta sin texto";
    if (e.kind === "text" && (e.text ?? "").trim().length > MAX_LABEL) return `Las etiquetas deben tener como máximo ${MAX_LABEL} caracteres`;
    if (e.kind !== "icon" && e.kind !== "text") return "Hay un elemento de un tipo desconocido";
  }
  if (c.zones.length === 0) return "Coloca al menos un elemento en la foto";
  if (c.zones.length > MAX_ZONES) return `Usa como máximo ${MAX_ZONES} lugares`;
  for (const z of c.zones) {
    if (!z || !unit(z.x) || !unit(z.y)) return "Hay un lugar fuera de la foto";
    if (!ids.has(z.elementId)) return "Hay un lugar de un elemento que ya no existe";
  }
  return null;
}

export function imageClickProblem(config: unknown, hasImage: boolean): string | null {
  if (!hasImage) return "Sube la foto de la pregunta";
  const c = config as Partial<ImageClickConfig> | null;
  if (!c || !Array.isArray(c.spots)) return "Configura la pregunta";
  if (!validAspect(c.aspect)) return "Vuelve a subir la foto";
  if (!["sm", "md", "lg"].includes(c.precision as string)) return "Elige la precisión";
  if (c.spots.length === 0) return "Marca al menos un punto en la foto";
  if (c.spots.length > MAX_SPOTS) return "Usa como máximo diez puntos";
  if (c.spots.some((s) => !s || !unit(s.x) || !unit(s.y))) return "Hay un punto fuera de la foto";
  return null;
}

/**
 * Las fichas del banco del alumno: una por cada lugar de un elemento, y una
 * para cada distractor. `copy` numera las copias del mismo elemento.
 */
export function dragCopies(config: ImageDragConfig): { elementId: string; elementIndex: number; copy: number }[] {
  return config.elements.flatMap((e, elementIndex) => {
    const n = Math.max(1, config.zones.filter((z) => z.elementId === e.id).length);
    return Array.from({ length: n }, (_, copy) => ({ elementId: e.id, elementIndex, copy }));
  });
}

/** Fracción 0–1 de lugares bien puestos. `placed[i]` = elemento puesto en el lugar i. */
export function imageDragScore(config: ImageDragConfig, placed: (string | undefined)[]): number {
  const n = config.zones.length;
  if (n === 0) return 0;
  let hits = 0;
  config.zones.forEach((z, i) => {
    if (placed[i] === z.elementId) hits++;
  });
  return hits / n;
}

/** Fracción 0–1 de puntos acertados. */
export function imageClickScore(config: ImageClickConfig, marks: Point[]): number {
  if (config.spots.length === 0) return 0;
  return imageClickHits(config, marks).filter(Boolean).length / config.spots.length;
}

/**
 * Qué puntos quedan acertados (uno por punto, en su orden). Cada marca acredita
 * como mucho un punto: emparejamiento máximo (con 10 puntos basta el de caminos
 * de aumento). Solo cuentan las primeras tantas marcas como puntos haya.
 */
export function imageClickHits(config: ImageClickConfig, marks: Point[]): boolean[] {
  const spots = config.spots;
  const used = marks.slice(0, spots.length);
  const r = PRECISION_RADIUS[config.precision];
  const reach = spots.map((s) => used.map((m, j) => (relDistance(s, m, config.aspect) <= r ? j : -1)).filter((j) => j >= 0));
  const markOf = new Array<number>(used.length).fill(-1);
  const augment = (i: number, seen: boolean[]): boolean => {
    for (const j of reach[i]) {
      if (seen[j]) continue;
      seen[j] = true;
      if (markOf[j] === -1 || augment(markOf[j], seen)) {
        markOf[j] = i;
        return true;
      }
    }
    return false;
  };
  // En este algoritmo un punto emparejado nunca se desempareja: su resultado es definitivo
  return spots.map((_, i) => augment(i, new Array<boolean>(used.length).fill(false)));
}

/** Sombra libre más cercana al punto dentro de SNAP_RADIUS, o null. */
export function nearestZone(zones: Point[], p: Point, aspect: number, isFree: (i: number) => boolean): number | null {
  let best: number | null = null;
  let bestD = SNAP_RADIUS;
  for (let i = 0; i < zones.length; i++) {
    if (!isFree(i)) continue;
    const d = relDistance(zones[i], p, aspect);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** `{ fichaDeLugar: fichaDeElemento }`; lo ilegible se descarta. */
export function parseDragAnswer(text: string | null | undefined): Record<string, string> {
  try {
    const raw = JSON.parse(text ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Marcas válidas (0–1), como mucho `max`. */
export function parseClickAnswer(text: string | null | undefined, max: number): Point[] {
  try {
    const raw = JSON.parse(text ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m): m is Point => !!m && unit((m as Point).x) && unit((m as Point).y))
      .slice(0, max)
      .map((m) => ({ x: m.x, y: m.y }));
  } catch {
    return [];
  }
}
