"use server";

import { sanitizeRichHtml, isHtmlContent } from "@/lib/rich-html";

/** HTML del editor → saneado; markdown legado se deja igual. */
function cleanRich(s: string): string {
  return isHtmlContent(s) ? sanitizeRichHtml(s) : s;
}

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import {
  getAssignmentDetail,
  updateAssignmentSettings,
} from "@/server/services/assignments";

export type AssignmentSettingsInput = {
  instructionsMd: string;
  /** Timestamp en ms (hora local convertida en el cliente); null = sin fecha límite */
  dueAtMs: number | null;
  maxScore: number;
  /** Extensiones separadas por coma, ej. ".pdf,.docx"; vacío = cualquier archivo */
  allowedFileTypes: string;
  allowResubmission: boolean;
  allowLate: boolean;
};

export type UpdateAssignmentSettingsResult = { ok: true } | { error: string };

/** Normaliza ".PDF, docx ,.zip" → ".pdf,.docx,.zip"; null si hay un token inválido. */
function normalizeFileTypes(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const tokens = trimmed
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith(".") ? t : `.${t}`));
  if (tokens.length === 0) return "";
  for (const token of tokens) {
    if (!/^\.[a-z0-9]{1,10}$/.test(token)) return null;
  }
  return tokens.join(",");
}

export async function updateAssignmentSettingsAction(
  courseId: string,
  itemId: string,
  input: AssignmentSettingsInput
): Promise<UpdateAssignmentSettingsResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  const item = getItem(itemId);
  if (!item || item.courseId !== courseId || item.kind !== "assignment") {
    return { error: "No encontramos esta tarea" };
  }
  if (!getAssignmentDetail(itemId)) return { error: "No encontramos esta tarea" };

  const maxScore = Math.round(input.maxScore);
  if (!Number.isFinite(maxScore) || maxScore < 1 || maxScore > 1000) {
    return { error: "Los puntos máximos deben ser un número entre 1 y 1000" };
  }

  if (input.dueAtMs !== null && !Number.isFinite(input.dueAtMs)) {
    return { error: "La fecha límite no es válida" };
  }

  const allowedFileTypes = normalizeFileTypes(input.allowedFileTypes);
  if (allowedFileTypes === null) {
    return { error: "Tipos de archivo no válidos. Usa extensiones separadas por coma, ej. .pdf,.docx" };
  }

  try {
    updateAssignmentSettings(itemId, {
      instructionsMd: cleanRich(input.instructionsMd),
      dueAt: input.dueAtMs === null ? null : new Date(input.dueAtMs),
      maxScore,
      allowedFileTypes,
      allowResubmission: input.allowResubmission,
      allowLate: input.allowLate,
    });
    revalidatePath(`/teach/courses/${courseId}`, "layout");
    return { ok: true };
  } catch {
    return { error: "No se pudieron guardar los cambios. Intenta de nuevo." };
  }
}
