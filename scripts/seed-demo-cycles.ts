/**
 * Datos demo de vigencia, ciclos y grupos (Fase 8). Idempotente.
 *
 *  - «Uso y Manejo de Extintores»: vigencia por año calendario (la NOM pide
 *    capacitación anual) y sus alumnos repartidos en dos generaciones.
 *  - Papelera: Carlos Sánchez (aprobado, con certificado) queda dado de baja en
 *    extintores para mostrar que la baja no borra nada y se puede restaurar.
 *    Al re-ejecutar, si ya se le restauró, se le vuelve a dar de baja.
 *  - «Primeros Auxilios Básicos»: vigencia de 12 meses y una «Generación 2025»
 *    (grupo cerrado) con certificados vencidos, por vencer y vigentes, para que
 *    el panel de Vencimientos tenga casos reales. Todo pasa por el flujo normal
 *    (inscripción, lectura, examen, emisión); al final solo se recorren las
 *    fechas a 2025 y se recalcula el sello de verificación.
 *
 * Contraseña de los alumnos nuevos: demo1234.
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/seed-demo-cycles.ts
 */
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  certificates,
  cohorts,
  courseItems,
  courses,
  enrollments,
  examAttempts,
  itemProgress,
  notifications,
  users,
} from "@/server/db/schema";
import { createStudent, enrollStudents, setStudentActive, unenrollStudent } from "@/server/services/courses";
import { ensureItemProgress, getEnrollment } from "@/server/services/progress";
import * as examsSvc from "@/server/services/exams";
import { evaluateEnrollment } from "@/server/services/rules-engine";
import { issueCertificate, verificationHash } from "@/server/services/certificates";
import { createCohort, setCohortStatus } from "@/server/services/cohorts";
import { computeExpiry } from "@/lib/validity";

const DAY = 86_400_000;
const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get();
if (!teacher) throw new Error("Falta el maestro demo (corre primero el seed)");
const extintores = db.select().from(courses).where(like(courses.title, "Uso y Manejo%")).get();
const auxilios = db.select().from(courses).where(eq(courses.title, "Primeros Auxilios Básicos")).get();
if (!extintores || !auxilios) throw new Error("Faltan los cursos demo (corre primero seed-demo)");

/** Generación 2025 de Primeros Auxilios: fecha en que aprobó cada quien. */
const GEN_2025: { email: string; fullName: string; issued: string; left?: boolean }[] = [
  { email: "roberto.diaz@empresa.local", fullName: "Roberto Díaz Luna", issued: "2025-08-04T11:20:00" },
  { email: "patricia.gomez@empresa.local", fullName: "Patricia Gómez Ruiz", issued: "2025-08-18T09:45:00" },
  // Ya no labora en la empresa: cuenta desactivada, pero su historial sigue ahí
  { email: "ernesto.salazar@empresa.local", fullName: "Ernesto Salazar Vega", issued: "2025-08-27T16:10:00", left: true },
  { email: "monica.aguilar@empresa.local", fullName: "Mónica Aguilar Soto", issued: "2025-09-17T10:05:00" },
  { email: "arturo.mendoza@empresa.local", fullName: "Arturo Mendoza Cruz", issued: "2025-09-30T12:30:00" },
  { email: "lucia.herrera@empresa.local", fullName: "Lucía Herrera Ríos", issued: "2025-11-12T13:00:00" },
];

/** Id del grupo del curso por nombre, aunque esté cerrado (al re-ejecutar, «Generación 2025» ya lo está). */
function cohortByName(courseId: string, name: string): string {
  const row = db
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(and(eq(cohorts.courseId, courseId), eq(cohorts.name, name)))
    .get();
  return row?.id ?? createCohort(courseId, name, teacher!.id).id;
}

async function ensureStudent(email: string, fullName: string): Promise<string> {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return existing.id;
  return createStudent({ fullName, email, password: "demo1234", createdBy: teacher!.id });
}

