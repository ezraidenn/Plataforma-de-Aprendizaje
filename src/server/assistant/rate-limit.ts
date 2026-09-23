import "server-only";

/**
 * Freno de mano del asistente: como mucho 20 turnos por usuario cada 5
 * minutos. Cada turno cuesta dinero (la API) y tiempo, así que un clic
 * desbocado o una pestaña en bucle no deben poder vaciar la cuenta.
 *
 * Se cuenta en memoria del proceso: no sirve contra un atacante decidido (un
 * reinicio lo borra, y con varios procesos cada uno lleva su cuenta), pero sí
 * para lo que pasa de verdad. Guardar esto en la base sería una escritura por
 * pregunta para nada.
 */

/** Turnos permitidos por usuario dentro de la ventana. */
export const RATE_LIMIT_TURNS = 20;
/** Ventana en la que se cuentan esos turnos. */
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
/** Usuarios a los que se les lleva la cuenta antes de barrer los viejos. */
const MAX_TRACKED = 500;

/** Cuándo preguntó cada usuario, dentro de la ventana. */
const hits = new Map<string, number[]>();

/** Quita del mapa a quien no ha preguntado en toda la ventana. */
function prune(now: number): void {
  for (const [id, times] of hits) {
    if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) hits.delete(id);
  }
}

/**
 * Apunta el turno y dice si el usuario se pasó del tope. `true` = no se le
 * atiende esta vez (y no se le cuenta: así no se castiga al que espera).
 */
export function rateLimitHit(userId: string, now = Date.now()): boolean {
  if (hits.size > MAX_TRACKED) prune(now);
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  hits.set(userId, recent);
  if (recent.length >= RATE_LIMIT_TURNS) return true;
  recent.push(now);
  return false;
}
