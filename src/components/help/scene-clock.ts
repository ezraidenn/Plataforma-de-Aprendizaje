/**
 * Reloj de las escenas de ayuda. Una escena es una «historia» en bucle: su
 * estado en cada instante depende solo de la fase del ciclo (0 → 1) y del
 * valor del ajuste. Funciones puras (se prueban en scripts/smoke-help.ts).
 */

/** Fase del ciclo en [0, 1) a partir del tiempo transcurrido. */
export function cyclePhase(elapsedMs: number, cycleMs: number): number {
  if (cycleMs <= 0) return 0;
  const t = elapsedMs % cycleMs;
  return (t < 0 ? t + cycleMs : t) / cycleMs;
}

/** Avance 0 → 1 entre las fases `start` y `end` (antes: 0; después: 1). */
export function progressBetween(phase: number, start: number, end: number): number {
  if (end <= start) return phase >= end ? 1 : 0;
  if (phase <= start) return 0;
  if (phase >= end) return 1;
  return (phase - start) / (end - start);
}

/** Cuenta regresiva entera de `from` a 0 entre las fases `start` y `end`. */
export function countdownAt(phase: number, from: number, start: number, end: number): number {
  const remaining = from * (1 - progressBetween(phase, start, end));
  return Math.max(0, Math.ceil(remaining - 1e-9));
}

/** ¿La fase está en el tramo [a, b)? */
export function between(phase: number, a: number, b: number): boolean {
  return phase >= a && phase < b;
}

/** Fase que se muestra con «reducir movimiento»: el resultado, sin animar. */
export const FINAL_PHASE = 0.97;
