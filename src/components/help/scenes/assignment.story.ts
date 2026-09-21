import { parseAllowedTypes, typesLabel } from "@/lib/file-types";
import { between, progressBetween } from "../scene-clock";

// ─── Fecha límite y entregas tardías ──────────────────────────────────────────

export const LATE_CYCLE_MS = 9000;
/** Fecha límite de ejemplo: 12 de septiembre a las 23:59 */
export const EXAMPLE_DUE = new Date(2026, 8, 12, 23, 59).getTime();

export type LateOutcome = "onTime" | "late" | "closed";
export type LateState = {
  todayPos: number;
  duePos: number | null;
  pastDue: boolean;
  cursorAtButton: boolean;
  pressed: boolean;
  outcome: LateOutcome | null;
};

/** «Hoy» pasa la fecha límite y el alumno intenta entregar: con retraso, cerrada o (sin fecha) a tiempo. */
export function lateStory(phase: number, hasDue: boolean, allowLate: boolean): LateState {
  const duePos = hasDue ? 0.45 : null;
  const todayPos = 0.08 + 0.8 * progressBetween(phase, 0.02, 0.5);
  const attempted = phase >= 0.58;
  return {
    todayPos,
    duePos,
    pastDue: duePos !== null && todayPos > duePos,
    cursorAtButton: between(phase, 0.46, 0.64),
    pressed: between(phase, 0.54, 0.58),
    outcome: !attempted ? null : !hasDue ? "onTime" : allowLate ? "late" : "closed",
  };
}

// ─── Reemplazar entrega ───────────────────────────────────────────────────────

export const REPLACE_CYCLE_MS = 8000;

export type ReplaceState = {
  /** La entrega ya se ve en «Tu entrega» */
  delivered: boolean;
  stage: "submitted" | "confirm" | "replaced";
  file: "plan-v1.pdf" | "plan-v2.pdf";
  cursorAtButton: boolean;
  pressed: boolean;
};

/** Encendido: «Reemplazar entrega» → confirmar → queda la versión nueva. Apagado: la entrega queda fija. */
export function replaceStory(phase: number, allowed: boolean): ReplaceState {
  const delivered = phase >= 0.08;
  if (!allowed) return { delivered, stage: "submitted", file: "plan-v1.pdf", cursorAtButton: false, pressed: false };
  const stage = phase < 0.4 ? "submitted" : phase < 0.62 ? "confirm" : "replaced";
  return {
    delivered,
    stage,
    file: stage === "replaced" ? "plan-v2.pdf" : "plan-v1.pdf",
    cursorAtButton: between(phase, 0.15, 0.42),
    pressed: between(phase, 0.32, 0.4),
  };
}

// ─── Tipos de archivo permitidos ──────────────────────────────────────────────

export const FILE_TYPES_CYCLE_MS = 8500;
/** Extensiones con las que se prueba el rechazo (la primera que no esté en la lista) */
const REJECT_CANDIDATES = ["exe", "zip", "mp3"] as const;

export type FileTypesState = {
  types: string[];
  label: string;
  /** Archivo que se intenta primero (normalmente no permitido) */
  badName: string;
  goodName: string;
  /** Con la lista vacía, el primer archivo también se acepta */
  badAccepted: boolean;
  stage: "empty" | "dragBad" | "rejected" | "dragGood" | "accepted";
};

/** Se arrastra un archivo no permitido → aviso de rechazo → se arrastra uno permitido → aceptado. */
export function fileTypesStory(phase: number, raw: string): FileTypesState {
  const types = parseAllowedTypes(raw);
  const badExt = REJECT_CANDIDATES.find((ext) => !types.includes(ext)) ?? "exe";
  const goodExt = types[0] ?? "pdf";
  const stage = phase < 0.1 ? "empty" : phase < 0.28 ? "dragBad" : phase < 0.5 ? "rejected" : phase < 0.65 ? "dragGood" : "accepted";
  return {
    types,
    label: typesLabel(types),
    badName: `instalador.${badExt}`,
    goodName: `plan-evacuacion.${goodExt}`,
    badAccepted: types.length === 0,
    stage,
  };
}
