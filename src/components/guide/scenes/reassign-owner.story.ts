/**
 * Reasignar el dueño de un curso: si un maestro deja la empresa, su curso pasa
 * a otro y el historial de los alumnos queda intacto.
 */
export const REASSIGN_OWNER_CYCLE_MS = 10_000;

export const REASSIGN_FROM = "Prof. Roberto Martínez";
export const REASSIGN_TO = "Mtra. Ana Ruiz";

export type ReassignOwnerState = {
  /** Dueño actual del curso */
  owner: string;
  /** El menú para elegir maestro está abierto */
  picking: boolean;
  /** Ya se reasignó */
  done: boolean;
  /** Lo que no cambia */
  keeps: { students: number; percent: number; certificates: number };
};

/** Nunca cambia: reasignar no toca a los alumnos. */
const KEEPS = { students: 24, percent: 68, certificates: 9 };

export function reassignOwnerStory(phase: number): ReassignOwnerState {
  if (phase < 0.25) {
    return { owner: REASSIGN_FROM, picking: false, done: false, keeps: KEEPS };
  }
  // Se abre el menú y se elige al nuevo maestro
  if (phase < 0.6) {
    return { owner: REASSIGN_FROM, picking: true, done: false, keeps: KEEPS };
  }
  return { owner: REASSIGN_TO, picking: false, done: true, keeps: KEEPS };
}
