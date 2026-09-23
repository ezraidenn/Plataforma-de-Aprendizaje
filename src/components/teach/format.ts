// Utilidades compartidas (servidor y cliente) para las vistas de maestro.

export const COURSE_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
};

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" })
    .format(date)
    .replace(".", "");
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "Nunca";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(".", "");
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}

/** Segundos invertidos → "12:34 min" o "1:05 h" (drill-down de reportes). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 3600) {
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")} min`;
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")} h`;
}

/** "hace 5 min", "hace 2 h", "hace 3 días" — para colas y listados. */
export function formatRelative(date: Date | number | null | undefined): string {
  if (date === null || date === undefined) return "—";
  const ms = typeof date === "number" ? date : date.getTime();
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "hace 1 día";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}

/** 14 → "14" · 14.5 → "14.5" (puntos de examen o de tarea). */
export function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * Qué decirle al maestro después de guardar. Al corregir una nota ya puesta el
 * número importa más que el verbo: «Corregida de 7 a 9». Si la nota no se movió
 * se dice también, para que no parezca que no se guardó.
 */
export function gradeSavedMessage(
  result: { regraded: boolean; scoreBefore: number | null; scoreAfter: number | null },
  fallback: string
): string {
  if (!result.regraded) return fallback;
  const { scoreBefore, scoreAfter } = result;
  if (scoreBefore !== null && scoreAfter !== null && scoreBefore !== scoreAfter) {
    return `Corregida de ${formatPoints(scoreBefore)} a ${formatPoints(scoreAfter)}`;
  }
  return "Corrección guardada · la nota no cambió";
}
