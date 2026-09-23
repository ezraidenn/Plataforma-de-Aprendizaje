"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { db } from "@/server/db";
import { generateTempPassword } from "@/server/auth/passwords";
import { findOrCreateCohort } from "@/server/services/cohorts";
import { audit } from "@/server/services/audit";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { actingOwnerId } from "@/server/auth/view-scope";
import { studentAccountPermissions } from "@/server/services/student-scope";
import {
  NOT_YOUR_STUDENT_MSG,
  SHARED_STUDENT_DEACTIVATE_MSG,
  SHARED_STUDENT_RESET_MSG,
} from "@/lib/student-account";
import {
  createStudent,
  ExistingStudentError,
  listStudents,
  resetStudentPassword,
  setStudentActive,
  enrollStudents,
  unenrollStudent,
  listCourseStudents,
  getOwnedCourse,
  restoreEnrollments,
  listDroppedEnrollments,
  purgeDroppedEnrollments,
} from "@/server/services/courses";
import { isDeleteConfirmed } from "@/lib/delete-confirm";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ─── Alta y gestión de estudiantes ───────────────────────────────────────────

export type NewTempPasswordResult = { password: string };

/** Genera una contraseña temporal legible (el hash argon2 vive solo en el servidor). */
export async function newTempPasswordAction(): Promise<NewTempPasswordResult> {
  await requireTeacher();
  return { password: generateTempPassword() };
}

export type CreateStudentResult =
  | { ok: true; studentId: string }
  /** El correo ya es de un alumno del pool: se abre su ficha para matricularlo */
  | { existing: { studentId: string; fullName: string } }
  | { error: string };

export async function createStudentAction(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<CreateStudentResult> {
  const user = await requireTeacher();

  const fullName = input.fullName?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!fullName) return { error: "Escribe el nombre del estudiante" };
  if (!email || !EMAIL_RE.test(email)) return { error: "El correo no es válido" };
  if (!input.password || input.password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres" };
  }

  try {
    // En «Ver como maestro», el alumno queda registrado a nombre de ese maestro
    const scope = await getViewScope(user);
    const createdBy = actingOwnerId(scope, user);
    const studentId = await createStudent({
      fullName,
      email,
      password: input.password,
      createdBy,
    });
    if (createdBy !== user.id) {
      audit(user.id, "create_student", "users", studentId, { onBehalfOf: createdBy });
    }
    revalidatePath("/teach/students");
    revalidatePath("/teach/dashboard");
    return { ok: true, studentId };
  } catch (err) {
    if (err instanceof ExistingStudentError) {
      return { existing: { studentId: err.studentId, fullName: err.fullName } };
    }
    return { error: errorMessage(err, "No se pudo crear el estudiante. Intenta de nuevo.") };
  }
}

export type ResetPasswordResult = { ok: true; password: string } | { error: string };

/** Genera y asigna una contraseña temporal; se muestra UNA sola vez. */
export async function resetStudentPasswordAction(studentId: string): Promise<ResetPasswordResult> {
  const user = await requireTeacher();
  const perms = studentAccountPermissions(user, studentId);
  if (!perms.canResetPassword) {
    return { error: perms.mine ? SHARED_STUDENT_RESET_MSG : NOT_YOUR_STUDENT_MSG };
  }
  try {
    const password = generateTempPassword();
    await resetStudentPassword(studentId, password);
    // Quién dio una contraseña temporal a quién (la base de alumnos es compartida)
    audit(user.id, "reset_student_password", "users", studentId);
    return { ok: true, password };
  } catch {
    return { error: "No se pudo restablecer la contraseña. Intenta de nuevo." };
  }
}

export type SetStudentActiveResult = { ok: true } | { error: string };

export async function setStudentActiveAction(
  studentId: string,
  active: boolean
): Promise<SetStudentActiveResult> {
  const user = await requireTeacher();
  const perms = studentAccountPermissions(user, studentId);
  // Reactivar no perjudica a nadie; desactivar le cerraría los cursos de otros maestros
  if (!(active ? perms.canActivate : perms.canDeactivate)) {
    return { error: perms.mine ? SHARED_STUDENT_DEACTIVATE_MSG : NOT_YOUR_STUDENT_MSG };
  }
  try {
    setStudentActive(studentId, active);
    audit(user.id, active ? "activate_student" : "deactivate_student", "users", studentId);
    revalidatePath("/teach/students");
    return { ok: true };
  } catch {
    return { error: "No se pudo cambiar el estado de la cuenta. Intenta de nuevo." };
  }
}

// ─── Matrícula ───────────────────────────────────────────────────────────────

export type StudentSearchRow = {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  enrolled: boolean;
};

export type SearchStudentsResult = { rows: StudentSearchRow[]; total: number } | { error: string };

/** Búsqueda server-side para el diálogo de matrícula. */
export async function searchStudentsToEnrollAction(
  courseId: string,
  search: string
): Promise<SearchStudentsResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  // Para inscribir se busca en TODA la base (así se comparten alumnos entre
  // maestros); solo se exponen nombre, correo y estado
  const { rows, total } = listStudents({ kind: "all" }, { search, page: 1, pageSize: 20 });
  // Todos los grupos, cerrados incluidos: quien está en un grupo cerrado sigue inscrito
  const enrolledIds = new Set(
    listCourseStudents(courseId, { cohort: { kind: "all" } }).map((s) => s.studentId)
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      active: r.active,
      enrolled: enrolledIds.has(r.id),
    })),
    total,
  };
}

export type EnrollStudentsResult = { ok: true; count: number } | { error: string };


