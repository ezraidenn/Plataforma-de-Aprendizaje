"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getFileRecord } from "@/server/services/storage";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { actingOwnerId } from "@/server/auth/view-scope";
import { audit } from "@/server/services/audit";
import {
  createCourse,
  getOwnedCourse,
  updateCourse,
  publishCourse,
  setCourseStatus,
} from "@/server/services/courses";

export type CreateCourseResult = { ok: true; courseId: string } | { error: string };

export async function createCourseAction(input: {
  title: string;
  description?: string;
}): Promise<CreateCourseResult> {
  const user = await requireTeacher();
  const title = input.title?.trim();
  if (!title) return { error: "Escribe un título para el curso" };
  if (title.length > 200) return { error: "El título es demasiado largo (máximo 200 caracteres)" };

  try {
    // En «Ver como maestro», el curso nace a nombre de ese maestro
    const ownerId = actingOwnerId(await getViewScope(user), user);
    const course = createCourse({
      ownerId,
      title,
      description: input.description?.trim() ?? "",
    });
    if (ownerId !== user.id) audit(user.id, "create_course", "courses", course.id, { onBehalfOf: ownerId });
    revalidatePath("/teach/courses");
    revalidatePath("/teach/dashboard");
    return { ok: true, courseId: course.id };
  } catch {
    return { error: "No se pudo crear el curso. Intenta de nuevo." };
  }
}

export type UpdateCourseResult = { ok: true } | { error: string };

export async function updateCourseAction(
  courseId: string,
  patch: {
    title?: string;
    description?: string;
    enforceSequence?: boolean;
    validityMode?: "lifetime" | "calendar_year" | "months";
    validityMonths?: number | null;
  }
): Promise<UpdateCourseResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  if (patch.title !== undefined && !patch.title.trim()) {
    return { error: "El título no puede quedar vacío" };
  }
  if (patch.validityMode !== undefined) {
    if (!["lifetime", "calendar_year", "months"].includes(patch.validityMode)) {
      return { error: "Vigencia no válida" };
    }
    if (patch.validityMode === "months") {
      const n = Number(patch.validityMonths);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        return { error: "La vigencia en meses debe ser un número entre 1 y 120" };
      }
    }
  }

  try {
    updateCourse(courseId, {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.enforceSequence !== undefined ? { enforceSequence: patch.enforceSequence } : {}),
      ...(patch.validityMode !== undefined
        ? {
            validityMode: patch.validityMode,
            validityMonths: patch.validityMode === "months" ? Number(patch.validityMonths) : null,
          }
        : {}),
    });
    revalidatePath(`/teach/courses/${courseId}`, "layout");
    revalidatePath("/teach/courses");
    revalidatePath("/teach/dashboard");
    return { ok: true };
  } catch {
    return { error: "No se pudieron guardar los cambios. Intenta de nuevo." };
  }
}

/** Foto del curso: undefined no toca; null la quita; fileId (kind cover, imagen ≤10 MB). */
export async function setCourseCoverAction(
  courseId: string,
  fileId: string | null
): Promise<UpdateCourseResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  if (fileId) {
    const record = getFileRecord(fileId);
    if (!record || record.kind !== "cover" || record.uploadedBy !== user.id) {
      return { error: "Sube primero la imagen del curso" };
    }
    if (!/^image\/(png|jpeg|webp)$/.test(record.mimeType)) {
      return { error: "La imagen debe ser PNG, JPG o WEBP" };
    }
  }
  try {
    updateCourse(courseId, { coverFileId: fileId });
    revalidatePath(`/teach/courses/${courseId}`, "layout");
    revalidatePath("/teach/courses");
    revalidatePath("/teach/dashboard");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch {
    return { error: "No se pudo guardar la imagen. Intenta de nuevo." };
  }
}

export type PublishCourseResult =
  | { ok: true }
  | { ok: false; blockers: string[] }
  | { error: string };

export async function publishCourseAction(courseId: string): Promise<PublishCourseResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  try {
    const result = publishCourse(courseId);
    if (!result.ok) return { ok: false, blockers: result.blockers };
    revalidatePath(`/teach/courses/${courseId}`, "layout");
    revalidatePath("/teach/courses");
    revalidatePath("/teach/dashboard");
    return { ok: true };
  } catch {
    return { error: "No se pudo publicar el curso. Intenta de nuevo." };
  }
}

export type SetCourseStatusResult = { ok: true } | { error: string };

/** Cambios de estado que no requieren validación: volver a borrador o archivar. */
export async function setCourseStatusAction(
  courseId: string,
  status: "draft" | "archived"
): Promise<SetCourseStatusResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  try {
    setCourseStatus(courseId, status);
    revalidatePath(`/teach/courses/${courseId}`, "layout");
    revalidatePath("/teach/courses");
    revalidatePath("/teach/dashboard");
    return { ok: true };
  } catch {
    return { error: "No se pudo cambiar el estado del curso. Intenta de nuevo." };
  }
}
