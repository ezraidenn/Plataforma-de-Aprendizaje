import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { ownerCondition, type ViewScope } from "@/server/auth/view-scope";
import { cohorts, courses, enrollments } from "@/server/db/schema";
import { matchesSearch } from "@/server/db/search";
import { audit } from "./audit";

/**
 * Grupos (oleadas de alumnos) PROPIOS de cada curso: los filtros de un curso
 * solo muestran sus grupos. La misma oleada en otro curso es otro grupo con el
 * mismo nombre, que se crea al importarla (ver importCohortIntoCourse en
 * courses.ts). Cerrar un grupo lo saca de las vistas diarias; nunca borra nada.
 */

export type Cohort = typeof cohorts.$inferSelect;
type Actor = { id: string; role: string };

/**
 * Filtro de grupo en la URL (`?grupo=`):
 *  - ausente  → todo menos los grupos CERRADOS (las matrículas sin grupo se ven)
 *  - "all"    → todo, incluidos cerrados
 *  - "none"   → solo matrículas sin grupo
 *  - <id>     → solo ese grupo
 */
export type CohortFilter = { kind: "default" } | { kind: "all" } | { kind: "none" } | { kind: "one"; id: string };

export function parseCohortFilter(raw: string | undefined | null): CohortFilter {
  const v = (raw ?? "").trim();
  if (!v) return { kind: "default" };
  if (v === "all") return { kind: "all" };
  if (v === "none") return { kind: "none" };
  return { kind: "one", id: v };
}

/** Condición sobre `enrollments` para el filtro dado (null = sin restricción). */
export function cohortCondition(filter: CohortFilter): SQL | null {
  switch (filter.kind) {
    case "all":
      return null;
    case "none":
      return isNull(enrollments.cohortId);
    case "one":
      return eq(enrollments.cohortId, filter.id);
    case "default": {
      const closed = db
        .select({ id: cohorts.id })
        .from(cohorts)
        .where(eq(cohorts.status, "closed"))
        .all()
        .map((c) => c.id);
      if (closed.length === 0) return null;
      return or(isNull(enrollments.cohortId), sql`${enrollments.cohortId} NOT IN ${closed}`) ?? null;
    }
  }
}

export function getCohort(id: string): Cohort | null {
  return db.select().from(cohorts).where(eq(cohorts.id, id)).get() ?? null;
}

/** ¿Puede el usuario administrar este grupo? (dueño del curso o admin) */
export function canManageCohort(user: Actor, cohortId: string): Cohort | null {
  const row = db
    .select({ cohort: cohorts, ownerId: courses.ownerId })
    .from(cohorts)
    .innerJoin(courses, eq(cohorts.courseId, courses.id))
    .where(eq(cohorts.id, cohortId))
    .get();
  if (!row) return null;
  return user.role === "admin" || row.ownerId === user.id ? row.cohort : null;
}

export type CohortRow = {
  id: string;
  name: string;
  status: "open" | "closed";
  courseId: string;
  courseTitle: string;
  closedAt: Date | null;
  createdAt: Date;
  enrollmentCount: number;
  completedCount: number;
};

