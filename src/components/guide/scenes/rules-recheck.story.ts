/**
 * Reevaluación automática: el alumno envía su examen, las condiciones se
 * recalculan solas, el curso pasa a aprobado y sale el certificado.
 */
export const RULES_RECHECK_CYCLE_MS = 11_000;

export type RecheckCondition = { label: string; passed: boolean | null };

export type RulesRecheckState = {
  /** Condiciones tal como las ve el alumno */
  conditions: RecheckCondition[];
  /** Llegó el envío del alumno */
  submitted: boolean;
  /** El curso quedó aprobado */
  approved: boolean;
  /** El certificado ya se emitió */
  certificate: boolean;
};

const VIEWING = "Ver el contenido (100%)";
const EXAM = "Evaluación parcial (mínimo 80%)";

export function rulesRecheckStory(phase: number): RulesRecheckState {
  // Antes del envío: el contenido ya está visto, el examen sin intento
  if (phase < 0.3) {
    return {
      conditions: [
        { label: VIEWING, passed: true },
        { label: EXAM, passed: null },
      ],
      submitted: false,
      approved: false,
      certificate: false,
    };
  }
  // Llega el envío: se vuelve a evaluar
  if (phase < 0.55) {
    return {
      conditions: [
        { label: VIEWING, passed: true },
        { label: EXAM, passed: null },
      ],
      submitted: true,
      approved: false,
      certificate: false,
    };
  }
  const both: RecheckCondition[] = [
    { label: VIEWING, passed: true },
    { label: EXAM, passed: true },
  ];
  // Las dos se cumplen: el curso queda aprobado
  if (phase < 0.78) {
    return { conditions: both, submitted: true, approved: true, certificate: false };
  }
  // Y con plantilla asignada, el certificado sale solo
  return { conditions: both, submitted: true, approved: true, certificate: true };
}
