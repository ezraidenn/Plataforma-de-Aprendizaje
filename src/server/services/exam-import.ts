import "server-only";
import { db } from "@/server/db";
import { questionProblem } from "@/lib/question-validation";
import { createQuestion, deleteQuestion, listQuestions, type QuestionInput } from "./exams";
import { audit } from "./audit";

/**
 * Importa preguntas ya interpretadas (del CSV o de la IA). Todo ocurre en una
 * transacción: si algo falla al crearlas, el examen queda como estaba (ni
 * siquiera «reemplazar» borra nada). La auditoría guarda conteos, nunca el
 * contenido.
 */
export function importQuestionInputs(opts: {
  actorId: string;
  examItemId: string;
  inputs: QuestionInput[];
  mode: "replace" | "append";
  source: "csv" | "ai";
  /** Filas que ya se descartaron antes (p. ej. renglones inválidos del CSV) */
  alreadySkipped?: number;
}): { imported: number; skipped: number } {
  const valid = opts.inputs.filter((input) => questionProblem(input) === null);
  const skipped = opts.inputs.length - valid.length + (opts.alreadySkipped ?? 0);
  if (valid.length === 0) throw new Error("No hay preguntas válidas para importar");

  db.transaction(() => {
    if (opts.mode === "replace") {
      for (const q of listQuestions(opts.examItemId)) deleteQuestion(opts.examItemId, q.id);
    }
    for (const input of valid) createQuestion(opts.examItemId, input);
  });

  const imported = valid.length;
  audit(opts.actorId, opts.source === "ai" ? "ai_import_exam" : "import_exam_csv", "exams", opts.examItemId, {
    mode: opts.mode,
    imported,
    skipped,
  });
  return { imported, skipped };
}
