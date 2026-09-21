"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { requireTeacher } from "@/server/auth/guards";
import { db } from "@/server/db";
import { enrollments } from "@/server/db/schema";
import {
  assignEnrollmentsToCohort,
  canManageCohort,
  cohortOptions,
  createCohort,
  findOrCreateCohort,
  renameCohort,
  setCohortStatus,
  type CohortOption,
} from "@/server/services/cohorts";
import { getOwnedCourse, importCohortIntoCourse } from "@/server/services/courses";

type Result<T = object> = ({ ok: true } & T) | { error: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function revalidateCohortViews(courseId?: string | null) {
  revalidatePath("/teach/groups");
  revalidatePath("/teach/students");
  revalidatePath("/teach/reports");
  revalidatePath("/teach/renewals");
  if (courseId) revalidatePath(`/teach/courses/${courseId}`, "layout");
}

/** Grupo nuevo en un curso del maestro. */
export async function createCohortAction(
  courseId: string,
  name: string
): Promise<Result<{ id: string; name: string }>> {
  const user = await requireTeacher();
  if (!getOwnedCourse(courseId, user)) return { error: "No encontramos este curso o no te pertenece" };
  try {
    const cohort = createCohort(courseId, name, user.id);
    revalidateCohortViews(courseId);
    return { ok: true, id: cohort.id, name: cohort.name };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo crear el grupo") };
  }
}

export async function renameCohortAction(id: string, name: string): Promise<Result> {
  const user = await requireTeacher();
  const cohort = canManageCohort(user, id);
  if (!cohort) return { error: "No encontramos este grupo o no es de tus cursos" };
  try {
    renameCohort(id, name, user.id);
    revalidateCohortViews(cohort.courseId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo renombrar el grupo") };
  }
}

/** Cerrar saca el grupo de las vistas diarias; reabrir lo devuelve. Nada se borra. */
export async function setCohortStatusAction(id: string, status: "open" | "closed"): Promise<Result> {
  const user = await requireTeacher();
  const cohort = canManageCohort(user, id);
  if (!cohort) return { error: "No encontramos este grupo o no es de tus cursos" };
  try {
    setCohortStatus(id, status, user.id);
    revalidateCohortViews(cohort.courseId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo cambiar el estado del grupo") };
  }
}

/** Grupos abiertos de un curso, para los selectores de los formularios. */
export async function listCohortOptionsAction(courseId: string): Promise<CohortOption[]> {
  const user = await requireTeacher();
  if (!getOwnedCourse(courseId, user)) return [];
  return cohortOptions(courseId);
}

/**
 * Mueve matrículas del curso a uno de SUS grupos (existente o nuevo por
 * nombre) o las deja sin grupo.
 */
export async function assignToCohortAction(
  courseId: string,
  enrollmentIds: string[],
  target: { cohortId?: string | null; newCohortName?: string | null }
): Promise<Result<{ count: number }>> {
  const user = await requireTeacher();
  if (!getOwnedCourse(courseId, user)) return { error: "No encontramos este curso o no te pertenece" };
  if (enrollmentIds.length === 0) return { error: "Selecciona al menos un estudiante" };
  try {
    const allowed = db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(inArray(enrollments.id, enrollmentIds), eq(enrollments.courseId, courseId)))
      .all()
      .map((r) => r.id);
    const name = target.newCohortName?.trim();
    const cohortId = name ? findOrCreateCohort(courseId, name, user.id) : (target.cohortId ?? null);
    const count = assignEnrollmentsToCohort(allowed, cohortId);
    revalidateCohortViews(courseId);
    return { ok: true, count };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo mover al grupo") };
  }
}

/**
 * Trae a este curso un grupo de otro curso: inscribe a sus miembros en un
 * grupo con el mismo nombre. El grupo de origen no se toca.
 */
export async function importCohortAction(
  targetCourseId: string,
  sourceCohortId: string
): Promise<Result<{ cohortId: string | null; cohortName: string; enrolled: number; alreadyEnrolled: number }>> {
  const user = await requireTeacher();
  const course = getOwnedCourse(targetCourseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  if (course.status === "archived") return { error: "El curso está archivado" };
  if (!canManageCohort(user, sourceCohortId)) return { error: "No encontramos ese grupo o no es de tus cursos" };
  try {
    const result = importCohortIntoCourse(sourceCohortId, targetCourseId, user.id);
    revalidateCohortViews(targetCourseId);
    revalidatePath("/teach/dashboard");
    return { ok: true, ...result };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo inscribir el grupo") };
  }
}
