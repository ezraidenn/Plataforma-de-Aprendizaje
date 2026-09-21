import { progressBetween } from "../scene-clock";

// ─── Carpeta de almacenamiento ────────────────────────────────────────────────

export const STORAGE_CYCLE_MS = 9000;
/** Árbol del NAS de la historia (mismas reglas que storage-paths.ts); aparece renglón por renglón. */
export const STORAGE_TREE = [
  { depth: 0, name: "\\\\NAS\\Capacitacion", kind: "root" },
  { depth: 1, name: "Cursos", kind: "folder" },
  { depth: 2, name: "Uso y Manejo de Extintores", kind: "folder" },
  { depth: 3, name: "01 Fundamentos del fuego", kind: "folder" },
  { depth: 4, name: "02 Manual del participante.pdf", kind: "file" },
  { depth: 1, name: "Entregas", kind: "folder" },
  { depth: 2, name: "Uso y Manejo de Extintores", kind: "folder" },
  { depth: 3, name: "Plan de evacuación", kind: "folder" },
  { depth: 4, name: "Laura Pérez — 2026-09-10", kind: "folder" },
  { depth: 5, name: "plan-evacuacion.pdf", kind: "file" },
] as const;
const LESSON_ROWS = 5;

export type StorageState = { upload: "lesson" | "submission"; shown: number; highlight: number };

/** El manual de una lección cae en Cursos › Curso › Módulo; luego una entrega cae en Entregas › Curso › Tarea › Alumno. */
export function storageStory(phase: number): StorageState {
  if (phase < 0.5) {
    const shown = Math.min(LESSON_ROWS, 1 + Math.floor(progressBetween(phase, 0.08, 0.4) * (LESSON_ROWS - 1) + 1e-9));
    return { upload: "lesson", shown, highlight: shown === LESSON_ROWS ? LESSON_ROWS - 1 : -1 };
  }
  const total = STORAGE_TREE.length;
  const shown = Math.min(total, LESSON_ROWS + Math.floor(progressBetween(phase, 0.55, 0.88) * (total - LESSON_ROWS) + 1e-9));
  return { upload: "submission", shown, highlight: shown === total ? total - 1 : -1 };
}

// ─── Portada (dónde se ve) ────────────────────────────────────────────────────

export const COVER_PLACEMENT_CYCLE_MS = 9000;
export type CoverPlacement = "login" | "dashboard" | "both";
export type CoverPlacementState = { active: CoverPlacement; inLogin: boolean; inDashboard: boolean };

/** Recorre las tres opciones: solo inicio de sesión, solo panel, ambas. */
export function coverPlacementStory(phase: number): CoverPlacementState {
  const active: CoverPlacement = phase < 0.33 ? "login" : phase < 0.66 ? "dashboard" : "both";
  return { active, inLogin: active !== "dashboard", inDashboard: active !== "login" };
}
