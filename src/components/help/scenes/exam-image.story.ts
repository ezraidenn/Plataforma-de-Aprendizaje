import { imageClickHits, type Point, type Precision } from "@/lib/image-questions";
import { between } from "../scene-clock";

// ─── Arrastrar a la imagen ────────────────────────────────────────────────────

export const IMAGE_DRAG_CYCLE_MS = 10_000;

export type DragPiece = { kind: "icon" | "text"; label: string; /** Su lugar (índice de DRAG_ZONES) o null si es distractor */ zone: number | null };

/** Fichas del banco, en su orden: dos íconos, una etiqueta y un distractor. */
export const DRAG_PIECES: readonly DragPiece[] = [
  { kind: "icon", label: "Extintor", zone: 0 },
  { kind: "text", label: "Salida", zone: 1 },
  { kind: "icon", label: "Botiquín", zone: 2 },
  { kind: "text", label: "Elevador", zone: null },
];

/** Lugares sobre el plano, relativos a la foto (0–1): pasillo, salida de abajo y oficina. */
export const DRAG_ZONES: readonly Point[] = [
  { x: 0.6, y: 0.42 },
  { x: 0.52, y: 0.85 },
  { x: 0.18, y: 0.6 },
];

/** Lo que hace el alumno: toma una ficha y la suelta en su lugar. El tercer lugar queda vacío. */
const MOVES = [
  { piece: 0, zone: 0, at: 0.08 },
  { piece: 1, zone: 1, at: 0.38 },
] as const;
/** Desde que toma la ficha: sale hacia su lugar, el lugar se ilumina y encaja. */
const TRAVEL = 0.08;
const HOT = 0.15;
const DROP = 0.22;

/** Aspecto de un lugar libre: el círculo de reposo o la forma de la ficha en la mano. */
export type ShadowShape = "circle" | DragPiece["kind"];

export type ImageDragState = {
  /** Ficha en la mano (índice de DRAG_PIECES) o null */
  held: number | null;
  /** Lugar al que va la ficha en la mano (índice de DRAG_ZONES) o null */
  target: number | null;
  /** La ficha en la mano ya salió del banco hacia su lugar */
  travelling: boolean;
  /** Lugar iluminado: la ficha está encima y caería ahí */
  hot: number | null;
  /** Ficha puesta en cada lugar (índice de DRAG_PIECES) o null */
  placed: (number | null)[];
  /** Aspecto de cada lugar libre (null: ya tiene ficha) */
  shadows: (ShadowShape | null)[];
  graded: boolean;
  /** Cada lugar: ¿tiene la ficha que le toca? */
  correct: boolean[];
  ok: number;
  total: number;
};

/**
 * El plano con tres lugares idénticos. Toma el ícono: todos los lugares libres
 * toman la forma del ícono (su silueta); encaja. Toma la etiqueta: los libres
 * se vuelven píldoras; encaja. Al final, 2 de 3: el lugar vacío cuenta cero.
 */
export function imageDragStory(phase: number): ImageDragState {
  const placed: (number | null)[] = DRAG_ZONES.map(() => null);
  let held: number | null = null;
  let target: number | null = null;
  let travelling = false;
  let hot: number | null = null;
  for (const move of MOVES) {
    if (phase < move.at) break;
    const t = phase - move.at;
    if (t >= DROP) {
      placed[move.zone] = move.piece;
      continue;
    }
    held = move.piece;
    target = move.zone;
    travelling = t >= TRAVEL;
    hot = t >= HOT ? move.zone : null;
  }
  const shape: ShadowShape = held === null ? "circle" : DRAG_PIECES[held].kind;
  const correct = placed.map((piece, zone) => piece !== null && DRAG_PIECES[piece].zone === zone);
  return {
    held,
    target,
    travelling,
    hot,
    placed,
    shadows: placed.map((piece) => (piece === null ? shape : null)),
    graded: phase >= 0.7,
    correct,
    ok: correct.filter(Boolean).length,
    total: DRAG_ZONES.length,
  };
}

// ─── Señalar en la imagen ─────────────────────────────────────────────────────

export const IMAGE_CLICK_CYCLE_MS = 9000;
/** Alto / ancho del plano en la tarjeta del «?» (para medir los círculos como la calificación real). */
export const CLICK_ASPECT = 0.51;
export const CLICK_PRECISION: Precision = "md";
/** Las dos salidas del plano: abajo en el pasillo y a la derecha en el almacén. */
export const CLICK_SPOTS: readonly Point[] = [
  { x: 0.52, y: 0.85 },
  { x: 0.945, y: 0.6 },
];
/** Donde las pone el alumno: la primera en la salida, la segunda se queda corta. */
export const CLICK_MARKS: readonly Point[] = [
  { x: 0.53, y: 0.8 },
  { x: 0.85, y: 0.62 },
];

export type ImageClickState = {
  /** Marca hacia la que va el puntero (índice de CLICK_MARKS) */
  cursorAt: number;
  cursorVisible: boolean;
  pressed: boolean;
  /** Marcas puestas */
  marks: number;
  /** Ya se ven los círculos de acierto */
  revealed: boolean;
  /** Acierto de cada punto, con la misma regla que la calificación */
  hits: boolean[];
  graded: boolean;
  ok: number;
  total: number;
};

/**
 * El alumno pone sus dos marcas; luego aparecen los círculos de acierto: la
 * primera cae dentro (verde) y la segunda fuera (rojo). Resultado: 1 de 2.
 */
export function imageClickStory(phase: number): ImageClickState {
  const marks = phase >= 0.42 ? 2 : phase >= 0.2 ? 1 : 0;
  const hits = imageClickHits(
    { aspect: CLICK_ASPECT, precision: CLICK_PRECISION, spots: [...CLICK_SPOTS] },
    CLICK_MARKS.slice(0, marks)
  );
  return {
    cursorAt: phase >= 0.28 ? 1 : 0,
    cursorVisible: between(phase, 0.06, 0.5),
    pressed: between(phase, 0.17, 0.22) || between(phase, 0.39, 0.44),
    marks,
    revealed: phase >= 0.56,
    hits,
    graded: phase >= 0.68,
    ok: hits.filter(Boolean).length,
    total: CLICK_SPOTS.length,
  };
}
