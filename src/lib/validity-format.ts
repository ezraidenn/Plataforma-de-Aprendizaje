/**
 * Presentación de fechas de vigencia en español (México). Isomórfico y sin
 * estado: complementa a `validity.ts` (que decide el estado) con el texto que
 * ve la persona.
 */

const DAY_MS = 86_400_000;

const SHORT_DATE = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const LONG_DATE = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

type DateLike = Date | number;

function toMs(d: DateLike): number {
  return typeof d === "number" ? d : d.getTime();
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** «31 dic 2026» (sin el punto de la abreviatura, como `formatDate`). */
export function formatShortDate(d: DateLike): string {
  return SHORT_DATE.format(toMs(d)).replace(".", "");
}

/** «31 de diciembre de 2026» */
export function formatLongDate(d: DateLike): string {
  return LONG_DATE.format(toMs(d));
}

/**
 * Días de CALENDARIO de `now` a `target` (negativo si ya pasó). Algo que vence
 * hoy a las 23:59 es «hoy», no «mañana» aunque falten menos de 24 h.
 */
export function calendarDaysFrom(now: DateLike, target: DateLike): number {
  // round (no floor): absorbe los días de 23 o 25 h por horario de verano
  return Math.round((startOfDay(toMs(target)) - startOfDay(toMs(now))) / DAY_MS);
}

/** «hoy», «mañana», «en 12 días», «ayer», «hace 3 días». */
export function relativeDaysLabel(target: DateLike, now: DateLike = Date.now()): string {
  const days = calendarDaysFrom(now, target);
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days === -1) return "ayer";
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}
