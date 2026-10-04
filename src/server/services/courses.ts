import "server-only";
import { matchesSearch } from "@/server/db/search";
import { and, eq, inArray, sql, desc, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import {
  cohorts,
  courses,
  courseItems,
  enrollments,
  itemDocuments,
  users,
  certificates,
  sessions,
  questions,
  assignmentSubmissions,
  submissionFiles,
} from "@/server/db/schema";
import { hashPassword } from "@/server/auth/passwords";
import { ownerCondition, scopeOwnerId, type ViewScope } from "@/server/auth/view-scope";
import {
  ownStudentSql,
  sharedElsewhereSql,
  studentInPoolCondition,
  studentVisibleCondition,
} from "./student-scope";
import { enqueueJob } from "@/server/jobs/queue";
import { latestCycleOnly } from "./enrollment-scope";
import {
  cohortCondition,
  cohortStudentIds,
  findCohortByName,
  findOrCreateCohort,
  getCohort,
  type CohortFilter,
} from "./cohorts";
import { queueEnrollmentMail } from "@/server/mail/outbox";
import { audit } from "./audit";
import { fileIdsForCourse } from "./storage-layout";
import { getItems } from "./tree";

export type Course = typeof courses.$inferSelect;

// ─── Cursos ──────────────────────────────────────────────────────────────────

export function createCourse(opts: {
  ownerId: string;
  title: string;
  description?: string;
}): Course {
  const id = nanoid();
  db.insert(courses)
    .values({
      id,
      title: opts.title,
      description: opts.description ?? "",
      ownerId: opts.ownerId,
    })
    .run();
  return db.select().from(courses).where(eq(courses.id, id)).get()!;
}

export function getCourse(courseId: string): Course | null {
  return db.select().from(courses).where(eq(courses.id, courseId)).get() ?? null;
}

/** El maestro solo toca sus cursos; el admin toca todos. */
export function getOwnedCourse(
  courseId: string,
  user: { id: string; role: string }
): Course | null {
  const course = getCourse(courseId);
  if (!course) return null;
  if (user.role !== "admin" && course.ownerId !== user.id) return null;
  return course;
}

export function updateCourse(
  courseId: string,
  patch: Partial<
    Pick<
      Course,
      | "title"
      | "description"
      | "enforceSequence"
      | "coverFileId"
      | "validityMode"
      | "validityMonths"
      | "certificateTemplateId"
    >
  >
) {
  const before = db.select({ title: courses.title }).from(courses).where(eq(courses.id, courseId)).get();
  db.update(courses)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(courses.id, courseId))
    .run();
  // El título del curso es la carpeta raíz; la portada estrena ubicación
  if (patch.title !== undefined && patch.title !== before?.title) {
    enqueueJob("relocate_files", { courseId });
  } else if (patch.coverFileId) {
    enqueueJob("relocate_files", { fileId: patch.coverFileId });
  }
}

/**
 * Lo que impide publicar, en frases que se enseñan tal cual (la pantalla del
 * curso y el asistente las muestran igual):
 *
 * - Un curso sin una sola lección: los estudiantes lo verían vacío.
 * - Un documento que sigue procesándose o falló: abrirían una lección en blanco.
 */
export function publishBlockers(courseId: string): string[] {
  const blockers: string[] = [];
  // Lo que el alumno abre son las lecciones; las carpetas no cuentan
  if (!getItems(courseId).some((item) => item.kind !== "folder")) {
    blockers.push("El curso no tiene ninguna lección: agrega contenido antes de publicarlo.");
  }
  const pending = db
    .select({ title: courseItems.title })
    .from(itemDocuments)
    .innerJoin(courseItems, eq(itemDocuments.itemId, courseItems.id))
    .where(and(eq(courseItems.courseId, courseId), sql`${itemDocuments.processingStatus} != 'ready'`))
    .all();
  for (const p of pending) blockers.push(`«${p.title}»: el documento sigue procesándose o falló.`);
  return blockers;
}

