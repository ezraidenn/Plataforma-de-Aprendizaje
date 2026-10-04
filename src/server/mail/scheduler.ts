import "server-only";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/server/db";
import {
  assignmentSubmissions,
  certificates,
  emailLog,
  courseItems,
  courses,
  enrollments,
  exams,
  itemAssignments,
  users,
} from "@/server/db/schema";
import { latestCycleOnly } from "@/server/services/enrollment-scope";
import { computeFinalScorePercent, listAttempts } from "@/server/services/exam-scoring";
import { gradingQueue } from "@/server/services/grading";
import { listRenewals } from "@/server/services/renewals";
import { TZ, queueMail } from "./outbox";

/**
 * Revisiones periódicas que generan correos: vencimiento de certificados (una
 * vez, 30 días antes), pendientes del alumno (máximo uno al día) y resumen del
 * maestro (solo los días con algo). Todo en horario de oficina de Mérida.
 */

const DAY = 86_400_000;
const EXPIRY_WINDOW = 30 * DAY;
const DEADLINE_WINDOW = 48 * 60 * 60_000;

/** Fecha y hora locales de Mérida. */
export function localNow(now = Date.now()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function localDate(d: Date | number) {
  return localNow(typeof d === "number" ? d : d.getTime()).date;
}

/** «Cierra hoy, 18:00» / «Cierra mañana, 9:00» / «Cierra el 6 de octubre, 18:00». */
export function whenLabel(verb: string, at: Date, now = Date.now()): string {
  const time = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(at);
  const day = localDate(at);
  if (day === localDate(now)) return `${verb} hoy, ${time}`;
  if (day === localDate(now + DAY)) return `${verb} mañana, ${time}`;
  const date = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: TZ }).format(at);
  return `${verb} el ${date}, ${time}`;
}

// ─── Vencimientos ────────────────────────────────────────────────────────────

/** Certificados que vencen en 30 días o menos: un aviso por certificado. */
export function runExpiryMails(now = Date.now()): number {
  const rows = db
    .select({ id: certificates.id, studentId: certificates.studentId })
    .from(certificates)
    .innerJoin(enrollments, eq(certificates.enrollmentId, enrollments.id))
    .where(
      and(
        eq(certificates.revoked, false),
        eq(certificates.renewalState, "pending"),
        gte(certificates.expiresAt, new Date(now)),
        lte(certificates.expiresAt, new Date(now + EXPIRY_WINDOW)),
        latestCycleOnly
      )
    )
    .all();
  let queued = 0;
  for (const r of rows) {
    if (queueMail({ kind: "vencimiento", userId: r.studentId, ref: r.id, once: true, payload: { certificateId: r.id } })) queued++;
  }
  return queued;
}

// ─── Pendientes del alumno ───────────────────────────────────────────────────

type PendingItem = {
  kind: "exam" | "assignment" | "returned";
  title: string;
  course: string;
  when: string;
  detail?: string;
  path: string;
  sort: number;
};

