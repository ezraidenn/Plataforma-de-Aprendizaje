/**
 * Concuerda en número: `singular` si n === 1, si no `many`. No antepone el
 * número — cada texto decide dónde ponerlo — así sirve para acordar
 * sustantivos, verbos o frases completas dentro de un mismo mensaje.
 */
export function plural(n: number, singular: string, many: string): string {
  return n === 1 ? singular : many;
}

/** Una lista en español: «1», «1 y 4», «1, 3 y 4». */
export function joinY(list: (string | number)[]): string {
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}
