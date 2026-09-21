"use client";

/**
 * Señala en pantalla el control exacto que toca usar: lo trae a la vista (sin
 * desplazamiento suave, para no marear) y le da un par de latidos con la clase
 * `.guide-pulse` de globals.css. Se usa en los destinos de la guía de primeros
 * pasos donde no hay diálogo que abrir.
 */
const PULSE_CLASS = "guide-pulse";
/** Debe cubrir la animación (1.6 s × 2) con un margen */
const PULSE_MS = 3600;

export function pulseHighlight(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.classList.remove(PULSE_CLASS);
  // Fuerza el reinicio de la animación si ya la tenía
  void el.offsetWidth;
  el.classList.add(PULSE_CLASS);
  window.setTimeout(() => el.classList.remove(PULSE_CLASS), PULSE_MS);
}
