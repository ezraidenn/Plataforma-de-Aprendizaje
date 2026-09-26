import "server-only";
import { db } from "@/server/db";
import { isNotInCsvType, questionProblem } from "@/lib/question-validation";
import { createQuestion, deleteQuestion, listQuestions, reorderQuestions, type QuestionInput } from "./exams";
import { audit } from "./audit";

/**
 * Importa preguntas ya interpretadas (del CSV o de la IA). Todo ocurre en una
 * transacción: si algo falla al crearlas, el examen queda como estaba (ni
 * siquiera «reemplazar» borra nada). Las preguntas sobre imagen no se pueden
 * expresar en CSV ni las crea la IA, así que «reemplazar» las conserva tal
 * cual en vez de borrarlas (`kept`; por ahora también clasificar y completar,
 * ver NOT_IN_CSV_TYPES) — y, para que el examen no quede
 * desordenado, cada una vuelve a su lugar original: las nuevas llenan los
 * huecos que dejaron las que sí se borraron, en su mismo orden, y las que
 * sobran (si hay más nuevas que huecos) van al final. La auditoría guarda
 * conteos, nunca el contenido.
 */
export function importQuestionInputs(opts: {
  actorId: string;
  examItemId: string;
  inputs: QuestionInput[];
  mode: "replace" | "append";
  source: "csv" | "ai";
  /** Filas que ya se descartaron antes (p. ej. renglones inválidos del CSV) */
  alreadySkipped?: number;
}): { imported: number; skipped: number; kept: number } {
  const valid = opts.inputs.filter((input) => questionProblem(input) === null);
  const skipped = opts.inputs.length - valid.length + (opts.alreadySkipped ?? 0);
  if (valid.length === 0) throw new Error("No hay preguntas válidas para importar");

  let kept = 0;
  db.transaction(() => {
    if (opts.mode === "replace") {
      // Orden ANTES de tocar nada: el índice en este arreglo es el lugar al
      // que cada pregunta sobre imagen debe volver
      const original = listQuestions(opts.examItemId);
      for (const q of original) {
        if (!isNotInCsvType(q.type)) deleteQuestion(opts.examItemId, q.id);
      }
      const newIds = valid.map((input) => createQuestion(opts.examItemId, input));
      kept = original.filter((q) => isNotInCsvType(q.type)).length;

      // Un solo recorrido: cada imagen vuelve a su índice original, las
      // nuevas llenan los huecos (en su orden) y las que sobran van al final
      let newCursor = 0;
      const finalOrder: string[] = [];
      for (const q of original) {
        if (isNotInCsvType(q.type)) {
          finalOrder.push(q.id);
        } else if (newCursor < newIds.length) {
          finalOrder.push(newIds[newCursor]);
          newCursor++;
        }
        // Hueco sin nueva pregunta que lo llene: se compacta (no deja un lugar vacío)
      }
      while (newCursor < newIds.length) {
        finalOrder.push(newIds[newCursor]);
        newCursor++;
      }
      reorderQuestions(opts.examItemId, finalOrder);
    } else {
      for (const input of valid) createQuestion(opts.examItemId, input);
    }
  });

  const imported = valid.length;
  audit(opts.actorId, opts.source === "ai" ? "ai_import_exam" : "import_exam_csv", "exams", opts.examItemId, {
    mode: opts.mode,
    imported,
    skipped,
    kept,
  });
  return { imported, skipped, kept };
}
