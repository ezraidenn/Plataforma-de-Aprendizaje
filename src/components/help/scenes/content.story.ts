import { between, countdownAt, progressBetween } from "../scene-clock";

export const DOC_CYCLE_MS = 7000;
/** El contador termina en esta fase; el resto del ciclo muestra el resultado. */
const COUNT_END = 0.55;

export type DocSecondsState = {
  remaining: number;
  total: number;
  pageDone: boolean;
  nextEnabled: boolean;
  /** Relleno (0–1) del segmento de la página actual en la barra */
  segmentFill: number;
  /** Destello del botón «Siguiente» al habilitarse */
  glow: boolean;
};

/**
 * El contador de la página baja de N a 0 (acelerado); al llegar a cero la
 * página se acredita, su segmento se pinta y se habilita «Siguiente».
 * Con 0 s la página cuenta desde que se abre.
 */
export function docSecondsStory(phase: number, seconds: number): DocSecondsState {
  const total = Math.max(0, Math.round(seconds));
  if (total === 0) {
    return { remaining: 0, total, pageDone: true, nextEnabled: true, segmentFill: 1, glow: between(phase, 0.1, 0.4) };
  }
  const pageDone = phase >= COUNT_END;
  return {
    remaining: countdownAt(phase, total, 0, COUNT_END),
    total,
    pageDone,
    nextEnabled: pageDone,
    segmentFill: progressBetween(phase, COUNT_END, COUNT_END + 0.07),
    glow: between(phase, 0.58, 0.8),
  };
}

// ─── Tipos de contenido ───────────────────────────────────────────────────────

export const TYPES_CYCLE_MS = 10500;
export const CONTENT_KINDS = ["document", "text", "video", "exam", "assignment", "resource", "link"] as const;
export type ContentKindShown = (typeof CONTENT_KINDS)[number];

/** Qué vive el alumno con cada tipo (línea bajo la escena). */
export const KIND_HINTS: Record<ContentKindShown, string> = {
  document: "Página por página; cada una cuenta tras unos segundos",
  text: "Lectura con tiempo mínimo en pantalla",
  video: "Se acredita lo visto; no se puede adelantar",
  exam: "Preguntas con calificación automática",
  assignment: "Sube su archivo y tú lo calificas",
  resource: "Archivos para descargar",
  link: "Página externa; cuenta al abrirla",
};

export type TypesState = { index: number; kind: ContentKindShown; local: number };

/** Carrusel: cada tipo ocupa 1/7 del ciclo; `local` es el avance (0–1) dentro de su turno. */
export function typesStory(phase: number): TypesState {
  const scaled = phase * CONTENT_KINDS.length;
  const index = Math.min(CONTENT_KINDS.length - 1, Math.floor(scaled));
  return { index, kind: CONTENT_KINDS[index], local: Math.min(1, scaled - index) };
}

// ─── Segundos mínimos de lectura ──────────────────────────────────────────────

export const TEXT_CYCLE_MS = 7000;

export type TextSecondsState = { remaining: number; total: number; done: boolean; percent: number; showContinue: boolean };

/** «Faltan m:ss» baja a 0 → «Lectura completada» → aparece «Continuar». Con 0 s se completa al abrir. */
export function textSecondsStory(phase: number, seconds: number): TextSecondsState {
  const total = Math.max(0, Math.round(seconds));
  if (total === 0) return { remaining: 0, total, done: true, percent: 100, showContinue: true };
  return {
    remaining: countdownAt(phase, total, 0, COUNT_END),
    total,
    done: phase >= COUNT_END,
    percent: Math.round(100 * progressBetween(phase, 0, COUNT_END)),
    showContinue: phase >= COUNT_END + 0.05,
  };
}

// ─── Velocidad del video ──────────────────────────────────────────────────────

export const SPEED_CYCLE_MS = 8000;
const SPEED_CLICK = 0.3;
/** Avance de la línea del video por ciclo completo a 1x (fracción del total) */
const BASE_SPEED = 0.5;

export type VideoSpeedState = {
  /** Velocidad que muestra el reproductor */
  rate: 1 | 2;
  /** Menú de velocidad abierto (el alumno elige 2x) */
  menuOpen: boolean;
  /** La velocidad acaba de regresar a 1x (ajuste apagado) */
  snapBack: boolean;
  /** Posición en la línea del video (0–1) */
  position: number;
};

/** El alumno elige 2x. Encendido: sigue al doble. Apagado: el reproductor vuelve a 1x. */
export function videoSpeedStory(phase: number, allowed: boolean): VideoSpeedState {
  const menuOpen = between(phase, 0.16, SPEED_CLICK);
  if (allowed) {
    const fast = phase >= SPEED_CLICK;
    return {
      rate: fast ? 2 : 1,
      menuOpen,
      snapBack: false,
      position: fast ? BASE_SPEED * SPEED_CLICK + 2 * BASE_SPEED * (phase - SPEED_CLICK) : BASE_SPEED * phase,
    };
  }
  return {
    rate: between(phase, SPEED_CLICK, 0.38) ? 2 : 1,
    menuOpen,
    snapBack: between(phase, 0.38, 0.75),
    position: BASE_SPEED * phase,
  };
}

// ─── Requerido para completar ─────────────────────────────────────────────────

export const REQUIRED_CYCLE_MS = 8000;

export type RequiredState = { mode: "required" | "optional"; done: number; total: number; percent: number };

/** Mismo avance del alumno: si la lección es requerida cuenta (3 de 4); si es opcional, no (3 de 3). */
export function requiredStory(phase: number): RequiredState {
  return phase < 0.5
    ? { mode: "required", done: 3, total: 4, percent: 75 }
    : { mode: "optional", done: 3, total: 3, percent: 100 };
}

// ─── Recurso descargable / enlace externo ─────────────────────────────────────

export const RESOURCE_LINK_CYCLE_MS = 7000;

export type ResourceLinkState = { cursorAtButton: boolean; pressed: boolean; done: boolean; showNext: boolean };

/** El puntero llega al botón y hace clic → «Visto» → aparece «Siguiente lección». */
export function resourceLinkStory(phase: number): ResourceLinkState {
  return {
    cursorAtButton: between(phase, 0.12, 0.6),
    pressed: between(phase, 0.3, 0.38),
    done: phase >= 0.4,
    showNext: phase >= 0.52,
  };
}
