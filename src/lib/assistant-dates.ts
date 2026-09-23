/**
 * Rangos de fecha dichos en palabras. La IA manda `desde`/`hasta` tal como los
 * escribió la persona («hoy», «esta semana», «2026-09-01») y aquí se
 * convierten siempre igual en un tramo de días completos, en hora local, con
 * una etiqueta en español para enseñar en la respuesta («del 1 al 15 de
 * septiembre»). Si no se entiende, hoy: nunca devuelve un rango vacío.
 *
 * Puro: sin base de datos ni `server-only`. Se prueba en `pnpm smoke:assistant`.
 */

export type DateRange = { from: Date; to: Date; label: string };

/** Antes de esto no hay nada que consultar: ahí empieza «siempre». */
const SIEMPRE = new Date(2020, 0, 1);

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Minúsculas, sin acentos, sin espacios de sobra y sin el artículo de delante. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(?:(?:el|la|los|las|de|desde|en) )+/, "");
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Lunes de la semana de `d`: aquí la semana empieza en lunes. */
function monday(d: Date): Date {
  const dow = d.getDay(); // 0 domingo … 6 sábado
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

/** «2026-09-01» → ese día. Cualquier otra cosa (o un 31 de febrero) → null. */
function parseIso(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

/** «15 de septiembre», con el año solo si no es el de `now`. */
function dayLabel(d: Date, now: Date): string {
  const year = d.getFullYear() === now.getFullYear() ? "" : ` de ${d.getFullYear()}`;
  return `${d.getDate()} de ${MESES[d.getMonth()]}${year}`;
}

/** «el 15 de septiembre», «del 1 al 15 de septiembre», «del 30 de agosto al 2 de septiembre». */
function rangeLabel(from: Date, to: Date, now: Date): string {
  if (sameDay(from, to)) return `el ${dayLabel(from, now)}`;
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    return `del ${from.getDate()} al ${dayLabel(to, now)}`;
  }
  return `del ${dayLabel(from, now)} al ${dayLabel(to, now)}`;
}

/** «septiembre», o «diciembre de 2025» si es de otro año. */
function monthLabel(d: Date, now: Date): string {
  const year = d.getFullYear() === now.getFullYear() ? "" : ` de ${d.getFullYear()}`;
  return `${MESES[d.getMonth()]}${year}`;
}

/** Días completos y en orden: si vienen al revés, se intercambian. */
function build(from: Date, to: Date, now: Date, label?: string): DateRange {
  const a = startOfDay(from);
  const b = startOfDay(to);
  const [first, last] = a.getTime() > b.getTime() ? [b, a] : [a, b];
  return { from: first, to: endOfDay(last), label: label ?? rangeLabel(first, last, now) };
}

export function dateRange(desde: string, hasta: string, now: Date = new Date()): DateRange {
  const d = normalize(desde);
  const h = normalize(hasta);
  const hoy = startOfDay(now);

  // Fechas exactas: mandan sobre las palabras
  const isoFrom = parseIso(d);
  const isoTo = parseIso(h);
  if (isoFrom) return build(isoFrom, isoTo ?? hoy, now);
  if (isoTo) {
    const range = build(SIEMPRE, isoTo, now);
    return { ...range, label: `hasta el ${dayLabel(isoTo, now)}` };
  }

  if (d === "hoy") return build(hoy, hoy, now, "hoy");

  if (d === "ayer") return build(addDays(hoy, -1), addDays(hoy, -1), now, "ayer");

  if (d === "esta semana" || d === "semana") return build(monday(hoy), hoy, now, "esta semana");

  if (d === "semana pasada" || d === "semana anterior") {
    const lunes = addDays(monday(hoy), -7);
    return build(lunes, addDays(lunes, 6), now, "la semana pasada");
  }

  if (d === "este mes" || d === "mes") {
    const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return build(primero, new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0), now, monthLabel(primero, now));
  }

  if (d === "mes pasado" || d === "mes anterior") {
    const primero = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    return build(primero, new Date(hoy.getFullYear(), hoy.getMonth(), 0), now, monthLabel(primero, now));
  }

  // «últimos 7 días»: hoy cuenta, así que empieza 6 días atrás
  const ultimos = /^ultimos? (\d{1,4}) dias?$/.exec(d);
  if (ultimos) {
    const n = Number(ultimos[1]);
    if (n >= 1) {
      const label = n === 1 ? "hoy" : `los últimos ${n} días`;
      return build(addDays(hoy, -(n - 1)), hoy, now, label);
    }
  }

  if (d === "siempre") return build(SIEMPRE, hoy, now, "desde siempre");

  // No se entendió (o venía vacío): hoy
  return build(hoy, hoy, now, "hoy");
}