/**
 * Grupo elegido en el formulario: id de un grupo DEL CURSO, nombre (se usa el
 * grupo del curso con ese nombre o se crea), o ninguno.
 */
export type CohortChoice = { cohortId?: string | null; newCohortName?: string | null };

function resolveCohort(choice: CohortChoice | undefined, courseId: string, actorId: string): string | null {
  if (!choice) return null;
  const name = choice.newCohortName?.trim();
  if (name) return findOrCreateCohort(courseId, name, actorId);
  return choice.cohortId ?? null;
}

export async function enrollStudentsAction(
  courseId: string,
  studentIds: string[],
  cohort?: CohortChoice
): Promise<EnrollStudentsResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  if (studentIds.length === 0) return { error: "Selecciona al menos un estudiante" };

  try {
    const cohortId = resolveCohort(cohort, courseId, user.id);
    const count = enrollStudents(courseId, studentIds, user.id, { cohortId });
    // Inscribir abre el acceso a la cuenta del alumno (restablecer contraseña): queda registrado
    audit(user.id, "enroll_students", "enrollments", courseId, { count, cohortId });
    revalidatePath(`/teach/courses/${courseId}/students`);
    revalidatePath("/teach/students");
    return { ok: true, count };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo completar la matrícula. Intenta de nuevo.") };
  }
}

export type UnenrollStudentResult = { ok: true } | { error: string };

export async function unenrollStudentAction(
  courseId: string,
  studentId: string
): Promise<UnenrollStudentResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  try {
    unenrollStudent(courseId, studentId, user.id);
    revalidatePath(`/teach/courses/${courseId}/students`);
    revalidatePath("/teach/students");
    return { ok: true };
  } catch {
    return { error: "No se pudo quitar al estudiante. Intenta de nuevo." };
  }
}

export type EnrollInCoursesResult = { ok: true; count: number; courses: number } | { error: string };

/**
 * Matrícula masiva desde el perfil del estudiante: lo inscribe en varios
 * cursos del maestro de una sola vez (cursos ajenos se ignoran). Como cada
 * curso tiene sus propios grupos, el grupo va por NOMBRE: en cada curso se usa
 * el grupo con ese nombre o se crea.
 */
export async function enrollStudentInCoursesAction(
  studentId: string,
  courseIds: string[],
  cohortName?: string | null
): Promise<EnrollInCoursesResult> {
  const user = await requireTeacher();
  if (courseIds.length === 0) return { error: "Selecciona al menos un curso" };
  try {
    const name = cohortName?.trim() || null;
    const owned = [...new Set(courseIds)].filter((courseId) => {
      const course = getOwnedCourse(courseId, user);
      return course && course.status !== "archived";
    });
    if (owned.length === 0) return { error: "Ninguno de los cursos seleccionados es tuyo" };
    // Todo o nada: si el nombre choca con un grupo cerrado en un curso, no se
    // inscribe en ninguno (sin transacción quedaban inscritos los anteriores)
    const count = db.transaction(() => {
      let n = 0;
      for (const courseId of owned) {
        const cohortId = name ? findOrCreateCohort(courseId, name, user.id) : null;
        n += enrollStudents(courseId, [studentId], user.id, { cohortId });
      }
      return n;
    });
    const coursesTouched = owned.length;
    audit(user.id, "enroll_students", "enrollments", studentId, { courses: owned, count, cohortName: name });
    for (const courseId of owned) revalidatePath(`/teach/courses/${courseId}/students`);
    revalidatePath(`/teach/students/${studentId}`);
    revalidatePath("/teach/students");
    revalidatePath("/teach/dashboard");
    return { ok: true, count, courses: coursesTouched };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo completar la matrícula. Intenta de nuevo.") };
  }
}

export type RestoreEnrollmentsResult = { ok: true; count: number } | { error: string };

/** Saca de la papelera: el alumno recupera su estatus (aprobado vuelve aprobado). */
/**
 * Elimina para siempre bajas de la papelera (segunda confirmación: escribir
 * ELIMINAR). Las que tienen certificado se quedan en la papelera.
 */
export async function purgeEnrollmentsAction(
  courseId: string,
  enrollmentIds: string[],
  confirmWord: string
): Promise<{ ok: true; deleted: number; keptWithCertificate: number } | { error: string }> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  if (enrollmentIds.length === 0) return { error: "Selecciona al menos un estudiante" };
  if (!isDeleteConfirmed(confirmWord)) return { error: "Escribe ELIMINAR para confirmar" };
  try {
    const result = purgeDroppedEnrollments(courseId, enrollmentIds);
    audit(user.id, "purge_enrollments", "enrollments", courseId, result);
    revalidatePath(`/teach/courses/${courseId}/students`);
    revalidatePath("/teach/students");
    return { ok: true, ...result };
  } catch {
    return { error: "No se pudo eliminar. Intenta de nuevo." };
  }
}

export async function restoreEnrollmentsAction(
  courseId: string,
  enrollmentIds: string[]
): Promise<RestoreEnrollmentsResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  if (enrollmentIds.length === 0) return { error: "Selecciona al menos un estudiante" };
  // Solo matrículas de este curso
  const own = listDroppedEnrollments(courseId)
    .map((r) => r.enrollmentId)
    .filter((id) => enrollmentIds.includes(id));
  try {
    const count = restoreEnrollments(own);
    audit(user.id, "restore_enrollments", "enrollments", courseId, { count });
    revalidatePath(`/teach/courses/${courseId}/students`);
    revalidatePath("/teach/students");
    return { ok: true, count };
  } catch {
    return { error: "No se pudo restaurar. Intenta de nuevo." };
  }
}
