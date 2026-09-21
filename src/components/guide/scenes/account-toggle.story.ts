/**
 * Activar / desactivar una cuenta: al desactivarla se cierran sus sesiones y
 * no puede entrar, pero su avance y sus certificados se conservan.
 */
export const ACCOUNT_TOGGLE_CYCLE_MS = 10_000;

export type AccountToggleState = {
  /** La cuenta está activa */
  active: boolean;
  /** Sesiones abiertas del usuario */
  sessions: number;
  /** Lo que se conserva pase lo que pase */
  keeps: { progress: string; certificates: number };
  /** Intentó entrar mientras está inactiva */
  loginBlocked: boolean;
};

/** Nunca cambia: desactivar no borra nada. */
const KEEPS = { progress: "80%", certificates: 2 };

export function accountToggleStory(phase: number): AccountToggleState {
  // Activa, con sus sesiones abiertas
  if (phase < 0.25) {
    return { active: true, sessions: 2, keeps: KEEPS, loginBlocked: false };
  }
  // Se desactiva: las sesiones se cierran
  if (phase < 0.5) {
    return { active: false, sessions: 0, keeps: KEEPS, loginBlocked: false };
  }
  // Y si intenta entrar, no puede
  if (phase < 0.75) {
    return { active: false, sessions: 0, keeps: KEEPS, loginBlocked: true };
  }
  // Al reactivarla, vuelve como estaba
  return { active: true, sessions: 0, keeps: KEEPS, loginBlocked: false };
}
