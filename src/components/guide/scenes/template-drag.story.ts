/**
 * Plantilla del diploma: se arrastra el campo «Nombre» sobre el lienzo;
 * aparecen la guía roja del centro y la cota en mm, y al soltar queda alineado.
 */
export const TEMPLATE_DRAG_CYCLE_MS = 10_000;

export type TemplateDragState = {
  /** Posición del campo (0–1 del ancho y del alto del lienzo) */
  x: number;
  y: number;
  /** Está agarrado */
  dragging: boolean;
  /** Se ve la guía roja del centro */
  centerGuide: boolean;
  /** Cota en mm que se muestra (null = ninguna) */
  mm: number | null;
  /** Ya quedó alineado y soltado */
  snapped: boolean;
};

const START_X = 0.24;
const START_Y = 0.62;
const END_Y = 0.46;
/** Distancia al centro, en mm, con la que arranca el arrastre. */
const START_MM = 38;

export function templateDragStory(phase: number): TemplateDragState {
  if (phase < 0.18) {
    return { x: START_X, y: START_Y, dragging: false, centerGuide: false, mm: null, snapped: false };
  }
  if (phase < 0.52) {
    // Lo arrastra hacia el centro; todavía sin imán
    const done = (phase - 0.18) / (0.52 - 0.18);
    return {
      x: START_X + (0.44 - START_X) * done,
      y: START_Y + (END_Y - START_Y) * done,
      dragging: true,
      centerGuide: false,
      mm: Math.round(START_MM * (1 - done)),
      snapped: false,
    };
  }
  if (phase < 0.72) {
    // Cerca del centro: aparece la guía roja y la cota
    return { x: 0.48, y: END_Y, dragging: true, centerGuide: true, mm: 2, snapped: false };
  }
  // Suelta: queda centrado
  return { x: 0.5, y: END_Y, dragging: false, centerGuide: true, mm: 0, snapped: true };
}
