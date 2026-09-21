"use server";

import { revalidatePath } from "next/cache";
import { requireStudent } from "@/server/auth/guards";
import { submitAssignment } from "@/server/services/assignments";
import { getItem } from "@/server/services/tree";
import { sanitizeRichHtml } from "@/lib/rich-html";
import { submissionToDto } from "@/components/student/lesson-data";
import type { SubmissionDto } from "@/components/student/types";

export type SubmitAssignmentResult =
  | { ok: true; submission: SubmissionDto }
  | { error: string };

/**
 * Entrega (o re-entrega) de tarea del estudiante, estilo Teams: texto de
 * respuesta (HTML saneado) y/o varios archivos ya subidos vía /api/uploads
 * (kind=submission). El servicio valida propiedad de archivos, acceso, fecha
 * límite y política de reentrega; marca el ítem completado y notifica.
 */
export async function submitAssignmentAction(input: {
  courseId: string;
  itemId: string;
  /** Compat con el cliente anterior (un archivo). */
  fileId?: string;
  fileIds?: string[];
  answerText?: string;
  comment?: string;
}): Promise<SubmitAssignmentResult> {
  const user = await requireStudent();

  const item = getItem(input.itemId);
  if (!item || item.courseId !== input.courseId || item.kind !== "assignment") {
    return { error: "Tarea no encontrada" };
  }

  try {
    const submission = submitAssignment({
      courseId: input.courseId,
      studentId: user.id,
      itemId: input.itemId,
      fileId: input.fileId ?? null,
      fileIds: input.fileIds ?? [],
      answerText: input.answerText ? sanitizeRichHtml(input.answerText) : "",
      comment: input.comment?.trim() || undefined,
    });

    revalidatePath(`/courses/${input.courseId}`);
    revalidatePath("/dashboard");

    return { ok: true, submission: submissionToDto(submission) };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "No se pudo entregar la tarea. Intenta de nuevo.",
    };
  }
}