/** Lo que cierra en 48 h y la persona no ha resuelto, más las tareas devueltas ayer. */
export function collectPending(now = Date.now()): Map<string, PendingItem[]> {
  const byStudent = new Map<string, PendingItem[]>();
  const push = (studentId: string, it: PendingItem) => {
    byStudent.set(studentId, [...(byStudent.get(studentId) ?? []), it]);
  };
  const activeIn = (courseId: string) =>
    db
      .select({ enrollmentId: enrollments.id, studentId: enrollments.studentId })
      .from(enrollments)
      .innerJoin(users, eq(enrollments.studentId, users.id))
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.status, "active"), eq(users.active, true), latestCycleOnly))
      .all();

  // Exámenes que cierran pronto y aún no se aprueban
  const closing = db
    .select({ exam: exams, title: courseItems.title, courseId: courses.id, course: courses.title })
    .from(exams)
    .innerJoin(courseItems, eq(exams.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(
      and(
        gte(exams.closesAt, new Date(now)),
        lte(exams.closesAt, new Date(now + DEADLINE_WINDOW)),
        eq(courses.status, "published"),
        eq(courseItems.visible, true)
      )
    )
    .all();
  for (const c of closing) {
    for (const s of activeIn(c.courseId)) {
      const pct = computeFinalScorePercent(c.exam, listAttempts(c.exam.itemId, s.studentId, s.enrollmentId));
      if (pct !== null && (c.exam.passScore === null || pct >= c.exam.passScore)) continue;
      push(s.studentId, {
        kind: "exam",
        title: c.title,
        course: c.course,
        when: whenLabel("Cierra", c.exam.closesAt!, now),
        path: `/courses/${c.courseId}/items/${c.exam.itemId}`,
        sort: c.exam.closesAt!.getTime(),
      });
    }
  }

  // Tareas que vencen pronto sin entregar
  const due = db
    .select({ itemId: itemAssignments.itemId, dueAt: itemAssignments.dueAt, title: courseItems.title, courseId: courses.id, course: courses.title })
    .from(itemAssignments)
    .innerJoin(courseItems, eq(itemAssignments.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(
      and(
        gte(itemAssignments.dueAt, new Date(now)),
        lte(itemAssignments.dueAt, new Date(now + DEADLINE_WINDOW)),
        eq(courses.status, "published"),
        eq(courseItems.visible, true)
      )
    )
    .all();
  for (const a of due) {
    const enrolled = activeIn(a.courseId);
    if (enrolled.length === 0) continue;
    const submitted = new Set(
      db
        .select({ enrollmentId: assignmentSubmissions.enrollmentId })
        .from(assignmentSubmissions)
        .where(and(eq(assignmentSubmissions.itemId, a.itemId), inArray(assignmentSubmissions.enrollmentId, enrolled.map((e) => e.enrollmentId))))
        .all()
        .map((r) => r.enrollmentId)
    );
    for (const s of enrolled) {
      if (submitted.has(s.enrollmentId)) continue;
      push(s.studentId, {
        kind: "assignment",
        title: a.title,
        course: a.course,
        when: whenLabel("Vence", a.dueAt!, now),
        path: `/courses/${a.courseId}/items/${a.itemId}`,
        sort: a.dueAt!.getTime(),
      });
    }
  }

  // Tareas devueltas para corregir en las últimas 24 h
  const returned = db
    .select({
      studentId: assignmentSubmissions.studentId,
      itemId: assignmentSubmissions.itemId,
      feedback: assignmentSubmissions.feedbackMd,
      title: courseItems.title,
      courseId: courses.id,
      course: courses.title,
    })
    .from(assignmentSubmissions)
    .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(enrollments, eq(assignmentSubmissions.enrollmentId, enrollments.id))
    .where(
      and(
        eq(assignmentSubmissions.status, "returned"),
        gte(assignmentSubmissions.gradedAt, new Date(now - DAY)),
        eq(enrollments.status, "active"),
        eq(courses.status, "published")
      )
    )
    .all();
  for (const r of returned) {
    const fb = (r.feedback ?? "").replace(/[#*_>`\[\]]/g, "").replace(/\s+/g, " ").trim();
    push(r.studentId, {
      kind: "returned",
      title: r.title,
      course: r.course,
      when: "Devuelta",
      detail: fb ? (fb.length > 90 ? `${fb.slice(0, 87)}…` : fb) : undefined,
      path: `/courses/${r.courseId}/items/${r.itemId}`,
      sort: 0,
    });
  }

  for (const items of byStudent.values()) items.sort((a, b) => a.sort - b.sort);
  return byStudent;
}

export function runPendingMails(now = Date.now(), skip = new Set<string>()): number {
  const today = localNow(now).date;
  let queued = 0;
  for (const [studentId, items] of collectPending(now)) {
    if (skip.has(studentId)) continue;
    const payload = { items: items.slice(0, 8).map((it) => ({ kind: it.kind, title: it.title, course: it.course, when: it.when, detail: it.detail, path: it.path })) };
    if (queueMail({ kind: "pendientes", userId: studentId, ref: today, once: true, payload })) queued++;
  }
  return queued;
}

// ─── Resumen del maestro ─────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function listByCourse(counts: Map<string, number>): string {
  return [...counts].map(([title, n]) => `${title} (${n})`).join(", ");
}

/** Datos del resumen de un maestro; null si hoy no hay nada que contarle. */
export function teacherDigest(ownerId: string, now = Date.now()) {
  const scope = { kind: "own" as const, ownerId };

  const queue = gradingQueue(scope);
  const perCourse = new Map<string, { exams: number; assignments: number }>();
  for (const q of queue) {
    const c = perCourse.get(q.courseTitle) ?? { exams: 0, assignments: 0 };
    if (q.kind === "exam") c.exams++;
    else c.assignments++;
    perCourse.set(q.courseTitle, c);
  }
  const toGrade = [...perCourse].map(([course, c]) => ({
    course,
    detail: [c.exams ? plural(c.exams, "examen", "exámenes") : "", c.assignments ? plural(c.assignments, "tarea", "tareas") : ""]
      .filter(Boolean)
      .join(" · "),
  }));

  // Terminaron ayer (día de Mérida)
  const yesterday = localNow(now - DAY).date;
  const done = db
    .select({ courseId: courses.id, title: courses.title, completedAt: enrollments.completedAt })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(and(eq(courses.ownerId, ownerId), eq(enrollments.status, "completed"), gte(enrollments.completedAt, new Date(now - 3 * DAY))))
    .all()
    .filter((r) => r.completedAt && localDate(r.completedAt) === yesterday);
  const doneBy = new Map<string, number>();
  for (const r of done) doneBy.set(r.title, (doneBy.get(r.title) ?? 0) + 1);
  const doneCourses = new Set(done.map((r) => r.courseId));
  const finished = done.length
    ? {
        total: done.length,
        text: `${plural(done.length, "alumno terminó", "alumnos terminaron")}: ${listByCourse(doneBy)}.`,
        path: doneCourses.size === 1 ? `/teach/courses/${[...doneCourses][0]}/students` : "/teach/dashboard",
      }
    : null;

  // Certificados por vencer en 30 días (solo dispara el correo si entró uno nuevo hoy)
  const expiringRows = listRenewals(scope, { tab: "expiring" });
  const expBy = new Map<string, number>();
  for (const r of expiringRows) expBy.set(r.courseTitle, (expBy.get(r.courseTitle) ?? 0) + 1);
  const expiring = expiringRows.length
    ? { total: expiringRows.length, text: `${plural(expiringRows.length, "certificado vence", "certificados vencen")}: ${listByCourse(expBy)}.` }
    : null;
  const newlyExpiring = expiringRows.some((r) => r.expiresAt.getTime() > now + EXPIRY_WINDOW - DAY);

  if (queue.length === 0 && !finished && !newlyExpiring) return null;
  return { toGrade, toGradeTotal: queue.length, finished, expiring };
}

export function runTeacherDigests(now = Date.now(), skip = new Set<string>()): number {
  const today = localNow(now).date;
  const owners = db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(courses, eq(courses.ownerId, users.id))
    .where(and(inArray(users.role, ["teacher", "admin"]), eq(users.active, true), ne(courses.status, "archived")))
    .all();
  let queued = 0;
  for (const o of owners) {
    if (skip.has(o.id)) continue;
    const digest = teacherDigest(o.id, now);
    if (digest && queueMail({ kind: "resumen", userId: o.id, ref: today, once: true, payload: digest })) queued++;
  }
  return queued;
}

// ─── Reloj ───────────────────────────────────────────────────────────────────

/** ¿Ya salió (o está por salir) el correo de hoy de este tipo? Evita recalcular. */
function doneToday(kind: "pendientes" | "resumen", today: string): Set<string> {
  return new Set(
    db
      .select({ userId: emailLog.userId })
      .from(emailLog)
      .where(and(eq(emailLog.kind, kind), eq(emailLog.ref, today)))
      .all()
      .map((r) => r.userId ?? "")
  );
}

/**
 * Se llama cada 10 minutos. El resumen sale a partir de las 7:00 y los
 * pendientes a partir de las 8:00; si el servidor estuvo apagado toda la
 * mañana, ese día no se mandan (llegarían a deshoras). Los vencimientos, en
 * cualquier momento del horario de oficina.
 */
export function runMailSchedule(now = Date.now()) {
  const { hour, date } = localNow(now);
  if (hour < 7 || hour >= 20) return;
  if (hour < 10) runTeacherDigests(now, doneToday("resumen", date));
  if (hour >= 8 && hour < 12) runPendingMails(now, doneToday("pendientes", date));
  if (hour >= 8) runExpiryMails(now);
}
