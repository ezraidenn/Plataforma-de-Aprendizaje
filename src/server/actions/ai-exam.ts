"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireTeacher } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/sessions";
import { ownedExamItem, type ExamItem } from "@/server/services/exam-access";
import { listQuestions } from "@/server/services/exams";
import { audit } from "@/server/services/audit";
import {
  clearAiKey,
  getAiKey,
  getAiSettings,
  saveAiSettings,
  testAiConnection,
  validateAiKey,
  validateAiModel,
} from "@/server/services/ai-settings";
import { interpretChunkWithRetry, toDrafts } from "@/server/services/ai-exam-import";
import { importQuestionInputs } from "@/server/services/exam-import";
import { inputsToCsv } from "@/server/services/exam-csv";
import { draftToInput, type QuestionDraft } from "@/lib/question-draft";
import { draftToPreview, questionToDraft, type PreviewQuestion } from "@/lib/preview-question";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

type ExamGuard = { error: string } | { user: SessionUser; item: ExamItem };

/** El ítem debe ser un examen de un curso del maestro (o de cualquiera, si es admin). */
async function guardExam(courseId: string, itemId: string): Promise<ExamGuard> {
  const user = await requireTeacher();
  const access = ownedExamItem(user, courseId, itemId);
  return "error" in access ? access : { user, item: access.item };
}

/**
 * Borradores que llegan del navegador: no son de fiar. Se vuelven a pasar por
 * la misma normalización que la respuesta de la IA.
 */
function cleanDrafts(drafts: unknown): QuestionDraft[] {
  return toDrafts({ questions: Array.isArray(drafts) ? drafts : [] });
}

// ─── Administrador: configurar OpenAI ────────────────────────────────────────

export type AiSettingsResult = { ok: true } | { error: string };

export async function saveAiSettingsAction(input: { key?: string; model: string }): Promise<AiSettingsResult> {
  const user = await requireAdmin();
  try {
    saveAiSettings(input);
    audit(user.id, "update_ai_settings", "app_settings", undefined, {
      model: input.model.trim(),
      keyChanged: !!input.key?.trim(),
    });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo guardar la configuración.") };
  }
}

export async function clearAiKeyAction(): Promise<AiSettingsResult> {
  const user = await requireAdmin();
  clearAiKey();
  audit(user.id, "clear_ai_settings", "app_settings");
  revalidatePath("/admin/settings");
  return { ok: true };
}

/** Prueba la clave escrita (o la guardada) contra el modelo indicado. */
export async function testAiConnectionAction(input: { key?: string; model: string }): Promise<AiSettingsResult> {
  await requireAdmin();
  try {
    const key = input.key?.trim() ? validateAiKey(input.key) : getAiKey();
    const model = validateAiModel(input.model);
    return await testAiConnection(key, model);
  } catch (err) {
    return { error: errorMessage(err, "No se pudo probar la conexión.") };
  }
}

// ─── Maestro: analizar, importar, CSV y vista previa ─────────────────────────

export type AnalyzeChunkResult = { drafts: QuestionDraft[] } | { error: string };

/** Un tramo del archivo → borradores (el diálogo los pide uno por uno, con avance). */
export async function analyzeChunkAction(input: {
  courseId: string;
  itemId: string;
  chunk: string;
}): Promise<AnalyzeChunkResult> {
  const guard = await guardExam(input.courseId, input.itemId);
  if ("error" in guard) return { error: guard.error };
  if (!input.chunk?.trim()) return { drafts: [] };
  if (input.chunk.length > 20_000) return { error: "El tramo es demasiado largo" };

  const key = getAiKey();
  if (!key) return { error: "La IA no está configurada. Pide al administrador que agregue la clave de OpenAI." };
  try {
    const drafts = await interpretChunkWithRetry(input.chunk, { key, model: getAiSettings().model });
    return { drafts };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo interpretar el tramo.") };
  }
}

export type ImportAiResult = { ok: true; imported: number; skipped: number } | { error: string };

export async function importAiQuestionsAction(input: {
  courseId: string;
  itemId: string;
  drafts: QuestionDraft[];
  mode: "replace" | "append";
}): Promise<ImportAiResult> {
  const guard = await guardExam(input.courseId, input.itemId);
  if ("error" in guard) return { error: guard.error };
  if (input.mode !== "replace" && input.mode !== "append") return { error: "Modo de importación desconocido" };
  try {
    const result = importQuestionInputs({
      actorId: guard.user.id,
      examItemId: input.itemId,
      inputs: cleanDrafts(input.drafts).map(draftToInput),
      mode: input.mode,
      source: "ai",
    });
    revalidatePath(`/teach/courses/${input.courseId}/items/${input.itemId}/edit`);
    revalidatePath(`/teach/courses/${input.courseId}/content`);
    return { ok: true, ...result };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo completar la importación. Intenta de nuevo.") };
  }
}

export type DraftsCsvResult = { csv: string; filename: string } | { error: string };

/** «Descargar como CSV»: los borradores en el formato de «Importar CSV». */
export async function draftsToCsvAction(input: {
  courseId: string;
  itemId: string;
  drafts: QuestionDraft[];
}): Promise<DraftsCsvResult> {
  const guard = await guardExam(input.courseId, input.itemId);
  if ("error" in guard) return { error: guard.error };
  const slug = guard.item.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return { csv: inputsToCsv(cleanDrafts(input.drafts).map(draftToInput)), filename: `${slug || "examen"}-ia.csv` };
}

export type ExamPreviewResult = { questions: PreviewQuestion[] } | { error: string };

/** «Ver como alumno» del examen guardado, con la clave para el interruptor. */
export async function examPreviewAction(input: { courseId: string; itemId: string }): Promise<ExamPreviewResult> {
  const guard = await guardExam(input.courseId, input.itemId);
  if ("error" in guard) return { error: guard.error };
  return { questions: listQuestions(input.itemId).map((q) => draftToPreview(questionToDraft(q))) };
}
