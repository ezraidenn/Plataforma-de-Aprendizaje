/**
 * Pantalla de inicio del examen: el alumno repasa los datos (preguntas,
 * tiempo, intentos y mínimo) y al pulsar «Comenzar intento» arranca el reloj.
 */
export const EXAM_START_CYCLE_MS = 10_000;

/** Los cuatro datos que se repasan, en orden. */
export const EXAM_START_FACTS = [
  { label: "Preguntas", value: "5" },
  { label: "Tiempo límite", value: "10 min" },
  { label: "Intentos", value: "3" },
  { label: "Mínimo para aprobar", value: "80%" },
] as const;

export type ExamStartState = {
  /** Índice del dato resaltado (0–3) o null si ninguno */
  highlighted: number | null;
  /** El cursor ya llegó al botón */
  cursorAtButton: boolean;
  /** El botón está pulsado */
  pressed: boolean;
  /** El intento arrancó: el reloj corre */
  started: boolean;
};

const REVIEW_START = 0.08; // un respiro antes de empezar a repasar
const REVIEW_END = 0.66; // hasta aquí repasa los datos
const PRESS_AT = 0.86;

export function examStartStory(phase: number): ExamStartState {
  if (phase >= PRESS_AT) {
    return { highlighted: null, cursorAtButton: true, pressed: true, started: true };
  }
  if (phase >= 0.72) {
    return { highlighted: null, cursorAtButton: true, pressed: false, started: false };
  }
  if (phase >= REVIEW_END || phase < REVIEW_START) {
    return { highlighted: null, cursorAtButton: false, pressed: false, started: false };
  }
  // Repaso: cada dato ocupa su turno
  const turn = (REVIEW_END - REVIEW_START) / EXAM_START_FACTS.length;
  const index = Math.min(EXAM_START_FACTS.length - 1, Math.floor((phase - REVIEW_START) / turn));
  return { highlighted: index, cursorAtButton: false, pressed: false, started: false };
}