/** Aprueba el curso de primeros auxilios por el camino normal. */
async function passAuxilios(studentId: string) {
  const enrollment = getEnrollment(auxilios!.id, studentId)!;
  const items = db
    .select()
    .from(courseItems)
    .where(eq(courseItems.courseId, auxilios!.id))
    .all()
    .sort((a, b) => a.position - b.position);
  const now = new Date();
  for (const item of items) {
    if (item.kind === "exam") {
      const attempt = examsSvc.startAttempt({ courseId: auxilios!.id, studentId, examItemId: item.id });
      const all = examsSvc.listQuestions(item.id);
      for (const qid of attempt.questionOrder as string[]) {
        const q = all.find((x) => x.id === qid)!;
        examsSvc.saveAnswer({
          studentId,
          attemptId: attempt.id,
          questionId: qid,
          selectedOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
        });
      }
      examsSvc.submitAttempt({ courseId: auxilios!.id, studentId, attemptId: attempt.id });
    } else {
      const ip = ensureItemProgress(enrollment.id, item.id);
      db.update(itemProgress)
        .set({ status: "completed", percent: 100, completedAt: now, lastActivityAt: now, updatedAt: now })
        .where(eq(itemProgress.id, ip.id))
        .run();
    }
  }
  evaluateEnrollment(enrollment.id);
  return issueCertificate(enrollment.id);
}

/** Lleva a `issued` todo lo que el flujo fechó hoy y vuelve a sellar el folio. */
function backdate(studentId: string, enrollmentId: string, certId: string, issued: Date) {
  const cert = db.select().from(certificates).where(eq(certificates.id, certId)).get()!;
  const folio = cert.folio.replace(/^CERT-\d{4}-/, `CERT-${issued.getFullYear()}-`);
  const enrolledAt = new Date(issued.getTime() - 9 * DAY);
  const readAt = new Date(issued.getTime() - 8 * DAY);
  const examAt = new Date(issued.getTime() - 40 * 60_000);

  db.update(certificates)
    .set({
      folio,
      issuedAt: issued,
      createdAt: issued,
      expiresAt: computeExpiry("months", 12, issued),
      verificationHash: verificationHash(folio, studentId, cert.courseId, issued.getTime()),
    })
    .where(eq(certificates.id, certId))
    .run();
  db.update(enrollments)
    .set({ createdAt: enrolledAt, completedAt: issued, updatedAt: issued })
    .where(eq(enrollments.id, enrollmentId))
    .run();
  db.update(itemProgress)
    .set({ createdAt: enrolledAt, completedAt: readAt, lastActivityAt: readAt, updatedAt: readAt })
    .where(eq(itemProgress.enrollmentId, enrollmentId))
    .run();
  db.update(examAttempts)
    .set({
      startedAt: examAt,
      submittedAt: new Date(examAt.getTime() + 6 * 60_000),
      createdAt: examAt,
      updatedAt: issued,
      gradedAt: sql`CASE WHEN ${examAttempts.gradedAt} IS NULL THEN NULL ELSE ${issued.getTime()} END`,
    })
    .where(eq(examAttempts.enrollmentId, enrollmentId))
    .run();
  db.update(notifications).set({ createdAt: issued }).where(eq(notifications.userId, studentId)).run();
  db.update(users)
    .set({ createdAt: new Date(enrolledAt.getTime() - DAY) })
    .where(eq(users.id, studentId))
    .run();
}

