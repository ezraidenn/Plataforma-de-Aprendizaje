/**
 * Entrega devuelta: el instructor la regresa con un comentario, el alumno
 * corrige y vuelve a entregar, y entonces sí queda calificada.
 */
export const RETURNED_CYCLE_MS = 12_000;

export type ReturnedState = {
  stage: "submitted" | "returned" | "resubmitting" | "graded";
  /** Archivo que se ve en la entrega */
  fileName: string;
  /** Comentario del instructor (vacío mientras no la devuelve) */
  comment: string;
  /** Puntos, cuando ya está calificada */
  score: number | null;
};

const FIRST = "croquis-extintores.pdf";
const FIXED = "croquis-extintores-v2.pdf";
const COMMENT = "Falta marcar las rutas de evacuación. Corrige y vuelve a entregar.";

export function returnedStory(phase: number): ReturnedState {
  if (phase < 0.2) {
    return { stage: "submitted", fileName: FIRST, comment: "", score: null };
  }
  if (phase < 0.45) {
    return { stage: "returned", fileName: FIRST, comment: COMMENT, score: null };
  }
  if (phase < 0.72) {
    return { stage: "resubmitting", fileName: FIXED, comment: COMMENT, score: null };
  }
  return { stage: "graded", fileName: FIXED, comment: "Quedó claro. Buen trabajo.", score: 95 };
}
