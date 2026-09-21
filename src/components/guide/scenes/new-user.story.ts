/**
 * Crear usuario: se llenan nombre, correo y rol, y al crearlo aparece una
 * contraseña temporal que se muestra una sola vez (hay que copiarla).
 */
export const NEW_USER_CYCLE_MS = 11_000;

export type NewUserState = {
  stage: "form" | "creating" | "created";
  /** Campos escritos del formulario */
  fields: { name: string; email: string; role: "Estudiante" | "Maestro" | "Administrador" };
  /** Contraseña temporal (solo cuando ya se creó) */
  password: string | null;
  /** El aviso «se muestra una sola vez» está visible */
  warning: boolean;
  /** Se copió al portapapeles */
  copied: boolean;
};

const NAME = "Ana Ruiz";
const EMAIL = "ana.ruiz@empresa.local";
const PASSWORD = "Xk7-quema-42";
const TYPING_END = 0.42;

/** Escribe el texto poco a poco entre dos fases. */
function typed(text: string, phase: number, from: number, to: number): string {
  if (phase <= from) return "";
  if (phase >= to) return text;
  const chars = Math.max(1, Math.round(((phase - from) / (to - from)) * text.length));
  return text.slice(0, chars);
}

export function newUserStory(phase: number): NewUserState {
  if (phase < TYPING_END) {
    return {
      stage: "form",
      fields: {
        name: typed(NAME, phase, 0.08, 0.24),
        email: typed(EMAIL, phase, 0.24, TYPING_END),
        role: "Estudiante",
      },
      password: null,
      warning: false,
      copied: false,
    };
  }

  const full = { name: NAME, email: EMAIL, role: "Estudiante" as const };
  // Pulsa «Crear usuario»
  if (phase < 0.52) {
    return { stage: "creating", fields: full, password: null, warning: false, copied: false };
  }
  // Aparece la contraseña temporal con su aviso
  if (phase < 0.8) {
    return { stage: "created", fields: full, password: PASSWORD, warning: true, copied: false };
  }
  // Y se copia
  return { stage: "created", fields: full, password: PASSWORD, warning: true, copied: true };
}
