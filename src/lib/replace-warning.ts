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
    partes.push(plural(replacedCount, "se borrará la pregunta actual", `se borrarán las ${replacedCount} preguntas actuales`));
  }
  if (keptCount > 0) {
    partes.push(
      replacedCount > 0
        ? plural(keptCount, "se conserva tal como está la que no cabe en el CSV", `se conservan tal como están las ${keptCount} que no caben en el CSV`)
        : plural(
            keptCount,
            "se conserva tal como está la pregunta que no cabe en el CSV",
            `se conservan tal como están las ${keptCount} preguntas que no caben en el CSV`
          )
    );
  }
  const texto = `${partes.join("; ")}.`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
