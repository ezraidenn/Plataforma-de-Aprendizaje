/**
 * Preguntas abiertas: el maestro pone los puntos, el intento queda calificado
 * y al alumno le llega el aviso… salvo que los resultados aún estén ocultos,
 * en cuyo caso el aviso espera a que los publique.
 */
export const OPEN_GRADING_CYCLE_MS = 12_000;

export type OpenGradingState = {
  stage: "pending" | "scoring" | "finalized";
  /** Puntos de la pregunta abierta */
  points: number | null;
  /** Calificación final del intento (solo al terminar) */
  finalPercent: number | null;
  /** Aviso que le llega al alumno */
  notice: "none" | "grade" | "hidden";
};

/** Puntos máximos de la pregunta abierta y calificación que resulta. */
export const OPEN_GRADING_MAX_POINTS = 5;
const GIVEN = 4;
const FINAL_PERCENT = 88;

/** `published`: los resultados del examen ya son visibles para el alumno. */
export function openGradingStory(phase: number, published: boolean): OpenGradingState {
  if (phase < 0.25) {
    return { stage: "pending", points: null, finalPercent: null, notice: "none" };
  }
  if (phase < 0.55) {
    return { stage: "scoring", points: GIVEN, finalPercent: null, notice: "none" };
  }
  // El intento se cierra: el maestro siempre ve la calificación
  return {
    stage: "finalized",
    points: GIVEN,
    finalPercent: FINAL_PERCENT,
    notice: published ? "grade" : "hidden",
  };
}