/** Publicar exige que no quede ningún bloqueo (ver `publishBlockers`). */
export function publishCourse(courseId: string): { ok: true } | { ok: false; blockers: string[] } {
  const blockers = publishBlockers(courseId);
  if (blockers.length > 0) {
    return { ok: false, blockers };
  }
  db.update(courses)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(courses.id, courseId))
    .run();
  return { ok: true };
}

export function setCourseStatus(courseId: string, status: Course["status"]) {
  db.update(courses).set({ status, updatedAt: new Date() }).where(eq(courses.id, courseId)).run();
}

/** Cursos del contexto (maestro: los suyos), con el nombre del dueño. */
export function listTeacherCourses(scope: ViewScope, search?: string) {
  const term = search?.trim();
  const conditions: SQL[] = [];
  const owner = ownerCondition(scope, courses.ownerId);
  if (owner) conditions.push(owner);
  const courseMatch = matchesSearch(term, [courses.title, courses.description]);
  if (courseMatch) conditions.push(courseMatch);

  return db
    .select({
      course: courses,
      ownerName: users.fullName,
      // OJO: en subconsultas correlacionadas la columna externa DEBE ir
      // calificada a mano — drizzle interpola ${courses.id} como "id" y
      // SQLite lo resuelve contra la tabla interna (bug de contadores en 0)
      enrolled: sql<number>`(SELECT COUNT(*) FROM enrollments e WHERE e.course_id = "courses"."id" AND e.status != 'dropped')`,
      itemCount: sql<number>`(SELECT COUNT(*) FROM course_items ci WHERE ci.course_id = "courses"."id" AND ci.kind != 'folder')`,
    })
    .from(courses)
    .innerJoin(users, eq(courses.ownerId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(courses.updatedAt))
    .all();
}

export type CourseDeleteImpact = {
  /** Motivos por los que no se puede borrar; vacío = se puede */
  blockers: string[];
  enrollments: number;
  items: number;
  cohorts: number;
};

function countOf(table: SQLiteTable, where: SQL): number {
  return db.select({ n: sql<number>`COUNT(*)` }).from(table).where(where).get()?.n ?? 0;
}

/** Qué se perdería al borrar el curso (primera confirmación). */
export function courseDeleteImpact(courseId: string): CourseDeleteImpact {
  const course = getCourse(courseId);
  if (!course) throw new Error("El curso no existe");
  const blockers: string[] = [];
  // Publicado = los estudiantes lo están viendo: primero se archiva (la «papelera»)
  if (course.status === "published") {
    blockers.push("Está publicado: archívalo primero para que los estudiantes dejen de verlo.");
  }
  // Los certificados son registros históricos (su folio y QR deben seguir
  // verificándose): un curso con certificados emitidos no se elimina, se archiva.
  const certs = countOf(certificates, eq(certificates.courseId, courseId));
  if (certs > 0) {
    blockers.push(
      `Tiene ${certs} certificado(s) emitido(s): son registros históricos y no se borran. Déjalo archivado.`
    );
  }
  return {
    blockers,
    enrollments: countOf(enrollments, eq(enrollments.courseId, courseId)),
    items: countOf(courseItems, and(eq(courseItems.courseId, courseId), sql`${courseItems.kind} != 'folder'`)!),
    cohorts: countOf(cohorts, eq(cohorts.courseId, courseId)),
  };
}

/**
 * Borrado definitivo: contenido, matrículas con su avance, entregas y grupos
 * se van en cascada; los archivos los retira después el worker. Solo lo
 * impiden los certificados (las pruebas y el seed lo usan para limpiar cursos
 * publicados); la regla «archívalo primero» la aplica la acción de la pantalla
 * con courseDeleteImpact.
 */
export function deleteCourse(courseId: string) {
  // Los certificados son registros históricos: un curso con certificados
  // emitidos no se elimina, se archiva.
  const certCount = countOf(certificates, eq(certificates.courseId, courseId));
  if (certCount > 0) {
    throw new Error(
      "Este curso tiene certificados emitidos y no puede eliminarse. Archívalo en su lugar."
    );
  }
  // Los archivos se recogen ANTES de borrar el curso; luego el worker retira
  // del disco los que queden sin dueño. fileIdsForCourse no incluye las
  // imágenes de preguntas ni las miniaturas: se suman aquí.
  const fileIds = new Set(fileIdsForCourse(courseId));
  const itemIds = db
    .select({ id: courseItems.id })
    .from(courseItems)
    .where(eq(courseItems.courseId, courseId))
    .all()
    .map((i) => i.id);
  if (itemIds.length > 0) {
    for (const q of db
      .select({ fileId: questions.imageFileId })
      .from(questions)
      .where(inArray(questions.examItemId, itemIds))
      .all()) {
      if (q.fileId) fileIds.add(q.fileId);
    }
    for (const d of db
      .select({ fileId: itemDocuments.thumbnailFileId })
      .from(itemDocuments)
      .where(inArray(itemDocuments.itemId, itemIds))
      .all()) {
      if (d.fileId) fileIds.add(d.fileId);
    }
  }
  db.delete(courses).where(eq(courses.id, courseId)).run();
  if (fileIds.size > 0) enqueueJob("cleanup_files", { fileIds: [...fileIds] });
}

// ─── Estudiantes ─────────────────────────────────────────────────────────────

/**
 * El correo ya es de un alumno del pool: no se duplica, se matricula al que
 * existe (lo registrara quien lo registrara).
 */
export class ExistingStudentError extends Error {
  constructor(
    readonly studentId: string,
    readonly fullName: string
  ) {
    super(`${fullName} ya está en la base de alumnos.`);
    this.name = "ExistingStudentError";
  }
}

export async function createStudent(opts: {
  fullName: string;
  email: string;
  password: string;
  createdBy: string;
}) {
  const email = opts.email.trim().toLowerCase();
  const existing = db
    .select({ id: users.id, role: users.role, fullName: users.fullName })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (existing) {
    if (existing.role === "student") throw new ExistingStudentError(existing.id, existing.fullName);
    throw new Error("Ese correo ya pertenece a otra cuenta de la plataforma.");
  }

  const id = nanoid();
  db.insert(users)
    .values({
      id,
      email,
      passwordHash: await hashPassword(opts.password),
      fullName: opts.fullName.trim(),
      role: "student",
      createdBy: opts.createdBy,
    })
    .run();
  return id;
}

/**
 * Alumnos del contexto, cada uno una sola vez. Por defecto, los del maestro
 * (alta propia o matrícula en sus cursos; «General»: todos). Con `pool`, el
 * directorio completo: cualquier alumno, lo haya registrado quien sea.
 * «Cursos» cuenta solo los del contexto; `mine` = es del maestro del contexto;
 * `sharedElsewhere` = también toma cursos con otro maestro.
 */
export function listStudents(
  scope: ViewScope,
  opts: { search?: string; page?: number; pageSize?: number; pool?: boolean } = {}
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 50);
  const term = opts.search?.trim();
  const ownerId = scopeOwnerId(scope);

  const visible = opts.pool ? studentInPoolCondition : studentVisibleCondition(scope);
  const where = term
    ? and(visible, matchesSearch(term, [users.fullName, users.email])!)
    : visible;

  const courseCount =
    ownerId === null
      ? sql<number>`(SELECT COUNT(*) FROM enrollments e WHERE e.student_id = "users"."id" AND e.status != 'dropped')`
      : sql<number>`(SELECT COUNT(*) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = "users"."id" AND e.status != 'dropped' AND c.owner_id = ${ownerId})`;
  const sharedElsewhere =
    ownerId === null
      ? sql<number>`0`
      : sql<number>`CASE WHEN ${sharedElsewhereSql(ownerId)} THEN 1 ELSE 0 END`;
  const mine =
    ownerId === null
      ? sql<number>`1`
      : sql<number>`CASE WHEN ${ownStudentSql(ownerId)} THEN 1 ELSE 0 END`;

  const rows = db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      active: users.active,
      lastLoginAt: users.lastLoginAt,
      courseCount,
      mine,
      sharedElsewhere,
    })
    .from(users)
    .where(where)
    .orderBy(users.fullName)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const total =
    db.select({ n: sql<number>`COUNT(*)` }).from(users).where(where).get()?.n ?? 0;

  return { rows, total, page, pageSize };
}

