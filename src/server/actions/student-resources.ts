"use server";

import { revalidatePath } from "next/cache";
import { requireStudent } from "@/server/auth/guards";
import { markLinkOpened, markResourceDownloaded } from "@/server/services/resources";

export type MarkResult = { ok: true } | { error: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** El alumno abrió el enlace externo: el ítem queda completado. */
export async function markLinkOpenedAction(input: {
  courseId: string;
  itemId: string;
}): Promise<MarkResult> {
  const user = await requireStudent();
  try {
    markLinkOpened(input.courseId, user.id, input.itemId);
    revalidatePath(`/courses/${input.courseId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo registrar la visita al enlace.") };
  }
}

/** El alumno descargó un archivo del recurso: el ítem queda completado. */
export async function markResourceDownloadedAction(input: {
  courseId: string;
  itemId: string;
}): Promise<MarkResult> {
  const user = await requireStudent();
  try {
    markResourceDownloaded(input.courseId, user.id, input.itemId);
    revalidatePath(`/courses/${input.courseId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo registrar la descarga.") };
  }
}
