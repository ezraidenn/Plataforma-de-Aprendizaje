import { between, countdownAt, progressBetween } from "../scene-clock";

export const ATTEMPTS_CYCLE_MS = 8500;
export type ScorePolicy = "best" | "last" | "average";
/** Mínimo para aprobar en la historia */
export const PASS_MIN = 80;
/** Calificaciones de la historia: reprueba, aprueba, mejora parcial */
const SCORES = [60, 90, 80] as const;

const POLICY_LABEL: Record<ScorePolicy, string> = { best: "la mejor", last: "la última", average: "el promedio" };

export type AttemptRow = { n: number; score: number; counted: boolean };

export type AttemptsState =
  | { screen: "answering"; attemptLabel: string; answered: number }
  | { screen: "result"; attemptLabel: string; score: number; passed: boolean; nextLabel: string | null }
  | { screen: "history"; rows: AttemptRow[]; finalScore: number; policyText: string; remainingText: string };

/** Calificación del examen según la política. */
export function finalScore(scores: readonly number[], policy: ScorePolicy): number {
  if (policy === "best") return Math.max(...scores);
  if (policy === "last") return scores[scores.length - 1];
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function attemptLabel(n: number, limit: number | null): string {
  return limit === null ? `Intento ${n} · ilimitados` : `Intento ${n} de ${limit}`;
}

/**
 * Responde el intento 1 → reprueba (60 %) → reintenta → aprueba (90 %) → (si
 * hay 3 o más) mejora parcial (80 %) → historial con la fila que cuenta según
 * la política y cuántos intentos le quedan.
 */
export function attemptsStory(phase: number, limit: number | null, policy: ScorePolicy): AttemptsState {
  const used = limit === null ? 3 : Math.max(1, Math.min(3, limit));
  const scores: number[] = SCORES.slice(0, used);
  // Fronteras: [responder | resultado 1 | resultado 2 | resultado 3 | historial]
  const cuts = used === 1 ? [0.25, 0.55] : used === 2 ? [0.2, 0.4, 0.62] : [0.18, 0.34, 0.5, 0.66];

  if (phase < cuts[0]) {
    return {
      screen: "answering",
      attemptLabel: attemptLabel(1, limit),
      answered: Math.min(5, Math.floor(progressBetween(phase, 0, cuts[0] * 0.9) * 5)),
    };
  }
  for (let k = 1; k < cuts.length; k++) {
    if (phase < cuts[k]) {
      const score = scores[k - 1];
      const left = limit === null ? null : limit - k;
      return {
        screen: "result",
        attemptLabel: attemptLabel(k, limit),
        score,
        passed: score >= PASS_MIN,
        nextLabel: left === null ? "Reintentar" : left > 0 ? `Reintentar (${k + 1} de ${limit})` : null,
      };
    }
  }
  const best = Math.max(...scores);
  const bestIndex = scores.indexOf(best);
  const rows = scores.map((score, i) => ({
    n: i + 1,
    score,
    counted: policy === "average" ? true : policy === "best" ? i === bestIndex : i === scores.length - 1,
  }));
  const left = limit === null ? null : limit - used;
  return {
    screen: "history",
    rows,
    finalScore: finalScore(scores, policy),
    policyText: POLICY_LABEL[policy],
    remainingText:
      left === null
        ? "Intentos ilimitados: puede seguir mejorando."
        : left > 0
          ? `Le ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`}.`
          : "Sin intentos: el botón se bloquea.",
  };
}

// ─── Ventana del examen (abre / cierra) ───────────────────────────────────────

export const WINDOW_CYCLE_MS = 9000;
/** Fechas de ejemplo: abre el 15 de marzo a las 9:00 y cierra el 20 a las 18:00. */
export const EXAMPLE_OPENS = new Date(2026, 2, 15, 9, 0).getTime();
export const EXAMPLE_CLOSES = new Date(2026, 2, 20, 18, 0).getTime();

export type WindowStage = "before" | "open" | "after";
export type WindowState = { stage: WindowStage; todayPos: number; openPos: number | null; closePos: number | null };

/** «Hoy» recorre la línea: antes de abrir → abierto («Comenzar intento») → cerrado. */
export function windowStory(phase: number, hasOpen: boolean, hasClose: boolean): WindowState {
  const openPos = hasOpen ? 0.3 : null;
  const closePos = hasClose ? 0.7 : null;
  const todayPos = 0.06 + 0.88 * progressBetween(phase, 0.02, 0.92);
  const stage: WindowStage =
    openPos !== null && todayPos < openPos ? "before" : closePos !== null && todayPos >= closePos ? "after" : "open";
  return { stage, todayPos, openPos, closePos };
}

// ─── Tiempo límite ────────────────────────────────────────────────────────────

export const TIME_CYCLE_MS = 8000;
const TIME_END = 0.6;

export type TimeLevel = "normal" | "warn" | "danger";
export type TimeLimitState = {
  /** Segundos restantes (null = sin límite) */
  remaining: number | null;
  level: TimeLevel;
  expired: boolean;
  /** Preguntas contestadas (de 5) */
  answered: number;
  submitted: boolean;
  /** Aviso «Se acabó el tiempo…» */
  toast: boolean;
};

/** Reloj del examen como en la app: «12:34» o «1 h 05 min». */
export function timerText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m}:${String(s).padStart(2, "0")}`;
}

/** El reloj baja (acelerado); a 0:00 se envía solo con lo contestado (3 de 5). Sin límite: termina y envía. */
export function timeLimitStory(phase: number, minutes: number | null): TimeLimitState {
  if (minutes === null) {
    const answered = Math.min(5, Math.floor(progressBetween(phase, 0.05, 0.6) * 5 + 1e-9));
    return { remaining: null, level: "normal", expired: false, answered, submitted: phase >= 0.7, toast: false };
  }
  const total = Math.max(1, Math.round(minutes)) * 60;
  const remaining = countdownAt(phase, total, 0, TIME_END);
  return {
    remaining,
    level: remaining <= 60 ? "danger" : remaining <= 300 ? "warn" : "normal",
    expired: phase >= TIME_END,
    answered: Math.min(3, Math.floor(progressBetween(phase, 0.05, 0.5) * 3 + 1e-9)),
    submitted: phase >= TIME_END,
    toast: between(phase, TIME_END, 0.9),
  };
}

// ─── Calificación mínima ──────────────────────────────────────────────────────

export const PASSING_CYCLE_MS = 8000;
/** Dos resultados de la historia: uno debajo y otro arriba del mínimo típico */
export const PASSING_SCORES = [75, 85] as const;

export type PassingState = { attempt: 0 | 1; score: number; fill: number; verdict: "pass" | "fail" | "graded" | null };

/** Resultado de 75 % y luego de 85 %: el anillo se llena y aparece el veredicto contra el mínimo. */
export function passingStory(phase: number, passScore: number | null): PassingState {
  const attempt = phase < 0.5 ? 0 : 1;
  const local = attempt === 0 ? phase * 2 : (phase - 0.5) * 2;
  const score = PASSING_SCORES[attempt];
  return {
    attempt,
    score,
    fill: progressBetween(local, 0.05, 0.55),
    verdict: local < 0.6 ? null : passScore === null ? "graded" : score >= passScore ? "pass" : "fail",
  };
}

// ─── Mostrar resultados ───────────────────────────────────────────────────────

export const RESULTS_CYCLE_MS = 9000;
export type ResultsMode = "immediately" | "after_close" | "manual";

export type ResultsState = {
  stage: "answering" | "confirm" | "sent";
  gradeVisible: boolean;
  /** Se liberan después: cerró el examen o el instructor los publicó */
  later: boolean;
  /** «Cuando yo decida»: el instructor pulsa «Publicar resultados» */
  publishing: boolean;
};

/** El alumno envía: ve su calificación al momento, al cierre del examen o cuando el instructor la publica. */
export function resultsStory(phase: number, mode: ResultsMode): ResultsState {
  const stage = phase < 0.2 ? "answering" : phase < 0.32 ? "confirm" : "sent";
  const later = mode !== "immediately" && phase >= 0.72;
  const publishing = mode === "manual" && phase >= 0.56 && phase < 0.72;
  return { stage, gradeVisible: stage === "sent" && (mode === "immediately" || later), later, publishing };
}
