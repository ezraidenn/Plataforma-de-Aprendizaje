"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/guards";
import { db } from "@/server/db";
import { courses } from "@/server/db/schema";
import { adminReassignCourse } from "@/server/services/admin";
import { audit } from "@/server/services/audit";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export type AdminReassignCourseResult = { ok: true } | { error: string };

/** Cambia el dueño de un curso a otro maestro o administrador activo. */
export async function adminReassignCourseAction(
  courseId: string,
  newOwnerId: string
): Promise<AdminReassignCourseResult> {
  const actor = await requireAdmin();
  if (!newOwnerId) return { error: "Elige al nuevo dueño del curso" };

  try {
    adminReassignCourse(actor.id, courseId, newOwnerId);
    revalidatePath("/admin/courses");
    revalidatePath("/teach/courses");
    revalidatePath("/teach/dashboard");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo reasignar el curso. Intenta de nuevo.") };
  }
}

export type AdminArchiveCourseResult = { ok: true } | { error: string };

/** Archiva cualquier curso de la plataforma (los estudiantes dejan de verlo). */
export async function adminArchiveCourseAction(
  courseId: string
): Promise<AdminArchiveCourseResult> {
  const actor = await requireAdmin();

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return { error: "No encontramos este curso" };
  if (course.status === "archived") return { error: "El curso ya está archivado" };

  try {
    db.update(courses)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(courses.id, courseId))
      .run();
    audit(actor.id, "archive_course", "courses", courseId, {
      title: course.title,
      previousStatus: course.status,
    });
    revalidatePath("/admin/courses");
    revalidatePath("/teach/courses");
    revalidatePath("/teach/dashboard");
    return { ok: true };
  } catch {
    return { error: "No se pudo archivar el curso. Intenta de nuevo." };
  }
}
