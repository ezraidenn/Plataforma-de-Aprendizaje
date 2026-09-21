import { between, progressBetween } from "../scene-clock";

// ─── Cerrar / reabrir grupo ───────────────────────────────────────────────────

export const GROUP_CLOSE_CYCLE_MS = 9000;
export type CohortStatus = "open" | "closed";
export const CLOSING_GROUP = "Generación 2025";
export const GROUP_ROWS = [
  { name: "Roberto Díaz", group: "Generación 2025", percent: 100 },
  { name: "Laura Pérez", group: "Generación Agosto 2026", percent: 60 },
  { name: "Patricia Gómez", group: "Generación 2025", percent: 100 },
  { name: "Carlos Sánchez", group: "Generación Agosto 2026", percent: 20 },
  { name: "Mónica Aguilar", group: "Generación 2025", percent: 40 },
] as const;

export type GroupCloseState = { stage: CohortStatus; pressed: boolean; visibleRows: number };

/** «Generación 2025» se cierra (sus filas salen de la lista) y luego se reabre (vuelven). */
export function groupCloseStory(phase: number): GroupCloseState {
  const closed = between(phase, 0.3, 0.72);
  return {
    stage: closed ? "closed" : "open",
    pressed: between(phase, 0.24, 0.3) || between(phase, 0.66, 0.72),
    visibleRows: GROUP_ROWS.filter((r) => !closed || r.group !== CLOSING_GROUP).length,
  };
}

// ─── Traer grupo de otro curso ────────────────────────────────────────────────

export const IMPORT_CYCLE_MS = 8500;
export const IMPORT_GROUP = "Generación Agosto 2026";
export const IMPORT_MEMBERS = ["Laura Pérez", "Carlos Sánchez", "Mónica Aguilar", "Arturo Mendoza"] as const;

export type ImportState = { selected: boolean; groupCreated: boolean; copied: number };

/** Se elige el grupo de otro curso; sus alumnos se inscriben uno a uno en un grupo igual del curso nuevo. */
export function importStory(phase: number): ImportState {
  return {
    selected: phase >= 0.15,
    groupCreated: phase >= 0.3,
    copied: Math.min(IMPORT_MEMBERS.length, Math.floor(progressBetween(phase, 0.32, 0.75) * IMPORT_MEMBERS.length + 1e-9)),
  };
}

// ─── Quitar del curso / Papelera ──────────────────────────────────────────────

export const TRASH_CYCLE_MS = 9000;
export type TrashStage = "list" | "removed" | "sheet" | "restored";
export type TrashState = { stage: TrashStage; trashCount: number; cursorAt: "remove" | "restore" | null; pressed: boolean };

/** Quitar a Laura → Papelera (1) con su certificado → Restaurar → vuelve «Aprobado». */
export function trashStory(phase: number): TrashState {
  const stage: TrashStage = phase < 0.28 ? "list" : phase < 0.45 ? "removed" : phase < 0.72 ? "sheet" : "restored";
  return {
    stage,
    trashCount: stage === "removed" || stage === "sheet" ? 1 : 0,
    cursorAt: between(phase, 0.1, 0.3) ? "remove" : between(phase, 0.52, 0.74) ? "restore" : null,
    pressed: between(phase, 0.22, 0.28) || between(phase, 0.66, 0.72),
  };
}

// ─── Reinscribir / Descartar ──────────────────────────────────────────────────

export const RENEWALS_CYCLE_MS = 10000;
export type RenewalsStage = "rows" | "renewing" | "renewed" | "dismissing" | "dismissed";
export type RenewalsState = { stage: RenewalsStage; laura: "row" | "cycle2"; ernesto: "row" | "dialog" | "gone" };

/** Laura: Reinscribir → «Ciclo 2 · 0 %» y su certificado anterior al historial. Ernesto: Descartar con motivo → sale del panel. */
export function renewalsStory(phase: number): RenewalsState {
  const stage: RenewalsStage =
    phase < 0.15 ? "rows" : phase < 0.3 ? "renewing" : phase < 0.5 ? "renewed" : phase < 0.72 ? "dismissing" : "dismissed";
  return {
    stage,
    laura: stage === "rows" || stage === "renewing" ? "row" : "cycle2",
    ernesto: stage === "dismissing" ? "dialog" : stage === "dismissed" ? "gone" : "row",
  };
}
