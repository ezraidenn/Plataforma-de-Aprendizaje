/**
 * Preguntas sobre imagen: «arrastrar a la imagen» (image_drag) y «señalar en
 * la imagen» (image_click). Matemática pura (sin BD ni DOM), compartida por el
 * servidor, el navegador y las pruebas. Las coordenadas son relativas a la
 * foto (0–1); `aspect` = alto / ancho, para medir círculos y no óvalos.
 */

export type IconSize = "sm" | "md" | "lg";
export type Precision = "sm" | "md" | "lg";
export type Point = { x: number; y: number };

export type ImageElement = {
  id: string;
  kind: "icon" | "text";
  fileId?: string;
  text?: string;
  /**
   * Como fracción del ancho de la foto: ícono, su LADO MAYOR (se ve igual de
   * grande con cualquier forma); texto, su tamaño de letra. Sin él, se deriva
   * (ver image-layout).
   */
  size?: number;
  /** Ícono: alto / ancho del dibujo. */
  ratio?: number;
  /** Giro en grados, (-180, 180]. */
  rotation?: number;
};
/** Un elemento de «arrastrar a la imagen» tal como se dibuja: sin su id. */
export type ImageItemView = Omit<ImageElement, "id">;
export type ImageZone = Point & {
  elementId: string;
  /**
   * Id estable del lugar (hasta MAX_ID caracteres): de él sale su ficha
   * (`zoneKey`), así la respuesta del alumno sigue a su lugar aunque el maestro
   * lo mueva o recorte o gire la foto. Las preguntas de antes no lo tienen: su
   * ficha sale de las coordenadas, y el editor, al abrirlas, les pone de clave
   * esas mismas coordenadas (la ficha no cambia).
   */
  key?: string;
};
export type ImageDragConfig = {
  aspect: number;
  /** Solo en preguntas anteriores al tamaño por elemento. */
  iconSize?: IconSize;
  elements: ImageElement[];
  zones: ImageZone[];
};
export type ImageClickConfig = { aspect: number; precision: Precision; spots: Point[] };

/** Los dos tipos de pregunta sobre imagen: único criterio, para no repetir la lista por todo el código. */
export const IMAGE_QUESTION_TYPES = ["image_drag", "image_click"] as const;
export type ImageQuestionType = (typeof IMAGE_QUESTION_TYPES)[number];
export function isImageQuestionType(t: string): t is ImageQuestionType {
  return (IMAGE_QUESTION_TYPES as readonly string[]).includes(t);
}

// Reglas de autoría (estos máximos, MIN_ZONE_GAP, validAspect y lo que piden
// imageDragProblem/imageClickProblem). readImageDrag/readImageClick las vuelven
// a aplicar al leer: endurecerlas invalida preguntas ya guardadas, que se
// leerían como «no se puede mostrar» y valdrían 0. Aflojarlas no rompe nada.
export const MAX_ELEMENTS = 20;
export const MAX_ZONES = 30;
export const MAX_SPOTS = 10;
export const MAX_LABEL = 60;
/** Largo máximo de un id (de elemento, de archivo o la clave de un lugar). */
const MAX_ID = 64;
/** Lo más alargada que se acepta una imagen (la foto o un ícono): diez veces más alta que ancha, o al revés. */
export const MAX_ASPECT = 10;
export const MIN_ASPECT = 1 / MAX_ASPECT;

/** Preguntas de antes: lado del ícono en px según su `iconSize`, sobre el ancho de referencia (REF_WIDTH, en image-layout). */
export const ICON_PX: Record<IconSize, number> = { sm: 40, md: 56, lg: 72 };
/** Radio de acierto al señalar, como fracción del ANCHO de la foto. */
export const PRECISION_RADIUS: Record<Precision, number> = { sm: 0.03, md: 0.05, lg: 0.08 };
/** Distancia (fracción del ancho) a la que un elemento soltado se encaja en una sombra. */
export const SNAP_RADIUS = 0.08;
/** Separación mínima entre dos lugares (fracción del ancho): más cerca, se enciman. */
export const MIN_ZONE_GAP = 0.04;

/** Tamaños por defecto de un elemento nuevo (fracción del ancho): lado mayor del ícono, el «mediano» de antes sobre 700 px; letra de 14 px. */
export const DEFAULT_ICON_SIZE = 0.08;
export const DEFAULT_TEXT_SIZE = 0.02;
export const ICON_SIZE_RANGE = [0.02, 0.5] as const;
export const TEXT_SIZE_RANGE = [0.01, 0.08] as const;
/** Grados a (-180, 180]. */
export function normalizeRotation(r: number): number {
  const x = ((r % 360) + 360) % 360;
  return x > 180 ? x - 360 : x;
}

