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

/** Los dos tipos de pregunta sobre imagen: único criterio, para no repetir la lista por todo el código. */
export const IMAGE_QUESTION_TYPES = ["image_drag", "image_click"] as const;
export type ImageQuestionType = (typeof IMAGE_QUESTION_TYPES)[number];
export function isImageQuestionType(t: string): t is ImageQuestionType {
  return (IMAGE_QUESTION_TYPES as readonly string[]).includes(t);
}

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

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** URL de un archivo subido (la foto o un ícono). */
export const fileUrl = (fileId: string) => `/api/files/${fileId}`;

/** Lado de los íconos en un tablero de este ancho: el elegido, sin pasar del 12 % del ancho (celular). */
export function iconPx(size: IconSize, boardWidth: number): number {
  const px = ICON_PX[size];
  return boardWidth > 0 ? Math.max(24, Math.min(px, Math.round(boardWidth * 0.12))) : px;
}

/** Distancia entre dos puntos relativos, en fracciones del ancho de la foto. */
export function relDistance(a: Point, b: Point, aspect: number): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
}

/**
 * Orden de lectura de lugares o puntos: por filas de arriba abajo y, en cada
 * fila, de izquierda a derecha. Dos están en la misma fila si su altura no
 * difiere más de medio radio de encaje. Da la numeración «Lugar N» del alumno
 * y de la revisión, así que no depende del orden en que lleguen.
 */
export function readingOrder<T extends Point>(points: T[], aspect: number): T[] {
  const rows: T[][] = [];
  for (const p of [...points].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && (p.y - row[0].y) * aspect <= SNAP_RADIUS / 2) row.push(p);
    else rows.push([p]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.y - b.y));
}

/** «Ícono N» por archivo, en un orden fijo: el nombre no cambia con el barajado. */
export function iconNumbers(fileIds: (string | undefined)[]): Map<string, number> {
  const sorted = [...new Set(fileIds.filter((f): f is string => !!f))].sort();
  return new Map(sorted.map((f, i) => [f, i + 1]));
}

/** Nombre de un elemento para leerlo: su texto, o «Ícono N». */
export function imageItemName(item: Pick<ImageElement, "kind" | "text" | "fileId">, icons: Map<string, number>): string {
  if (item.kind === "text") return item.text ?? "";
  const n = item.fileId ? icons.get(item.fileId) : undefined;
  return n ? `Ícono ${n}` : "Ícono";
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
  // Dos elementos que se ven igual no se distinguen en el banco del alumno
  const looks = new Set<string>();
  for (const e of c.elements) {
    if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id)) return "Hay elementos repetidos";
    ids.add(e.id);
    // typeof antes de usarlos: la config puede venir de cualquier parte
    if (e.kind === "icon" && (typeof e.fileId !== "string" || !e.fileId)) return "Hay un ícono sin imagen";
    if (e.kind === "text") {
      const text = typeof e.text === "string" ? e.text.trim() : "";
      if (!text) return "Hay una etiqueta sin texto";
      if (text.length > MAX_LABEL) return `Las etiquetas deben tener como máximo ${MAX_LABEL} caracteres`;
    }
    if (e.kind !== "icon" && e.kind !== "text") return "Hay un elemento de un tipo desconocido";
    const look = e.kind === "icon" ? `i:${e.fileId}` : `t:${(e.text as string).trim().toLowerCase()}`;
    if (looks.has(look)) return "Hay dos elementos iguales: deja uno y colócalo en varios lugares";
    looks.add(look);
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
 * Pregunta guardada → su foto y su config, o null si no está completa. Es el
 * único criterio para lo que ve el alumno, la calificación y la revisión.
 */
export function readImageDrag(q: { imageFileId: string | null; config: unknown }): { image: string; config: ImageDragConfig } | null {
  if (imageDragProblem(q.config, !!q.imageFileId) || !q.imageFileId) return null;
  return { image: q.imageFileId, config: q.config as ImageDragConfig };
}

export function readImageClick(q: { imageFileId: string | null; config: unknown }): { image: string; config: ImageClickConfig } | null {
  if (imageClickProblem(q.config, !!q.imageFileId) || !q.imageFileId) return null;
  return { image: q.imageFileId, config: q.config as ImageClickConfig };
}

const MAX_ID = 64;
const SIZES = ["sm", "md", "lg"];
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const shortId = (v: unknown): string | undefined => (typeof v === "string" && v.length <= MAX_ID ? v : undefined);
const size = (v: unknown): string | undefined => (typeof v === "string" && SIZES.includes(v) ? v : undefined);
/** Sin las claves en undefined: lo que se guarda queda limpio. */
const compact = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const point = (v: unknown) => {
  const p = record(v);
  return compact({ x: finite(p.x), y: finite(p.y) });
};

/**
 * Config que llega del navegador → solo los campos conocidos, con su tipo
 * (íconos sin texto, etiquetas sin archivo, ids cortos, números finitos). Lo
 * que no cuadra se omite y lo señala la validación; aquí no se decide si la
 * pregunta está completa.
 */
export function sanitizeImageConfig(type: "image_drag" | "image_click", raw: unknown): unknown {
  const c = record(raw);
  if (type === "image_click") {
    return compact({ aspect: finite(c.aspect), precision: size(c.precision), spots: list(c.spots).map(point) });
  }
  return compact({
    aspect: finite(c.aspect),
    iconSize: size(c.iconSize),
    elements: list(c.elements).map((v) => {
      const e = record(v);
      const id = shortId(e.id);
      if (e.kind === "icon") return compact({ id, kind: "icon", fileId: shortId(e.fileId) });
      if (e.kind === "text") return compact({ id, kind: "text", text: typeof e.text === "string" ? e.text.trim() : undefined });
      return compact({ id });
    }),
    zones: list(c.zones).map((v) => compact({ ...point(v), elementId: shortId(record(v).elementId) })),
  });
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