/** Grupos del alcance, con conteos. */
export function listCohorts(
  scope: ViewScope,
  opts: { status?: "open" | "closed" | "all"; search?: string; courseId?: string } = {}
): CohortRow[] {
  const conditions: SQL[] = [];
  if (opts.status && opts.status !== "all") conditions.push(eq(cohorts.status, opts.status));
  if (opts.courseId) conditions.push(eq(cohorts.courseId, opts.courseId));
  const owner = ownerCondition(scope, courses.ownerId);
  if (owner) conditions.push(owner);
  const match = matchesSearch(opts.search, [cohorts.name, courses.title]);
  if (match) conditions.push(match);

  // Conteos con subconsultas correlacionadas (columna externa calificada a mano)
  return db
    .select({
      id: cohorts.id,
      name: cohorts.name,
      status: cohorts.status,
      courseId: courses.id,
      courseTitle: courses.title,
      closedAt: cohorts.closedAt,
      createdAt: cohorts.createdAt,
      enrollmentCount: sql<number>`(SELECT COUNT(*) FROM enrollments e WHERE e.cohort_id = "cohorts"."id" AND e.status != 'dropped')`,
      completedCount: sql<number>`(SELECT COUNT(*) FROM enrollments e WHERE e.cohort_id = "cohorts"."id" AND e.status = 'completed')`,
    })
    .from(cohorts)
    .innerJoin(courses, eq(cohorts.courseId, courses.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(cohorts.status), desc(cohorts.createdAt))
    .all();
}

export type CohortOption = { id: string; name: string; status: "open" | "closed" };

/** Grupos de UN curso para selectores y filtros: abiertos primero («open» > «closed»). */
export function cohortOptions(courseId: string, opts: { includeClosed?: boolean } = {}): CohortOption[] {
  return db
    .select({ id: cohorts.id, name: cohorts.name, status: cohorts.status })
    .from(cohorts)
    .where(
      and(eq(cohorts.courseId, courseId), opts.includeClosed ? undefined : eq(cohorts.status, "open"))
    )
    .orderBy(desc(cohorts.status), desc(cohorts.createdAt))
    .all();
}

export type CohortOptionWithCourse = CohortOption & { courseId: string; courseTitle: string };

/** Grupos de los cursos del alcance (panel de vencimientos), con su curso. */
export function cohortOptionsForUser(
  scope: ViewScope,
  opts: { includeClosed?: boolean } = {}
): CohortOptionWithCourse[] {
  return db
    .select({
      id: cohorts.id,
      name: cohorts.name,
      status: cohorts.status,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(cohorts)
    .innerJoin(courses, eq(cohorts.courseId, courses.id))
    .where(
      and(
        ownerCondition(scope, courses.ownerId),
        opts.includeClosed ? undefined : eq(cohorts.status, "open")
      )
    )
    .orderBy(asc(courses.title), desc(cohorts.status), desc(cohorts.createdAt))
    .all();
}

export type ImportableCohort = {
  id: string;
  name: string;
  status: "open" | "closed";
  courseId: string;
  courseTitle: string;
  memberCount: number;
};

/** Grupos de OTROS cursos del usuario que se pueden importar a `targetCourseId`. */
export function importableCohorts(user: Actor, targetCourseId: string): ImportableCohort[] {
  return db
    .select({
      id: cohorts.id,
      name: cohorts.name,
      status: cohorts.status,
      courseId: courses.id,
      courseTitle: courses.title,
      memberCount: sql<number>`(SELECT COUNT(DISTINCT e.student_id) FROM enrollments e WHERE e.cohort_id = "cohorts"."id" AND e.status != 'dropped')`,
    })
    .from(cohorts)
    .innerJoin(courses, eq(cohorts.courseId, courses.id))
    .where(
      and(
        ne(cohorts.courseId, targetCourseId),
        user.role === "admin" ? undefined : eq(courses.ownerId, user.id)
      )
    )
    .orderBy(asc(courses.title), desc(cohorts.status), desc(cohorts.createdAt))
    .all()
    .filter((c) => c.memberCount > 0);
}

function cleanName(raw: string): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new Error("El nombre del grupo debe tener entre 2 y 80 caracteres");
  return name;
}

/** Grupo del curso con ese nombre (sin distinguir mayúsculas), sin crearlo. */
export function findCohortByName(courseId: string, name: string) {
  return findByName(courseId, cleanName(name));
}

function findByName(courseId: string, name: string, exceptId?: string) {
  return (
    db
      .select({ id: cohorts.id, name: cohorts.name, status: cohorts.status })
      .from(cohorts)
      .where(
        and(
          eq(cohorts.courseId, courseId),
          sql`lower(${cohorts.name}) = lower(${name})`,
          exceptId ? ne(cohorts.id, exceptId) : undefined
        )
      )
      .get() ?? null
  );
}

export function createCohort(courseId: string, name: string, actorId: string): Cohort {
  const clean = cleanName(name);
  if (findByName(courseId, clean)) throw new Error("Ya existe un grupo con ese nombre en este curso");
  const id = nanoid();
  db.insert(cohorts).values({ id, courseId, name: clean, createdBy: actorId }).run();
  audit(actorId, "create_cohort", "cohorts", id, { courseId, name: clean });
  return getCohort(id)!;
}

/**
 * Id del grupo del curso con ese nombre, creándolo si no existe. Si el que
 * existe está CERRADO se rechaza: meter matrículas nuevas ahí las escondería
 * de las vistas diarias sin que el maestro lo note.
 */
export function findOrCreateCohort(courseId: string, name: string, actorId: string): string {
  const clean = cleanName(name);
  const existing = findByName(courseId, clean);
  if (existing?.status === "closed") {
    throw new Error(`El grupo «${existing.name}» ya existe en este curso y está cerrado. Reábrelo en Grupos o usa otro nombre.`);
  }
  return existing?.id ?? createCohort(courseId, clean, actorId).id;
}

export function renameCohort(id: string, name: string, actorId: string) {
  const cohort = getCohort(id);
  if (!cohort?.courseId) throw new Error("El grupo no existe");
  const clean = cleanName(name);
  if (findByName(cohort.courseId, clean, id)) throw new Error("Ya existe un grupo con ese nombre en este curso");
  db.update(cohorts).set({ name: clean, updatedAt: new Date() }).where(eq(cohorts.id, id)).run();
  audit(actorId, "rename_cohort", "cohorts", id, { name: clean });
}

export function setCohortStatus(id: string, status: "open" | "closed", actorId: string) {
  db.update(cohorts)
    .set({ status, closedAt: status === "closed" ? new Date() : null, updatedAt: new Date() })
    .where(eq(cohorts.id, id))
    .run();
  audit(actorId, status === "closed" ? "close_cohort" : "reopen_cohort", "cohorts", id);
}

/**
 * Mueve matrículas a un grupo (o las deja sin grupo con `null`). Solo se
 * mueven las matrículas del MISMO curso que el grupo.
 */
export function assignEnrollmentsToCohort(enrollmentIds: string[], cohortId: string | null) {
  if (enrollmentIds.length === 0) return 0;
  const sameCourse = cohortId ? getCohort(cohortId)?.courseId : null;
  if (cohortId && !sameCourse) throw new Error("El grupo no existe");
  return db
    .update(enrollments)
    .set({ cohortId, updatedAt: new Date() })
    .where(
      and(inArray(enrollments.id, enrollmentIds), sameCourse ? eq(enrollments.courseId, sameCourse) : undefined)
    )
    .run().changes;
}

/** Alumnos de un grupo: matrículas vigentes (sin bajas). */
export function cohortStudentIds(cohortId: string): string[] {
  return db
    .selectDistinct({ studentId: enrollments.studentId })
    .from(enrollments)
    .where(and(eq(enrollments.cohortId, cohortId), ne(enrollments.status, "dropped")))
    .all()
    .map((r) => r.studentId);
}