export async function resetStudentPassword(studentId: string, newPassword: string) {
  db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .run();
  // La contraseña anterior deja de funcionar DE VERDAD: sesiones cerradas
  db.delete(sessions).where(eq(sessions.userId, studentId)).run();
}

export function setStudentActive(studentId: string, active: boolean) {
  db.update(users)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .run();
  if (!active) {
    db.delete(sessions).where(eq(sessions.userId, studentId)).run();
  }
}

// ─── Matrícula ───────────────────────────────────────────────────────────────

/**
 * Inscribe alumnos en el curso. Si alguno estaba dado de baja, se RESTAURA su
 * ciclo tal cual estaba (progreso, calificaciones, certificado y estatus: un
 * aprobado vuelve como aprobado). Nunca abre un ciclo nuevo: eso solo lo hace
 * la recertificación desde el panel de vencimientos.
 */
export function enrollStudents(
  courseId: string,
  studentIds: string[],
  enrolledBy: string,
  opts: { cohortId?: string | null } = {}
) {
  const cohortId = opts.cohortId ?? null;
  // Los grupos son de cada curso: nunca se mezcla uno ajeno
  if (cohortId && getCohort(cohortId)?.courseId !== courseId) {
    throw new Error("El grupo elegido no pertenece a este curso");
  }
  // Solo cuentas de alumno: los ids vienen del cliente
  const valid = new Set(
    studentIds.length
      ? db
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, studentIds), eq(users.role, "student")))
          .all()
          .map((r) => r.id)
      : []
  );
  let count = 0;
  db.transaction(() => {
    for (const studentId of studentIds.filter((id) => valid.has(id))) {
      const current = getCurrentEnrollment(courseId, studentId);
      if (!current) {
        const enrollmentId = nanoid();
        db.insert(enrollments)
          .values({ id: enrollmentId, courseId, studentId, enrolledBy, cohortId, cycle: 1 })
          .run();
        queueEnrollmentMail(studentId, enrollmentId);
        count++;
      } else if (current.status === "dropped") {
        restoreEnrollmentRow(current.id, { cohortId });
        count++;
      } else if (cohortId && current.cohortId !== cohortId) {
        // Ya inscrito: solo se mueve de grupo si se eligió uno
        db.update(enrollments)
          .set({ cohortId, updatedAt: new Date() })
          .where(eq(enrollments.id, current.id))
          .run();
      }
      // active/completed sin cambio de grupo: ya matriculado
    }
  });
  return count;
}

