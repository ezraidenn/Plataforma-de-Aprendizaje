import { between, progressBetween } from "../scene-clock";
import { computeExpiry, EXPIRING_WINDOW_DAYS, type ValidityMode } from "@/lib/validity";
import { calendarDaysFrom, formatLongDate, formatShortDate } from "@/lib/validity-format";

/** Estados de una lección en el árbol del alumno. */
export type LessonState = "done" | "current" | "locked" | "open";

export type SceneLesson = {
  title: string;
  meta: string;
  state: LessonState;
  /** Avance del anillo (0–1) cuando está «en curso» */
  progress?: number;
  /** Resaltado verde: se acaba de desbloquear / abrir */
  highlight?: boolean;
};

// ─── Progresión secuencial ────────────────────────────────────────────────────

export const SEQ_CYCLE_MS = 7000;

export type SequentialState = { lessons: SceneLesson[]; toastText: string; toastVisible: boolean };

const LESSONS = [
  { title: "Bienvenida y objetivos", meta: "Lectura" },
  { title: "La química del fuego", meta: "Lectura" },
  { title: "Manual del participante", meta: "8 páginas" },
  { title: "Evaluación parcial", meta: "Examen · 5 preguntas" },
] as const;

/**
 * Activado: el alumno termina la 2.ª lección y se abre el candado de la 3.ª.
 * Desactivado: no hay candados; el alumno salta directo al examen.
 */
export function sequentialStory(phase: number, enabled: boolean): SequentialState {
  if (enabled) {
    const lesson2Done = phase >= 0.3;
    const unlocked = phase >= 0.45;
    return {
      lessons: [
        { ...LESSONS[0], state: "done" },
        lesson2Done
          ? { ...LESSONS[1], state: "done" }
          : { ...LESSONS[1], meta: "Lectura · el alumno la termina…", state: "current", progress: progressBetween(phase, 0, 0.3) },
        unlocked ? { ...LESSONS[2], state: "current", highlight: true, progress: 0.05 } : { ...LESSONS[2], state: "locked" },
        { ...LESSONS[3], state: "locked" },
      ],
      toastText: "🔓 Se desbloqueó «Manual del participante»",
      toastVisible: between(phase, 0.5, 0.9),
    };
  }
  const jumped = phase >= 0.45;
  return {
    lessons: [
      { ...LESSONS[0], state: "done" },
      { ...LESSONS[1], meta: "Lectura · 60%", state: jumped ? "open" : "current", progress: 0.6 },
      { ...LESSONS[2], state: "open" },
      jumped ? { ...LESSONS[3], state: "current", highlight: true, progress: 0.05 } : { ...LESSONS[3], state: "open" },
    ],
    toastText: "El alumno abrió «Evaluación parcial» sin terminar las anteriores",
    toastVisible: between(phase, 0.5, 0.9),
  };
}

// ─── Vigencia del certificado ─────────────────────────────────────────────────

export const VALIDITY_CYCLE_MS = 9000;

/** Fecha de aprobación de la historia: 15 de marzo de 2026. */
const ISSUED = new Date(2026, 2, 15, 10, 0, 0);
const DAY_MS = 86_400_000;

export type ValidityBadge = { kind: "lifetime" | "valid" | "expiring" | "expired"; text: string };

export type ValidityStoryState = {
  issuedLabel: string;
  expiryLabel: string | null;
  /** Renglón del diploma; null en vitalicios (el campo se omite) */
  certificateLine: string | null;
  /** Posición de «hoy» sobre la línea (0–1) */
  todayPos: number;
  expiryPos: number | null;
  badge: ValidityBadge;
  /** La persona ya aparece en el panel de Vencimientos */
  showPanel: boolean;
};

/**
 * «Hoy» recorre la línea de tiempo desde que aprobó hasta 20 días después del
 * vencimiento: la insignia pasa de Vigente a Por vencer y a Vencido, y al final
 * la persona aparece en Vencimientos. Vitalicio: la línea no tiene final.
 */
