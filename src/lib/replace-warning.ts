import { plural } from "./plural";

/**
 * Aviso de «reemplazar» preguntas de examen: qué se borra y qué se conserva
 * (las que no caben en el CSV nunca se borran: ver `csvRepresentable`), con
 * concordancia. Lo usan el diálogo de importar CSV y el de importar con IA —
 * mismo texto en los dos.
 */
export function replaceWarning(replacedCount: number, keptCount: number): string {
  const partes: string[] = [];
  if (replacedCount > 0) {
    partes.push(
      keptCount > 0
        ? plural(
            replacedCount,
            "se borrará la pregunta que sí cabe en el CSV",
            `se borrarán las ${replacedCount} preguntas que sí caben en el CSV`
          )
        : plural(replacedCount, "se borrará la pregunta actual", `se borrarán las ${replacedCount} preguntas actuales`)
    );
  }
  if (keptCount > 0) {
    partes.push(
      plural(
        keptCount,
        "la pregunta que no cabe en el CSV se conserva tal como está",
        `las ${keptCount} preguntas que no caben en el CSV se conservan tal como están`
      )
    );
  }
  const texto = `${partes.join("; ")}.`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