export type ImportCohortResult = {
  /** Grupo del curso destino (null si no hubo a quién inscribir y aún no existía) */
  cohortId: string | null;
  cohortName: string;
  /** Inscritos ahora (nuevos o restaurados de la papelera) */
  enrolled: number;
  /** Ya estaban inscritos en el curso destino: se dejan como estaban */
  alreadyEnrolled: number;
};

/**
 * Inscribe en `targetCourseId` a los alumnos de un grupo de OTRO curso, dentro
 * de un grupo con el mismo nombre (se crea si no existe). El grupo de origen no
 * cambia, y quien ya estaba inscrito en el destino conserva su matrícula y su
 * grupo. Las bajas del destino se restauran (misma regla que la papelera).
 */
export function importCohortIntoCourse(
  sourceCohortId: string,
  targetCourseId: string,
  actorId: string
): ImportCohortResult {
  const source = getCohort(sourceCohortId);
  if (!source?.courseId) throw new Error("El grupo de origen no existe");
  if (source.courseId === targetCourseId) throw new Error("Ese grupo ya es de este curso");

  const members = cohortStudentIds(sourceCohortId);
  const pending = members.filter((studentId) => {
    const current = getCurrentEnrollment(targetCourseId, studentId);
    return !current || current.status === "dropped";
  });
  const alreadyEnrolled = members.length - pending.length;
  // Nadie nuevo: no se crea un grupo vacío en el destino
  if (pending.length === 0) {
    const existing = findCohortByName(targetCourseId, source.name);
    return { cohortId: existing?.id ?? null, cohortName: source.name, enrolled: 0, alreadyEnrolled };
  }
  // Todo o nada: crear el grupo e inscribir van juntos
  return db.transaction(() => {
    const cohortId = findOrCreateCohort(targetCourseId, source.name, actorId);
    const enrolled = enrollStudents(targetCourseId, pending, actorId, { cohortId });
    audit(actorId, "import_cohort", "cohorts", cohortId, {
      fromCohortId: sourceCohortId,
      fromCourseId: source.courseId,
      enrolled,
    });
    return { cohortId, cohortName: source.name, enrolled, alreadyEnrolled };
  });
}

