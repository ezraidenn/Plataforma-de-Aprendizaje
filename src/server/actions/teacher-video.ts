"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import { setVideoLink } from "@/server/services/video";

const MAX_DURATION_SECONDS = 12 * 60 * 60;

export type SetVideoLinkResult = { ok: true } | { error: string };

/**
 * Vincula (o actualiza) el enlace de YouTube/Vimeo de un ítem de tipo video,
 * junto con su duración manual y el permiso de velocidad aumentada.
 * `durationSeconds: null` limpia la duración: el player del estudiante la
 * detecta en el primer load.
 */
export async function setVideoLinkAction(
  courseId: string,
  itemId: string,
  input: { url: string; durationSeconds: number | null; allowSpeedUp: boolean }
): Promise<SetVideoLinkResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  const item = getItem(itemId);
  if (!item || item.courseId !== courseId) return { error: "No encontramos esta lección" };
  if (item.kind !== "video") return { error: "Esta lección no es un video" };

  let durationSeconds: number | null = null;
  if (input.durationSeconds !== null) {
    durationSeconds = Math.round(input.durationSeconds);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > MAX_DURATION_SECONDS
    ) {
      return { error: "La duración no es válida (usa el formato min:seg, por ejemplo 12:30)" };
    }
  }

  try {
    setVideoLink({
      itemId,
      url: input.url,
      durationSeconds,
      allowSpeedUp: input.allowSpeedUp,
    });
    revalidatePath(`/teach/courses/${courseId}`, "layout");
    return { ok: true };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "No se pudo guardar el enlace. Intenta de nuevo.",
    };
  }
}
