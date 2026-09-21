import "server-only";
import { eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { courses, users } from "@/server/db/schema";
import {
  VIEW_ALL,
  VIEW_OWN,
  type ViewContextInfo,
  type ViewContextOption,
  type ViewContextOptions,
} from "@/lib/view-context";
import type { ViewScope } from "@/server/auth/view-scope";
import { visibleStudentCountsByOwner } from "./student-scope";

/**
 * Opciones del selector de contexto del admin, con cursos · alumnos de cada una.
 * Maestros: los activos y los inactivos que aún tienen cursos (sus cursos no
 * deben quedar fuera de la vista), activos primero, en orden alfabético.
 */
export function listViewContextOptions(adminId: string): ViewContextOptions {
  const courseCounts = new Map(
    db
      .select({ ownerId: courses.ownerId, n: sql<number>`COUNT(*)` })
      .from(courses)
      .groupBy(courses.ownerId)
      .all()
      .map((r) => [r.ownerId, r.n] as const)
  );
  const studentCounts = visibleStudentCountsByOwner();
  const studentsOf = (ownerId: string) => studentCounts.get(ownerId) ?? 0;
  const totalStudents =
    db.select({ n: sql<number>`COUNT(*)` }).from(users).where(eq(users.role, "student")).get()?.n ?? 0;

  const teachers: ViewContextOption[] = db
    .select({ id: users.id, fullName: users.fullName, active: users.active })
    .from(users)
    .where(eq(users.role, "teacher"))
    .all()
    .filter((t) => t.active || (courseCounts.get(t.id) ?? 0) > 0)
    .map((t) => ({
      value: t.id,
      name: t.fullName,
      courses: courseCounts.get(t.id) ?? 0,
      students: studentsOf(t.id),
      inactive: !t.active,
    }))
    .sort((x, y) => Number(x.inactive) - Number(y.inactive) || x.name.localeCompare(y.name, "es"));

  let totalCourses = 0;
  for (const n of courseCounts.values()) totalCourses += n;

  return {
    own: {
      value: VIEW_OWN,
      name: "Mi contenido",
      courses: courseCounts.get(adminId) ?? 0,
      students: studentsOf(adminId),
      inactive: false,
    },
    all: {
      value: VIEW_ALL,
      name: "General — todos",
      courses: totalCourses,
      students: totalStudents,
      inactive: false,
    },
    teachers,
  };
}

/** Nombre del maestro del contexto (null fuera de «Ver como»). */
export function ownerNameOf(scope: ViewScope): string | null {
  if (scope.kind !== "teacher") return null;
  return (
    db.select({ fullName: users.fullName }).from(users).where(eq(users.id, scope.ownerId)).get()
      ?.fullName ?? null
  );
}

/** Lo que el cliente necesita para el selector, la franja y los avisos. */
export function viewContextInfo(scope: ViewScope): ViewContextInfo {
  if (scope.kind === "own") return { kind: "own" };
  if (scope.kind === "all") return { kind: "all" };
  return { kind: "teacher", ownerId: scope.ownerId, ownerName: ownerNameOf(scope) ?? "—" };
}

/** id → nombre de maestros y admins (etiquetas de dueño en «General»). */
export function staffNameMap(): Map<string, string> {
  return new Map(
    db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(ne(users.role, "student"))
      .all()
      .map((u) => [u.id, u.fullName] as const)
  );
}
