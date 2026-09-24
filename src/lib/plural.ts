/**
 * Concuerda en número: `singular` si n === 1, si no `many`. No antepone el
 * número — cada texto decide dónde ponerlo — así sirve para acordar
 * sustantivos, verbos o frases completas dentro de un mismo mensaje.
 */
export function plural(n: number, singular: string, many: string): string {
  return n === 1 ? singular : many;
}
