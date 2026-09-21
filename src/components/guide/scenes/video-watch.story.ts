/**
 * Video del alumno: solo cuentan los tramos realmente vistos. Ve el primer
 * tramo, adelanta (el salto no cuenta) y termina el video; al final se ve el
 * hueco que le falta.
 */
export const VIDEO_WATCH_CYCLE_MS = 11_000;

/** Tramo visto, en fracciones del total (0–1). */
export type WatchedRange = { from: number; to: number };

export type VideoWatchState = {
  /** Posición del reproductor (0–1) */
  position: number;
  /** Tramos acreditados */
  watched: WatchedRange[];
  /** Qué está pasando */
  note: "playing" | "skipped" | "missing";
};

const FIRST_END = 0.34; // hasta dónde ve antes de adelantar
const JUMP_TO = 0.62; // a dónde adelanta

export function videoWatchStory(phase: number): VideoWatchState {
  // 0 → 0.30: reproduce desde el inicio
  if (phase < 0.3) {
    const position = (phase / 0.3) * FIRST_END;
    return { position, watched: [{ from: 0, to: position }], note: "playing" };
  }
  const first = { from: 0, to: FIRST_END };
  // 0.30 → 0.38: adelanta; el tramo saltado no se acredita
  if (phase < 0.38) {
    return { position: JUMP_TO, watched: [first], note: "skipped" };
  }
  // 0.38 → 0.75: reproduce hasta el final
  if (phase < 0.75) {
    const position = JUMP_TO + ((phase - 0.38) / (0.75 - 0.38)) * (1 - JUMP_TO);
    return { position, watched: [first, { from: JUMP_TO, to: position }], note: "playing" };
  }
  // 0.75 → 1: el video terminó, pero falta el tramo que se saltó
  return { position: 1, watched: [first, { from: JUMP_TO, to: 1 }], note: "missing" };
}

/** % acreditado (suma de los tramos vistos). */
export function watchedPercent(state: VideoWatchState): number {
  const total = state.watched.reduce((sum, r) => sum + Math.max(0, r.to - r.from), 0);
  return Math.round(total * 100);
}
