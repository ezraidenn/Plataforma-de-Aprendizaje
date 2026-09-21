/**
 * Cola de «Por calificar»: se lee la entrega, se le ponen puntos y con
 * «Calificar y siguiente» sale de la cola y aparece la que sigue.
 */
export const GRADING_QUEUE_CYCLE_MS = 11_000;

export type PendingSubmission = { student: string; item: string };

export type GradingQueueState = {
  /** Entregas que quedan por calificar */
  pending: PendingSubmission[];
  /** Puntos escritos en la que está abierta */
  score: number | null;
  stage: "reading" | "scoring" | "saved";
  /** Cuántas se han calificado en el ciclo */
  done: number;
};

const QUEUE: PendingSubmission[] = [
  { student: "Ana Ruiz", item: "Croquis de extintores" },
  { student: "Luis Márquez", item: "Croquis de extintores" },
  { student: "Laura Pérez", item: "Plan de evacuación" },
];

/** Puntos que se le ponen a la entrega del ejemplo. */
const SCORE = 90;

export function gradingQueueStory(phase: number): GradingQueueState {
  // Lee la primera entrega de la cola
  if (phase < 0.22) {
    return { pending: QUEUE, score: null, stage: "reading", done: 0 };
  }
  // Escribe los puntos
  if (phase < 0.42) {
    return { pending: QUEUE, score: SCORE, stage: "scoring", done: 0 };
  }
  // «Calificar y siguiente»: sale de la cola
  if (phase < 0.6) {
    return { pending: QUEUE, score: SCORE, stage: "saved", done: 1 };
  }
  // Y aparece la siguiente, lista para calificar
  return { pending: QUEUE.slice(1), score: null, stage: "reading", done: 1 };
}
