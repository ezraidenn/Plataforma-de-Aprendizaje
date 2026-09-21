/**
 * El alumno contesta el examen: cada respuesta se guarda sola, el reloj corre
 * y al terminar hay que confirmar el envío (no se puede deshacer).
 */
export const EXAM_RUN_CYCLE_MS = 12_000;
export const EXAM_RUN_TOTAL = 3;
/** Minutos del examen del ejemplo */
const LIMIT_SECONDS = 10 * 60;

export type ExamRunState = {
  stage: "answering" | "confirm" | "sent";
  /** Pregunta actual (1…EXAM_RUN_TOTAL) */
  index: number;
  /** Opción elegida (índice) o null si aún no responde */
  picked: number | null;
  /** «Guardado» visible */
  saved: boolean;
  /** Segundos que le quedan */
  secondsLeft: number;
  /** Preguntas ya respondidas */
  answered: number;
};

/** Turno de cada pregunta dentro de la fase de respuesta (0 → 0.6). */
const TURN = 0.6 / EXAM_RUN_TOTAL;

export function examRunStory(phase: number): ExamRunState {
  const secondsLeft = Math.max(0, Math.round(LIMIT_SECONDS * (1 - phase * 0.35)));

  if (phase >= 0.78) {
    return { stage: "sent", index: EXAM_RUN_TOTAL, picked: 1, saved: true, secondsLeft, answered: EXAM_RUN_TOTAL };
  }
  if (phase >= 0.6) {
    return { stage: "confirm", index: EXAM_RUN_TOTAL, picked: 1, saved: true, secondsLeft, answered: EXAM_RUN_TOTAL };
  }

  const turn = Math.min(EXAM_RUN_TOTAL - 1, Math.floor(phase / TURN));
  const local = (phase - turn * TURN) / TURN; // 0 → 1 dentro del turno
  const picked = local >= 0.35 ? turn % 2 : null;
  return {
    stage: "answering",
    index: turn + 1,
    picked,
    saved: local >= 0.55,
    secondsLeft,
    answered: turn + (picked !== null ? 1 : 0),
  };
}