const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
/** Proporción (alto / ancho) que se acepta: ni más de diez veces más ancha que alta, ni al revés. */
export const validAspect = (a: unknown): a is number =>
  typeof a === "number" && Number.isFinite(a) && a >= MIN_ASPECT && a <= MAX_ASPECT;

/** `n` entre `min` y `max`. */
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const clamp01 = (n: number) => clamp(n, 0, 1);

/**
 * De dónde sale la ficha de un lugar: su clave o, en una pregunta de antes sin
 * ella, sus coordenadas tal como están guardadas (el formato de siempre, así
 * las respuestas ya guardadas siguen valiendo). Dos lugares no pueden dar la
 * misma (lo revisa `imageDragProblem`).
 */
export const zoneKey = (z: Pick<ImageZone, "x" | "y" | "key">) => z.key ?? `${z.x},${z.y}`;

/** URL de un archivo subido (la foto o un ícono). */
export const fileUrl = (fileId: string) => `/api/files/${fileId}`;

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

/** El número (1, 2…) de cada punto en orden de lectura, en el orden en que llegan: «Lugar N» o «Punto N». */
export function readingNumbers(points: Point[], aspect: number): number[] {
  const out: number[] = [];
  readingOrder(
    points.map((p, i) => ({ x: p.x, y: p.y, i })),
    aspect
  ).forEach((p, n) => {
    out[p.i] = n + 1;
  });
  return out;
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
  if (c.iconSize !== undefined && !["sm", "md", "lg"].includes(c.iconSize as string)) return "La pregunta tiene un tamaño de íconos inválido";
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
    if (e.size !== undefined) {
      const [min, max] = e.kind === "icon" ? ICON_SIZE_RANGE : TEXT_SIZE_RANGE;
      if (typeof e.size !== "number" || !Number.isFinite(e.size) || e.size < min || e.size > max) return "Hay un elemento demasiado grande o demasiado chico";
    }
    if (e.kind === "icon" && e.ratio !== undefined && !validAspect(e.ratio)) return "Vuelve a subir un ícono";
    if (e.rotation !== undefined && (typeof e.rotation !== "number" || !Number.isFinite(e.rotation))) return "Hay un elemento con un giro inválido";
  }
  if (c.zones.length === 0) return "Coloca al menos un elemento en la foto";
  if (c.zones.length > MAX_ZONES) return `Usa como máximo ${MAX_ZONES} lugares`;
  // La clave es opcional (las preguntas de antes no la tienen); si viene, un texto corto
  const keys = new Set<string>();
  for (const z of c.zones) {
    if (!z || !unit(z.x) || !unit(z.y)) return "Hay un lugar fuera de la foto";
    if (!ids.has(z.elementId)) return "Hay un lugar de un elemento que ya no existe";
    if (z.key !== undefined && (typeof z.key !== "string" || !z.key || z.key.length > MAX_ID)) return "Hay un lugar con una clave inválida";
    // Dos lugares con la misma ficha: una respuesta acreditaría los dos
    const key = zoneKey(z);
    if (keys.has(key)) return "Hay lugares repetidos";
    keys.add(key);
  }
  if (overlapping(c.zones, c.aspect as number)) return OVERLAP_PROBLEM;
  return null;
}

/** Lo que dice la validación de dos lugares encimados (el editor lo dice con sus números: `overlapNumbers`). */
export const OVERLAP_PROBLEM = "Hay dos lugares encimados: sepáralos un poco";

/** Hay dos puntos a menos de MIN_ZONE_GAP. */
function overlapping(points: Point[], aspect: number): boolean {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (relDistance(points[i], points[j], aspect) < MIN_ZONE_GAP) return true;
    }
  }
  return false;
}

/** Los números de lectura («Lugar N») de los dos primeros lugares encimados, en orden de lectura; null si no hay. */
export function overlapNumbers(points: Point[], aspect: number): [number, number] | null {
  const numbers = readingNumbers(points, aspect);
  const byNumber = points.map((_, i) => i).sort((a, b) => numbers[a] - numbers[b]);
  for (let a = 0; a < byNumber.length; a++) {
    for (let b = a + 1; b < byNumber.length; b++) {
      const [i, j] = [byNumber[a], byNumber[b]];
      if (relDistance(points[i], points[j], aspect) < MIN_ZONE_GAP) return [numbers[i], numbers[j]];
    }
  }
  return null;
}

/** Cuatro decimales bastan (una décima de píxel en una foto de mil). */
export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Dónde dejar un lugar que se soltó en `p`: el mismo punto si queda a
 * MIN_ZONE_GAP o más de los demás; si no, el punto más cercano que sí, dentro
 * de la foto y empezando por el lado contrario al lugar con el que choca.
 * null si no hay sitio cerca (la foto está muy llena).
 */
