import { TEACHER_GUIDE } from "./teacher";
import { STUDENT_GUIDE } from "./student";
import { ADMIN_GUIDE } from "./admin";
import type { GuideRole, RoleGuide } from "./types";

export type { GuideRole, RoleGuide, GuideSection, GuideStep } from "./types";

export const GUIDES: Record<GuideRole, RoleGuide> = {
  teacher: TEACHER_GUIDE,
  student: STUDENT_GUIDE,
  admin: ADMIN_GUIDE,
};

/** Qué guías puede ver cada rol (el maestro también la del alumno para orientarlo). */
export function guidesFor(role: "admin" | "teacher" | "student"): RoleGuide[] {
  if (role === "admin") return [ADMIN_GUIDE, TEACHER_GUIDE, STUDENT_GUIDE];
  if (role === "teacher") return [TEACHER_GUIDE, STUDENT_GUIDE];
  return [STUDENT_GUIDE];
}

/** Colores de sección y tipo (espejo de globals.css) para el HTML descargable. */
export const SECTION_COLORS: Record<string, { main: string; strong: string; soft: string }> = {
  home: { main: "#6366f1", strong: "#4338ca", soft: "#eef2ff" },
  courses: { main: "#0ea5e9", strong: "#0369a1", soft: "#e0f2fe" },
  grading: { main: "#f59e0b", strong: "#b45309", soft: "#fef3c7" },
  students: { main: "#10b981", strong: "#047857", soft: "#d1fae5" },
  reports: { main: "#8b5cf6", strong: "#6d28d9", soft: "#ede9fe" },
  certificates: { main: "#f43f5e", strong: "#be123c", soft: "#ffe4e6" },
  renewals: { main: "#ea580c", strong: "#c2410c", soft: "#ffedd5" },
  admin: { main: "#64748b", strong: "#334155", soft: "#f1f5f9" },
  settings: { main: "#475569", strong: "#1e293b", soft: "#f1f5f9" },
  focus: { main: "#64748b", strong: "#334155", soft: "#f1f5f9" },
};

export const KIND_COLORS: Record<string, { main: string; tint: string; label: string; glyph: string }> = {
  folder: { main: "#4338ca", tint: "#eef2ff", label: "Carpeta", glyph: "▣" },
  document: { main: "#1e43bc", tint: "#e9edf9", label: "Documento", glyph: "▤" },
  text: { main: "#475569", tint: "#f1f5f9", label: "Lectura", glyph: "≡" },
  video: { main: "#d33be0", tint: "#fae9fb", label: "Video", glyph: "▶" },
  exam: { main: "#d55e00", tint: "#fbeee2", label: "Examen", glyph: "?" },
  assignment: { main: "#0d9488", tint: "#e3f2f0", label: "Tarea", glyph: "↑" },
  resource: { main: "#7c3aed", tint: "#f1ebfe", label: "Recurso descargable", glyph: "↓" },
  link: { main: "#0e7490", tint: "#e0f7fa", label: "Enlace externo", glyph: "⛓" },
};
