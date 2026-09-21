/**
 * Validación de una pregunta, pura (sin BD): la usa el servicio al guardar y
 * el diálogo de IA para marcar lo que falta antes de importar. Los textos son
 * los mismos que ve el maestro en el editor.
 */
export type QuestionShape = {
  type: "single_choice" | "multiple_choice" | "true_false" | "short_text" | "matching" | "ordering" | "open_text";
  promptMd: string;
  points: number;
  config?: unknown;
  options?: { textMd: string; isCorrect: boolean }[];
};

/** null = válida; si no, el primer problema encontrado. */
export function questionProblem(input: QuestionShape): string | null {
  if (!input.promptMd.trim()) return "La pregunta necesita un enunciado";
  if (!(input.points > 0)) return "Los puntos deben ser mayores a cero";

  if (input.type === "single_choice" || input.type === "true_false") {
    const opts = input.options ?? [];
    if (opts.length < 2) return "Agrega al menos dos opciones";
    if (opts.filter((o) => o.isCorrect).length !== 1) return "Marca exactamente una opción correcta";
  }
  if (input.type === "multiple_choice") {
    const opts = input.options ?? [];
    if (opts.length < 2) return "Agrega al menos dos opciones";
    if (!opts.some((o) => o.isCorrect)) return "Marca al menos una opción correcta";
  }
  if (input.type === "short_text") {
    const accepted = (input.config as { accepted?: string[] } | undefined)?.accepted ?? [];
    if (accepted.filter((a) => a.trim()).length === 0) return "Agrega al menos una respuesta aceptada";
  }
  if (input.type === "matching") {
    const pairs = (input.config as { pairs?: { left: string; right: string }[] } | undefined)?.pairs ?? [];
    if (pairs.length < 2) return "Agrega al menos dos pares para relacionar";
  }
  if (input.type === "ordering") {
    const steps = (input.config as { steps?: string[] } | undefined)?.steps ?? [];
    const clean = steps.map((s) => s.trim());
    if (clean.length < 3) return "Agrega al menos tres pasos para ordenar";
    if (clean.length > 10) return "Usa como máximo diez pasos";
    if (clean.some((s) => !s)) return "Ningún paso puede quedar vacío";
    if (new Set(clean.map((s) => s.toLowerCase())).size !== clean.length) {
      return "Hay pasos repetidos: cada paso debe ser distinto";
    }
  }
  return null;
}