export function freeSpot(p: Point, others: Point[], aspect: number): Point | null {
  const clear = (q: Point) => others.every((o) => relDistance(o, q, aspect) >= MIN_ZONE_GAP);
  if (clear(p)) return p;
  let near = others[0];
  for (const o of others) if (relDistance(o, p, aspect) < relDistance(near, p, aspect)) near = o;
  const away = Math.atan2((p.y - near.y) * aspect, p.x - near.x);
  // Anillos cada vez más amplios; en cada uno, del ángulo «hacia afuera» a los lados
  for (let ring = 1; ring <= 8; ring++) {
    const r = (MIN_ZONE_GAP / 2) * ring;
    const steps = 12 * ring;
    for (let k = 0; k < steps; k++) {
      const turn = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
      const a = away + (turn * 2 * Math.PI) / steps;
      const q = { x: round4(p.x + r * Math.cos(a)), y: round4(p.y + (r * Math.sin(a)) / aspect) };
      if (unit(q.x) && unit(q.y) && clear(q)) return q;
    }
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
  if (c.spots.length > MAX_SPOTS) return `Usa como máximo ${MAX_SPOTS} puntos`;
  if (c.spots.some((s) => !s || !unit(s.x) || !unit(s.y))) return "Hay un punto fuera de la foto";
  return null;
}

/**
 * Pregunta guardada → su foto y su config, o null si no está completa. Es el
 * único criterio para lo que ve el alumno, la calificación y la revisión.
 * Usa las mismas reglas que al guardar (ver la advertencia junto a MAX_ELEMENTS).
 */
export function readImageDrag(q: { imageFileId: string | null; config: unknown }): { image: string; config: ImageDragConfig } | null {
  if (imageDragProblem(q.config, !!q.imageFileId) || !q.imageFileId) return null;
  return { image: q.imageFileId, config: q.config as ImageDragConfig };
}

export function readImageClick(q: { imageFileId: string | null; config: unknown }): { image: string; config: ImageClickConfig } | null {
  if (imageClickProblem(q.config, !!q.imageFileId) || !q.imageFileId) return null;
  return { image: q.imageFileId, config: q.config as ImageClickConfig };
}

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
 * Archivos que nombra una config de «arrastrar a la imagen»: los de sus íconos
 * (la foto de fondo va aparte, en `imageFileId`). Acepta cualquier cosa: se
 * lee también de lo ya guardado, sin validar.
 */
export function imageDragFileIds(config: unknown): string[] {
  return list(record(config).elements).flatMap((e) => {
    const f = record(e).fileId;
    return typeof f === "string" && f ? [f] : [];
  });
}

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
  // El giro se sanea a la vez que se normaliza: undefined sigue undefined
  const rot = (v: unknown): number | undefined => {
    const n = finite(v);
    return n === undefined ? undefined : normalizeRotation(n);
  };
  return compact({
    aspect: finite(c.aspect),
    iconSize: size(c.iconSize),
    elements: list(c.elements).map((v) => {
      const e = record(v);
      const id = shortId(e.id);
      if (e.kind === "icon")
        return compact({ id, kind: "icon", fileId: shortId(e.fileId), size: finite(e.size), ratio: finite(e.ratio), rotation: rot(e.rotation) });
      if (e.kind === "text")
        return compact({ id, kind: "text", text: typeof e.text === "string" ? e.text.trim() : undefined, size: finite(e.size), rotation: rot(e.rotation) });
      return compact({ id });
    }),
    zones: list(c.zones).map((v) => {
      const z = record(v);
      // Una clave vacía se omite: el lugar se queda con la de sus coordenadas
      return compact({ ...point(v), elementId: shortId(z.elementId), key: shortId(z.key) || undefined });
    }),
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

/** Índice del lugar más cercano al punto dentro de `radius`, libre u ocupado; null si no hay. */
export function nearestZone(zones: Point[], p: Point, aspect: number, radius = SNAP_RADIUS): number | null {
  let best: number | null = null;
  let bestD = radius;
  for (let i = 0; i < zones.length; i++) {
    const d = relDistance(zones[i], p, aspect);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Respuesta en forma de mapa `{ ficha: ficha o texto }` (arrastrar a la
 * imagen, clasificar, completar); lo ilegible se descarta.
 */
export function parseMapAnswer(text: string | null | undefined): Record<string, string> {
  try {
    const raw = JSON.parse(text ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * `{ fichaDeLugar: fichaDeElemento }`; lo ilegible se descarta.
 * @deprecated Usa `parseMapAnswer`: es la misma lectura para todos los tipos con respuesta en mapa.
 */
export const parseDragAnswer = parseMapAnswer;

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
