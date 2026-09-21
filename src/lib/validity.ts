/**
 * Vigencia de certificados. Funciones puras e isomórficas: las usa el servidor
 * al emitir (para congelar `expires_at`) y la interfaz para mostrar el estado.
 */

export type ValidityMode = "lifetime" | "calendar_year" | "months";

export const VALIDITY_LABEL: Record<ValidityMode, string> = {
  lifetime: "Vitalicio",
  calendar_year: "Año calendario",
  months: "Meses desde que se aprueba",
};

/** Días antes del vencimiento en que un certificado pasa a «por vencer». */
export const EXPIRING_WINDOW_DAYS = 30;

/** Suma meses respetando fin de mes: 31/ene + 1 mes → 28 o 29/feb, no 3/mar. */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * Fecha de vencimiento de un certificado emitido en `issuedAt` según la política
 * del curso. `null` = vitalicio.
 */
export function computeExpiry(
  mode: ValidityMode,
  months: number | null | undefined,
  issuedAt: Date
): Date | null {
  if (mode === "calendar_year") {
    // Último instante del año de emisión (hora local del servidor)
    return new Date(issuedAt.getFullYear(), 11, 31, 23, 59, 59, 999);
  }
  if (mode === "months") {
    const n = Math.max(1, Math.min(120, Math.floor(months ?? 12)));
    return addMonths(issuedAt, n);
  }
  return null;
}

export type ValidityState = "lifetime" | "valid" | "expiring" | "expired";

export function validityState(expiresAt: Date | number | null | undefined, now = Date.now()): ValidityState {
  if (expiresAt === null || expiresAt === undefined) return "lifetime";
  const t = typeof expiresAt === "number" ? expiresAt : expiresAt.getTime();
  if (t < now) return "expired";
  if (t - now <= EXPIRING_WINDOW_DAYS * 86_400_000) return "expiring";
  return "valid";
}

/** Días que faltan (negativo si ya venció). */
export function daysUntil(expiresAt: Date | number, now = Date.now()): number {
  const t = typeof expiresAt === "number" ? expiresAt : expiresAt.getTime();
  return Math.ceil((t - now) / 86_400_000);
}

/** Descripción corta de la política para mostrar en ajustes o tarjetas. */
export function describePolicy(mode: ValidityMode, months: number | null | undefined): string {
  if (mode === "calendar_year") return "Vence el 31 de diciembre del año en que se emite";
  if (mode === "months") {
    const n = Math.max(1, Math.floor(months ?? 12));
    return `Vence ${n} ${n === 1 ? "mes" : "meses"} después de aprobar`;
  }
  return "No vence";
}
