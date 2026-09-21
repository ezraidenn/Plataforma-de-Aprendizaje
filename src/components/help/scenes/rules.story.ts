import { progressBetween } from "../scene-clock";

export const RULES_CYCLE_MS = 9000;
/** Mismo alumno en ambas mitades: contenido 100 % (cumple) y promedio 70 % (no). */
export const EXAMS_MIN = 80;
const VIEWING_VALUE = 100;
const EXAMS_VALUE = 70;

export type OperatorState = {
  activeOp: "AND" | "OR";
  /** Avance mostrado (0–100) de cada condición */
  viewing: number;
  exams: number;
  viewingMark: boolean;
  examsMark: boolean;
  result: "fail" | "pass" | null;
};

/** Primera mitad con «Y» (no aprueba); segunda con «O» (aprueba). */
export function operatorStory(phase: number): OperatorState {
  const secondHalf = phase >= 0.5;
  const local = secondHalf ? (phase - 0.5) * 2 : phase * 2;
  return {
    activeOp: secondHalf ? "OR" : "AND",
    viewing: VIEWING_VALUE * progressBetween(local, 0, 0.36),
    exams: EXAMS_VALUE * progressBetween(local, 0, 0.44),
    viewingMark: local >= 0.4,
    examsMark: local >= 0.48,
    result: local >= 0.58 ? (secondHalf ? "pass" : "fail") : null,
  };
}

// ─── Ver el contenido ─────────────────────────────────────────────────────────

export const VIEWING_CYCLE_MS = 7500;
/** Lecciones requeridas de la historia (20 % cada una) */
export const VIEWING_LESSONS = 5;

export type ViewingState = { lessonsDone: number; value: number; passed: boolean };

/** El alumno completa lecciones una a una; la condición se cumple al alcanzar el mínimo. */
export function viewingStory(phase: number, min: number): ViewingState {
  const lessonsDone = Math.min(VIEWING_LESSONS, Math.floor(progressBetween(phase, 0.05, 0.7) * VIEWING_LESSONS + 1e-9));
  const value = Math.round((lessonsDone / VIEWING_LESSONS) * 100);
  return { lessonsDone, value, passed: value >= min };
}

// ─── Promedio de exámenes ─────────────────────────────────────────────────────

export const AVERAGE_CYCLE_MS = 8000;
export const AVERAGE_EXAMS = [
  { title: "Evaluación parcial", score: 90 },
  { title: "Examen final", score: 70 },
] as const;
export const AVERAGE_VALUE = Math.round(AVERAGE_EXAMS.reduce((sum, e) => sum + e.score, 0) / AVERAGE_EXAMS.length);

export type ExamAverageState = { shown: number; average: number | null; passed: boolean | null };

/** Aparecen las calificaciones (90 y 70), luego su promedio (80) y al final se compara con el mínimo. */
export function examAverageStory(phase: number, min: number): ExamAverageState {
  return {
    shown: phase < 0.12 ? 0 : phase < 0.3 ? 1 : 2,
    average: phase >= 0.48 ? AVERAGE_VALUE : null,
    passed: phase >= 0.62 ? AVERAGE_VALUE >= min : null,
  };
}

// ─── Un examen específico ─────────────────────────────────────────────────────

export const SPECIFIC_CYCLE_MS = 7500;
/** Exámenes del curso de la historia; la condición es sobre el de SPECIFIC_INDEX. */
export const SPECIFIC_EXAMS = [
  { title: "Evaluación parcial — Clases de fuego", score: 60 },
  { title: "Examen final de certificación", score: 85 },
  { title: "Práctica: tipos de extintor", score: 95 },
] as const;
export const SPECIFIC_INDEX = 1;

export type ExamSpecificState = { focus: boolean; passed: boolean | null };

/** Solo el examen elegido se ilumina; su calificación (85) se compara con el mínimo. */
export function examSpecificStory(phase: number, min: number): ExamSpecificState {
  return {
    focus: phase >= 0.15,
    passed: phase >= 0.45 ? SPECIFIC_EXAMS[SPECIFIC_INDEX].score >= min : null,
  };
}

// ─── Completar todo lo requerido ──────────────────────────────────────────────

export const ALL_ITEMS_CYCLE_MS = 8000;
export const ALL_ITEMS = [
  { title: "Bienvenida y objetivos", meta: "Lectura", required: true },
  { title: "Manual del participante", meta: "Documento", required: true },
  { title: "Video de repaso", meta: "Video", required: false },
  { title: "Examen final de certificación", meta: "Examen", required: true },
] as const;
export const ALL_ITEMS_REQUIRED = ALL_ITEMS.filter((item) => item.required).length;

export type AllItemsState = { requiredDone: number; passed: boolean };

/** Se palomean las lecciones requeridas; la opcional queda pendiente y aun así se cumple. */
export function allItemsStory(phase: number): AllItemsState {
  const requiredDone = Math.min(ALL_ITEMS_REQUIRED, Math.floor(progressBetween(phase, 0.1, 0.6) * ALL_ITEMS_REQUIRED + 1e-9));
  return { requiredDone, passed: requiredDone === ALL_ITEMS_REQUIRED && phase >= 0.65 };
}
