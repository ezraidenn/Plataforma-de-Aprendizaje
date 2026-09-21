/**
 * ¿El alumno ya puede ver su calificación en este examen? Regla única para
 * todo lo que muestra o envía un % al alumno. Sin BD: se prueba sola.
 *
 * - «Al enviar»: siempre.
 * - «Al cerrar el examen»: desde el cierre o desde que el maestro publique,
 *   lo que pase primero (sin fecha de cierre, solo al publicar).
 * - «Cuando yo decida»: desde que el maestro publique.
 */
export type ExamResultsMode = "immediately" | "after_close" | "manual";

export function resultsVisible(
  exam: { showResultsMode: ExamResultsMode; closesAt: Date | null; resultsPublishedAt: Date | null },
  now: number
): boolean {
  if (exam.showResultsMode === "immediately") return true;
  if (exam.resultsPublishedAt !== null) return true;
  return exam.showResultsMode === "after_close" && exam.closesAt !== null && exam.closesAt.getTime() <= now;
}
