import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  users,
  enrollments,
  courses,
  certificates,
  itemProgress,
} from "@/server/db/schema";
import { courseProgress } from "./progress";
import { latestCycleOnly } from "./enrollment-scope";
import { scopeOwnerId, type ViewScope } from "@/server/auth/view-scope";
import { isStudentInPool } from "./student-scope";

/**
 * Perfil/expediente del estudiante para maestros y admin: datos de la cuenta,
 * cursos con su avance y TODOS sus certificados (los vigentes descargables
 * uno a uno o en ZIP — caso de uso: recrear el portafolio físico).
 */

export type StudentProfile = {
  student: {
    id: string;
    fullName: string;
    email: string;
    active: boolean;
    lastLoginAt: number | null;
    createdAt: number;
  };
  courses: {
    courseId: string;
    courseTitle: string;
    courseStatus: string;
    enrollmentStatus: "active" | "completed" | "dropped";
    percent: number;
    enrolledAt: number;
    completedAt: number | null;
  }[];
  certificates: {
    id: string;
    folio: string;
    courseTitle: string;
    issuedAt: number;
    /** Vencimiento congelado al emitir (null = vitalicio) */
    expiresAt: number | null;
    /** Ciclo de la matrícula que lo obtuvo (1, 2 al recertificarse…) */
    cycle: number;
    pdfFileId: string | null;
    revoked: boolean;
  }[];
  totals: {
    courses: number;
    completed: number;
    certificates: number;
    totalSeconds: number;
  };
  /** Cursos vigentes del alumno fuera del contexto (0 en «General») */
  outsideCount: number;
};

/**
 * Cualquier maestro abre la ficha de cualquier alumno del pool (para
 * matricularlo), pero `scope` filtra lo que se muestra: cursos, certificados y
 * tiempo solo de los cursos del contexto. De los demás, solo `outsideCount`.
 */
export function getStudentProfile(studentId: string, scope: ViewScope): StudentProfile | null {
  if (!isStudentInPool(studentId)) return null;
  const ownerId = scopeOwnerId(scope);
  const inScope = ownerId === null ? undefined : eq(courses.ownerId, ownerId);

  const student = db
    .select()
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .get();
  if (!student) return null;

  const enrollmentRows = db
    .select({
      enrollmentId: enrollments.id,
      status: enrollments.status,
      enrolledAt: enrollments.createdAt,
      completedAt: enrollments.completedAt,
      courseId: courses.id,
      courseTitle: courses.title,
      courseStatus: courses.status,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(and(eq(enrollments.studentId, studentId), latestCycleOnly, inScope))
    .orderBy(desc(enrollments.createdAt))
    .all();

  const courseRows = enrollmentRows.map((e) => ({
    courseId: e.courseId,
    courseTitle: e.courseTitle,
    courseStatus: e.courseStatus,
    enrollmentStatus: e.status,
    percent:
      e.status === "dropped" ? 0 : courseProgress(e.courseId, studentId).percent,
    enrolledAt: e.enrolledAt.getTime(),
    completedAt: e.completedAt?.getTime() ?? null,
  }));

  // Todos los certificados (los revocados se muestran marcados, sin descarga)
  const certRows = db
    .select({
      id: certificates.id,
      folio: certificates.folio,
      issuedAt: certificates.issuedAt,
      expiresAt: certificates.expiresAt,
      cycle: enrollments.cycle,
      pdfFileId: certificates.pdfFileId,
      revoked: certificates.revoked,
      courseTitle: courses.title,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .leftJoin(enrollments, eq(certificates.enrollmentId, enrollments.id))
    .where(and(eq(certificates.studentId, studentId), inScope))
    .orderBy(desc(certificates.issuedAt))
    .all();

  const totalSeconds =
    db
      .select({ n: sql<number>`COALESCE(SUM(${itemProgress.totalSeconds}), 0)` })
      .from(itemProgress)
      .innerJoin(enrollments, eq(itemProgress.enrollmentId, enrollments.id))
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(and(eq(enrollments.studentId, studentId), inScope))
      .get()?.n ?? 0;

  // Cursos vigentes con otros dueños: solo el número, como aviso en la ficha
  const outsideCount =
    ownerId === null
      ? 0
      : (db
          .select({ n: sql<number>`COUNT(DISTINCT ${enrollments.courseId})` })
          .from(enrollments)
          .innerJoin(courses, eq(enrollments.courseId, courses.id))
          .where(
            and(
              eq(enrollments.studentId, studentId),
              sql`${enrollments.status} != 'dropped'`,
              ne(courses.ownerId, ownerId)
            )
          )
          .get()?.n ?? 0);

  const activeCourses = courseRows.filter((c) => c.enrollmentStatus !== "dropped");

  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      email: student.email,
      active: student.active,
      lastLoginAt: student.lastLoginAt?.getTime() ?? null,
      createdAt: student.createdAt.getTime(),
    },
    courses: courseRows,
    certificates: certRows.map((c) => ({
      id: c.id,
      folio: c.folio,
      courseTitle: c.courseTitle,
      issuedAt: c.issuedAt.getTime(),
      expiresAt: c.expiresAt?.getTime() ?? null,
      cycle: c.cycle ?? 1,
      pdfFileId: c.pdfFileId,
      revoked: c.revoked,
    })),
    totals: {
      courses: activeCourses.length,
      completed: activeCourses.filter((c) => c.enrollmentStatus === "completed").length,
      certificates: certRows.filter((c) => !c.revoked).length,
      totalSeconds,
    },
    outsideCount,
  };
}