/** Ciclo más reciente del alumno en el curso (espejo local de progress.getEnrollment). */
function getCurrentEnrollment(courseId: string, studentId: string) {
  return (
    db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
      .orderBy(desc(enrollments.cycle))
      .limit(1)
      .get() ?? null
  );
}

/** Saca una matrícula de la papelera devolviéndole el estatus que tenía. */
function restoreEnrollmentRow(enrollmentId: string, opts: { cohortId?: string | null } = {}) {
  const row = db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get();
  if (!row || row.status !== "dropped") return false;
  db.update(enrollments)
    .set({
      status: row.droppedFrom ?? "active",
      droppedAt: null,
      droppedBy: null,
      droppedFrom: null,
      ...(opts.cohortId ? { cohortId: opts.cohortId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(enrollments.id, enrollmentId))
    .run();
  return true;
}

/**
 * Da de baja al alumno del ciclo actual. Es reversible: se guarda el estatus
 * que tenía para restaurarlo tal cual, y no se toca su progreso, sus
 * calificaciones ni su certificado. Aparece en la papelera del curso.
 */
export function unenrollStudent(courseId: string, studentId: string, droppedBy?: string) {
  const current = getCurrentEnrollment(courseId, studentId);
  if (!current || current.status === "dropped") return false;
  db.update(enrollments)
    .set({
      status: "dropped",
      droppedFrom: current.status === "completed" ? "completed" : "active",
      droppedAt: new Date(),
      droppedBy: droppedBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(enrollments.id, current.id))
    .run();
  return true;
}

/** Restaura desde la papelera. Devuelve cuántas matrículas se restauraron. */
export function restoreEnrollments(enrollmentIds: string[]): number {
  let n = 0;
  db.transaction(() => {
    for (const id of enrollmentIds) if (restoreEnrollmentRow(id)) n++;
  });
  return n;
}

/**
 * Vacía la papelera: borra para siempre esas matrículas dadas de baja con su
 * avance, intentos y entregas (la cuenta del alumno no se toca). Si el alumno
 * tenía ciclos anteriores, esos se conservan. Las que tienen certificado
 * (aunque esté revocado) se quedan: es un registro histórico.
 */
export function purgeDroppedEnrollments(
  courseId: string,
  enrollmentIds: string[]
): { deleted: number; keptWithCertificate: number } {
  let deleted = 0;
  let keptWithCertificate = 0;
  const fileIds = new Set<string>();
  db.transaction((tx) => {
    for (const id of enrollmentIds) {
      const row = tx.select().from(enrollments).where(eq(enrollments.id, id)).get();
      if (!row || row.courseId !== courseId || row.status !== "dropped") continue;
      const hasCert = tx
        .select({ id: certificates.id })
        .from(certificates)
        .where(eq(certificates.enrollmentId, id))
        .get();
      if (hasCert) {
        keptWithCertificate++;
        continue;
      }
      // Archivos de sus entregas: se recogen antes de que la cascada borre las filas
      for (const s of tx
        .select({ id: assignmentSubmissions.id, fileId: assignmentSubmissions.fileId })
        .from(assignmentSubmissions)
        .where(eq(assignmentSubmissions.enrollmentId, id))
        .all()) {
        if (s.fileId) fileIds.add(s.fileId);
        for (const f of tx
          .select({ fileId: submissionFiles.fileId })
          .from(submissionFiles)
          .where(eq(submissionFiles.submissionId, s.id))
          .all()) {
          fileIds.add(f.fileId);
        }
      }
      tx.delete(enrollments).where(eq(enrollments.id, id)).run();
      deleted++;
    }
  });
  if (fileIds.size > 0) enqueueJob("cleanup_files", { fileIds: [...fileIds] });
  return { deleted, keptWithCertificate };
}

/**
 * Papelera de un curso: bajas del ciclo más reciente de cada alumno, con quién
 * y cuándo, y qué conservan (progreso, certificado) para decidir si restaurar.
 */
export function listDroppedEnrollments(courseId: string) {
  const rows = db
    .select({
      enrollmentId: enrollments.id,
      studentId: users.id,
      fullName: users.fullName,
      email: users.email,
      cycle: enrollments.cycle,
      droppedAt: enrollments.droppedAt,
      droppedFrom: enrollments.droppedFrom,
      droppedById: enrollments.droppedBy,
      cohortId: enrollments.cohortId,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.status, "dropped")))
    .orderBy(desc(enrollments.droppedAt))
    .all();

  // Solo cuenta si es el ciclo vigente: un ciclo viejo dado de baja no es «baja»
  const latest = rows.filter((r) => {
    const cur = getCurrentEnrollment(courseId, r.studentId);
    return cur?.id === r.enrollmentId;
  });

  return latest.map((r) => {
    const droppedBy = r.droppedById
      ? (db.select({ n: users.fullName }).from(users).where(eq(users.id, r.droppedById)).get()?.n ?? null)
      : null;
    const cert = db
      .select({ folio: certificates.folio })
      .from(certificates)
      .where(and(eq(certificates.enrollmentId, r.enrollmentId), eq(certificates.revoked, false)))
      .get();
    return { ...r, droppedByName: droppedBy, certificateFolio: cert?.folio ?? null };
  });
}

export function listCourseStudents(courseId: string, opts: { cohort?: CohortFilter } = {}) {
  const cohortCond = cohortCondition(opts.cohort ?? { kind: "default" });
  return db
    .select({
      enrollmentId: enrollments.id,
      studentId: users.id,
      fullName: users.fullName,
      email: users.email,
      status: enrollments.status,
      enrolledAt: enrollments.createdAt,
      completedAt: enrollments.completedAt,
      cycle: enrollments.cycle,
      cohortId: enrollments.cohortId,
      cohortName: cohorts.name,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .leftJoin(cohorts, eq(enrollments.cohortId, cohorts.id))
    .where(
      and(
        eq(enrollments.courseId, courseId),
        sql`${enrollments.status} != 'dropped'`,
        latestCycleOnly,
        ...(cohortCond ? [cohortCond] : [])
      )
    )
    .orderBy(users.fullName)
    .all();
}

/** Cursos publicados en los que está matriculado un estudiante. */
export function listStudentCourses(studentId: string) {
  return db
    .select({
      course: courses,
      enrollment: enrollments,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(enrollments.studentId, studentId),
        sql`${enrollments.status} != 'dropped'`,
        eq(courses.status, "published"),
        latestCycleOnly
      )
    )
    .orderBy(desc(enrollments.createdAt))
    .all();
}

/** Cursos publicados para el carrusel del login (sin datos sensibles). */
export function listPublishedCoursesPublic(limit = 8) {
  return db
    .select({
      id: courses.id,
      title: courses.title,
      coverFileId: courses.coverFileId,
      itemCount: sql<number>`(SELECT COUNT(*) FROM course_items ci WHERE ci.course_id = "courses"."id" AND ci.kind != 'folder')`,
    })
    .from(courses)
    .where(eq(courses.status, "published"))
    .orderBy(desc(courses.updatedAt))
    .limit(limit)
    .all();
}