export function validityStory(phase: number, mode: ValidityMode, months: number | null): ValidityStoryState {
  const expiry = computeExpiry(mode, months, ISSUED);
  const move = progressBetween(phase, 0.05, 0.85);
  const issuedLabel = formatShortDate(ISSUED);
  if (!expiry) {
    return {
      issuedLabel,
      expiryLabel: null,
      certificateLine: null,
      todayPos: 0.1 + 0.85 * move,
      expiryPos: null,
      badge: { kind: "lifetime", text: "Vitalicio · no vence" },
      showPanel: false,
    };
  }
  const start = ISSUED.getTime();
  const end = expiry.getTime() + 20 * DAY_MS;
  const today = start + (end - start) * move;
  const scale = (t: number) => 0.1 + 0.8 * ((t - start) / (end - start));
  const days = calendarDaysFrom(today, expiry);
  const badge: ValidityBadge =
    days < 0
      ? { kind: "expired", text: `Vencido el ${formatShortDate(expiry)}` }
      : days <= EXPIRING_WINDOW_DAYS
        ? { kind: "expiring", text: days === 0 ? "Vence hoy" : `Por vencer · ${days} ${days === 1 ? "día" : "días"}` }
        : { kind: "valid", text: "Vigente" };
  return {
    issuedLabel,
    expiryLabel: formatShortDate(expiry),
    certificateLine: `Vigente hasta el ${formatLongDate(expiry)}`,
    todayPos: scale(today),
    expiryPos: scale(expiry.getTime()),
    badge,
    showPanel: badge.kind === "expired" && phase >= 0.86,
  };
}

// ─── Estado del curso ─────────────────────────────────────────────────────────

export const STATUS_CYCLE_MS = 9000;

export type CourseStatus = "draft" | "published" | "archived";

export type StatusStoryState = {
  stage: CourseStatus;
  /** La tarjeta del curso está en «Mis cursos» del alumno */
  cardInPanel: boolean;
  /** Archivado: aviso de que el avance y los certificados se conservan */
  keptNote: boolean;
};

/** Borrador (el alumno no lo ve) → Publicado (entra a su panel) → Archivado (sale; se conserva todo). */
export function statusStory(phase: number): StatusStoryState {
  const stage: CourseStatus = phase < 0.33 ? "draft" : phase < 0.66 ? "published" : "archived";
  return { stage, cardInPanel: stage === "published", keptNote: stage === "archived" };
}

// ─── Imagen del curso ─────────────────────────────────────────────────────────

export const COVER_CYCLE_MS = 8000;

export type CoverStoryState = {
  /** El puntero está sobre «Subir imagen» */
  cursorAtUpload: boolean;
  pressed: boolean;
  uploaded: boolean;
  inDashboard: boolean;
  inLogin: boolean;
};

/** Se sube la foto en Ajustes → aparece en la tarjeta del alumno → y en el carrusel del login. */
export function coverStory(phase: number): CoverStoryState {
  return {
    cursorAtUpload: between(phase, 0.05, 0.3),
    pressed: between(phase, 0.19, 0.25),
    uploaded: phase >= 0.25,
    inDashboard: phase >= 0.45,
    inLogin: phase >= 0.65,
  };
}

// ─── Plantilla de certificado ─────────────────────────────────────────────────

export const CERTIFICATE_CYCLE_MS = 8500;

export type CertificateStoryState = {
  /** Avance del curso (0–100) */
  percent: number;
  /** Aviso «¡Aprobaste el curso!» */
  toastVisible: boolean;
  diploma: boolean;
  name: boolean;
  folio: boolean;
  qr: boolean;
};

/** La barra llega a 100 % → «¡Aprobaste el curso!» → el diploma se arma: nombre, folio y QR. */
export function certificateStory(phase: number): CertificateStoryState {
  return {
    percent: Math.round(100 * progressBetween(phase, 0.03, 0.32)),
    toastVisible: between(phase, 0.34, 0.62),
    diploma: phase >= 0.4,
    name: phase >= 0.5,
    folio: phase >= 0.6,
    qr: phase >= 0.7,
  };
}
