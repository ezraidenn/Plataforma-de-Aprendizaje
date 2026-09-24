import { plural } from "./plural";

/**
 * Aviso de «reemplazar» preguntas de examen: qué se borra y qué se conserva
 * (las preguntas sobre imagen nunca se borran), con concordancia. Lo usan el
 * diálogo de importar CSV y el de importar con IA — mismo texto en los dos.
 */
export function replaceWarning(nonImageCount: number, imageCount: number): string {
  const partes: string[] = [];
  if (nonImageCount > 0) {
    partes.push(
      imageCount > 0
        ? plural(
            nonImageCount,
            "se borrará la pregunta que no es sobre imagen",
            `se borrarán las ${nonImageCount} preguntas que no son sobre imagen`
          )
        : plural(nonImageCount, "se borrará la pregunta actual", `se borrarán las ${nonImageCount} preguntas actuales`)
    );
  }
  if (imageCount > 0) {
    partes.push(
      plural(
        imageCount,
        "la pregunta sobre imagen se conserva tal como está",
        `las ${imageCount} preguntas sobre imagen se conservan tal como están`
      )
    );
  }
  const texto = `${partes.join("; ")}.`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
