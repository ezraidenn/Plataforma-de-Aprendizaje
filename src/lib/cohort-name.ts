/** Largo permitido del nombre de un grupo (mismo límite que valida el servidor). */
export const COHORT_NAME_MIN = 2;
export const COHORT_NAME_MAX = 80;

/** Nombre limpio como lo guarda el servidor: sin espacios sobrantes. */
export function cleanCohortName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Clave para saber si dos nombres son «el mismo grupo» igual que el servidor:
 * nombre limpio y minúsculas SOLO en A-Z (el `lower()` de SQLite no toca
 * acentos ni ñ). Así el aviso «ya existe» coincide con lo que de verdad pasa.
 */
export function cohortNameKey(name: string): string {
  return cleanCohortName(name).replace(/[A-Z]/g, (c) => c.toLowerCase());
}