(async () => {
  // ── Políticas de vigencia
  db.update(courses)
    .set({ validityMode: "calendar_year", validityMonths: null })
    .where(eq(courses.id, extintores.id))
    .run();
  db.update(courses)
    .set({ validityMode: "months", validityMonths: 12 })
    .where(eq(courses.id, auxilios.id))
    .run();
  console.log("✓ Vigencia: Extintores → año calendario · Primeros Auxilios → 12 meses");

  // Demo: los certificados de extintores se emitieron como si la política anual
  // hubiera existido desde el inicio (en uso real, cambiarla no los toca).
  for (const c of db
    .select()
    .from(certificates)
    .where(and(eq(certificates.courseId, extintores.id), isNull(certificates.expiresAt)))
    .all()) {
    db.update(certificates)
      .set({ expiresAt: computeExpiry("calendar_year", null, c.issuedAt) })
      .where(eq(certificates.id, c.id))
      .run();
  }

  // ── Generaciones de extintores: quien ya avanzó (aprobado o con examen) es de
  // agosto; el resto, de septiembre. Solo matrículas que aún no tienen grupo.
  const agosto = cohortByName(extintores.id, "Generación Agosto 2026");
  const septiembre = cohortByName(extintores.id, "Generación Septiembre 2026");
  const sinGrupo = db
    .select({ id: enrollments.id, studentId: enrollments.studentId, status: enrollments.status })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, extintores.id), isNull(enrollments.cohortId)))
    .all();
  const withAttempts = new Set(
    db
      .select({ enrollmentId: examAttempts.enrollmentId })
      .from(examAttempts)
      .where(inArray(examAttempts.enrollmentId, sinGrupo.length ? sinGrupo.map((e) => e.id) : [""]))
      .all()
      .map((r) => r.enrollmentId)
  );
  const toAgosto = sinGrupo.filter((e) => e.status === "completed" || withAttempts.has(e.id)).map((e) => e.id);
  const toSeptiembre = sinGrupo.filter((e) => !toAgosto.includes(e.id)).map((e) => e.id);
  if (toAgosto.length) db.update(enrollments).set({ cohortId: agosto }).where(inArray(enrollments.id, toAgosto)).run();
  if (toSeptiembre.length) {
    db.update(enrollments).set({ cohortId: septiembre }).where(inArray(enrollments.id, toSeptiembre)).run();
  }
  console.log(`✓ Grupos de extintores: ${toAgosto.length} en agosto · ${toSeptiembre.length} en septiembre`);

  // ── Papelera: una baja de ejemplo (aprobado con certificado)
  const carlos = db.select().from(users).where(eq(users.email, "carlos.sanchez@empresa.local")).get();
  const carlosEnrollment = carlos ? getEnrollment(extintores.id, carlos.id) : null;
  if (carlos && carlosEnrollment && carlosEnrollment.status !== "dropped") {
    unenrollStudent(extintores.id, carlos.id, teacher.id);
    console.log("✓ Papelera: Carlos Sánchez dado de baja en extintores (restaurable)");
  }

  // ── Generación 2025 de primeros auxilios
  const gen2025 = cohortByName(auxilios.id, "Generación 2025");
  for (const s of GEN_2025) {
    const studentId = await ensureStudent(s.email, s.fullName);
    const already = db
      .select()
      .from(certificates)
      .where(and(eq(certificates.studentId, studentId), eq(certificates.courseId, auxilios.id)))
      .get();
    if (already) {
      console.log(`— ${s.fullName}: ya tenía su certificado`);
      continue;
    }
    enrollStudents(auxilios.id, [studentId], teacher.id, { cohortId: gen2025 });
    const cert = await passAuxilios(studentId);
    if (!cert) throw new Error(`No se emitió el certificado de ${s.fullName}`);
    backdate(studentId, cert.enrollmentId, cert.id, new Date(s.issued));
    if (s.left) setStudentActive(studentId, false);
    const final = db.select().from(certificates).where(eq(certificates.id, cert.id)).get()!;
    console.log(`✓ ${s.fullName}: ${final.folio} · vence ${final.expiresAt?.toISOString().slice(0, 10)}`);
  }
  // La generación 2025 ya terminó: se cierra (sale de las vistas diarias, nada se borra)
  setCohortStatus(gen2025, "closed", teacher.id);
  console.log("✓ «Generación 2025» cerrada");
})();
