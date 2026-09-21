import { progressBetween } from "../scene-clock";

// ─── Barajar preguntas ────────────────────────────────────────────────────────

export const SHUFFLE_CYCLE_MS = 7000;
export const SHUFFLE_QUESTIONS = ["Clases de fuego", "Triángulo del fuego", "Extintor de CO₂", "Técnica PASS"] as const;
/** Órdenes que ven dos alumnos con el ajuste encendido (índices de SHUFFLE_QUESTIONS) */
const SHUFFLED: readonly (readonly number[])[] = [
  [2, 0, 3, 1],
  [1, 3, 0, 2],
];
const IN_ORDER: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [0, 1, 2, 3],
];

export type ShuffleState = {
  /** Orden de cada alumno (índices de SHUFFLE_QUESTIONS) */
  orders: readonly (readonly number[])[];
  mixed: boolean;
  /** Filas visibles (aparecen una a una al inicio) */
  revealed: number;
};

/** Aparecen las 4 preguntas; encendido: cada alumno las ve en otro orden (hasta el final del ciclo). */
export function shuffleStory(phase: number, shuffle: boolean): ShuffleState {
  const mixed = shuffle && phase >= 0.3;
  return {
    orders: mixed ? SHUFFLED : IN_ORDER,
    mixed,
    revealed: Math.min(4, Math.floor(progressBetween(phase, 0, 0.25) * 4 + 1e-9)),
  };
}

// ─── Preguntas por intento (pool) ─────────────────────────────────────────────

export const POOL_CYCLE_MS = 9000;
/** Máximo de tarjetas que se dibujan del banco */
export const POOL_MAX_CARDS = 20;
/** Dos órdenes fijos «al azar» de las 20 posiciones (uno por intento) */
const DRAW_ORDERS = [
  [3, 17, 8, 12, 0, 15, 6, 10, 19, 1, 13, 4, 9, 16, 2, 11, 18, 5, 14, 7],
  [11, 2, 16, 5, 19, 7, 13, 0, 9, 14, 4, 18, 1, 10, 6, 15, 3, 12, 17, 8],
] as const;

export type PoolState = { cards: number; attempt: 1 | 2; picked: number[]; target: number; allUsed: boolean };

/** Intento 1: salen N tarjetas del banco; intento 2: salen otras N. Sin límite (o N ≥ banco): todas. */
export function poolStory(phase: number, draw: number | null, bank: number): PoolState {
  const cards = Math.max(1, Math.min(POOL_MAX_CARDS, Math.round(bank)));
  const target = draw === null ? cards : Math.max(1, Math.min(cards, Math.round(draw)));
  const attempt: 1 | 2 = phase < 0.5 ? 1 : 2;
  const local = attempt === 1 ? phase * 2 : (phase - 0.5) * 2;
  const count = Math.min(target, Math.floor(progressBetween(local, 0.1, 0.6) * target + 1e-9));
  const order = DRAW_ORDERS[attempt - 1].filter((i) => i < cards);
  return { cards, attempt, picked: order.slice(0, count), target, allUsed: target >= cards };
}

// ─── Pregunta de texto abierto ────────────────────────────────────────────────

export const OPEN_CYCLE_MS = 8500;
export const OPEN_ANSWER = "Retirar el seguro, apuntar a la base del fuego, apretar la palanca y barrer de lado a lado.";

export type OpenQuestionState = { typed: number; sent: boolean; queue: number; rowVisible: boolean };

/** El alumno escribe → envía → su respuesta llega a «Por calificar» (el contador sube de 2 a 3). */
export function openQuestionStory(phase: number): OpenQuestionState {
  return {
    typed: Math.round(OPEN_ANSWER.length * progressBetween(phase, 0.03, 0.42)),
    sent: phase >= 0.5,
    queue: phase >= 0.6 ? 3 : 2,
    rowVisible: phase >= 0.6,
  };
}

// ─── Ordenar pasos ────────────────────────────────────────────────────────────

export const ORDERING_CYCLE_MS = 10_000;
export const ORDERING_STEPS = ["Jalar el seguro", "Apuntar a la base", "Presionar la palanca", "Barrer"] as const;

export type OrderingState = {
  /** Orden en pantalla, con el índice correcto de cada paso */
  order: number[];
  /** Paso que se está moviendo (índice correcto) o null */
  moving: number | null;
  /** Ya se muestra la calificación */
  graded: boolean;
  pairsOk: number;
  pairsTotal: number;
};

/** Pares consecutivos bien puestos (el mismo cálculo que la calificación real). */
function pairsOf(order: number[]): number {
  const pos = new Map(order.map((step, p) => [step, p]));
  let ok = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = pos.get(i);
    const b = pos.get(i + 1);
    if (a !== undefined && b === a + 1) ok++;
  }
  return ok;
}

/**
 * Revueltos → el alumno los acomoda → queda uno fuera de lugar («Jalar el
 * seguro» al final) y se ve el puntaje por pares: 2 de 3.
 */
export function orderingStory(phase: number): OrderingState {
  const frames: { at: number; order: number[]; moving: number | null }[] = [
    { at: 0, order: [2, 0, 3, 1], moving: null },
    { at: 0.16, order: [2, 0, 3, 1], moving: 1 },
    { at: 0.3, order: [2, 1, 0, 3], moving: 2 },
    { at: 0.46, order: [1, 2, 0, 3], moving: 3 },
    { at: 0.58, order: [1, 2, 3, 0], moving: null },
  ];
  const frame = [...frames].reverse().find((f) => phase >= f.at) ?? frames[0];
  return {
    order: frame.order,
    moving: frame.moving,
    graded: phase >= 0.68,
    pairsOk: pairsOf(frame.order),
    pairsTotal: ORDERING_STEPS.length - 1,
  };
}
