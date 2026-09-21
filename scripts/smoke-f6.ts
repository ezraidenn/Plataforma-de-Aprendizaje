/**
 * Prueba end-to-end de la Fase 8: vigencia, ciclos de recertificación, panel de
 * vencimientos, grupos y papelera de bajas.
 *
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/smoke-f6.ts
 */
import { cleanupSmokeNotifications, removeDemoCourses } from "./lib/smoke-cleanup";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/server/db";
import { ownScope } from "../src/server/auth/view-scope";
import {
  users,
  itemTexts,
  courses as coursesTable,
  enrollments,
  certificates as certsTable,
  certificateTemplates,
  cohorts as cohortsTable,
} from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import * as examsSvc from "../src/server/services/exams";
import * as certs from "../src/server/services/certificates";
import * as renewals from "../src/server/services/renewals";
import * as cohorts from "../src/server/services/cohorts";
import { listAttempts } from "../src/server/services/exam-scoring";
import { computeExpiry, validityState } from "../src/lib/validity";
import { evaluateEnrollment } from "../src/server/services/rules-engine";

/** Igual que la ruta /api/progress/heartbeat: avanzar y re-evaluar las reglas. */
function readAndEvaluate(courseId: string, studentId: string, itemId: string) {
  progress.textHeartbeat({ courseId, studentId, itemId });
  const e = progress.getEnrollment(courseId, studentId);
  if (e) evaluateEnrollment(e.id);
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const TITLE = "Curso demo F6 — Recertificación";
const TITLE2 = "Curso demo F6 — Segundo curso";
const TEMPLATE_NAME = "Diploma F6";

/**
 * Cada corrida crea una plantilla «Diploma F6» y antes se quedaba para siempre
 * (una por corrida). Borra las del maestro demo con ese nombre que ningún
 * curso usa: al inicio, las de corridas viejas; al final, la de esta.
 */
function removeUnusedDemoTemplates(teacherId: string) {
  db.delete(certificateTemplates)
    .where(
      and(
        eq(certificateTemplates.name, TEMPLATE_NAME),
        eq(certificateTemplates.ownerId, teacherId),
        sql`NOT EXISTS (SELECT 1 FROM courses c WHERE c.certificate_template_id = ${certificateTemplates.id})`
      )
    )
    .run();
}

async function main() {
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
  const student = db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;

  // Limpieza de corridas anteriores: los grupos y matrículas se van con su curso
  // (cascada). En bases viejas enrollments.cohort_id era NO ACTION (drizzle-kit
  // omitía el ON DELETE); por eso no se borran grupos sueltos antes.
  for (const title of [TITLE, TITLE2]) {
    for (const c of db.select().from(coursesTable).where(eq(coursesTable.title, title)).all()) {
      db.delete(certsTable).where(eq(certsTable.courseId, c.id)).run();
      courses.deleteCourse(c.id);
    }
  }
  for (const g of db.select().from(cohortsTable).where(eq(cohortsTable.name, "Grupo F6 A")).all()) {
    db.delete(cohortsTable).where(eq(cohortsTable.id, g.id)).run();
  }
  for (const g of db.select().from(cohortsTable).where(eq(cohortsTable.name, "Grupo F6 B")).all()) {
    db.delete(cohortsTable).where(eq(cohortsTable.id, g.id)).run();
  }
  removeUnusedDemoTemplates(teacher.id);

  console.log("\n— Cálculo de vigencia (funciones puras)");
  const mar15 = new Date(2026, 2, 15, 10, 0, 0);
  const cal = computeExpiry("calendar_year", null, mar15)!;
  check("Año calendario → 31/dic del año de emisión", cal.getFullYear() === 2026 && cal.getMonth() === 11 && cal.getDate() === 31);
  const m12 = computeExpiry("months", 12, mar15)!;
  check("12 meses → 15/mar del año siguiente", m12.getFullYear() === 2027 && m12.getMonth() === 2 && m12.getDate() === 15);
  const jan31 = computeExpiry("months", 1, new Date(2026, 0, 31))!;
  check("31/ene + 1 mes → fin de febrero (no 3/mar)", jan31.getMonth() === 1 && jan31.getDate() === 28, jan31.toISOString());
  check("Vitalicio → sin vencimiento", computeExpiry("lifetime", null, mar15) === null);
  check("Estado: vencido", validityState(Date.now() - 1000) === "expired");
  check("Estado: por vencer (10 días)", validityState(Date.now() + 10 * 86_400_000) === "expiring");
  check("Estado: vigente (90 días)", validityState(Date.now() + 90 * 86_400_000) === "valid");

  console.log("\n— Curso con vigencia de 12 meses");
  const template = certs.createTemplate(teacher.id, TEMPLATE_NAME);
  const course = courses.createCourse({ ownerId: teacher.id, title: TITLE });
  db.update(coursesTable)
    .set({
      certificateTemplateId: template.id,
      validityMode: "months",
      validityMonths: 12,
      completionRules: { op: "AND", conditions: [{ type: "viewing_completion", min_percent: 100 }] },
    })
    .where(eq(coursesTable.id, course.id))
    .run();
  const lectura = tree.createItem({ courseId: course.id, parentId: null, kind: "text", title: "Lectura" });
  db.update(itemTexts).set({ minReadSeconds: 0 }).where(eq(itemTexts.itemId, lectura.id)).run();
  const examen = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen opcional" });
  tree.updateItem(course.id, examen.id, { requiredForCompletion: false });
  examsSvc.createQuestion(examen.id, {
    type: "single_choice",
    promptMd: "¿1+1?",
    points: 1,
    options: [{ textMd: "2", isCorrect: true }, { textMd: "3", isCorrect: false }],
  });
  courses.publishCourse(course.id);

  // Segundo curso: para probar que los grupos son de cada curso
  const course2 = courses.createCourse({ ownerId: teacher.id, title: TITLE2 });
  const lectura2 = tree.createItem({ courseId: course2.id, parentId: null, kind: "text", title: "Lectura" });
  db.update(itemTexts).set({ minReadSeconds: 0 }).where(eq(itemTexts.itemId, lectura2.id)).run();
  courses.publishCourse(course2.id);

  console.log("\n— Grupos (propios de cada curso)");
  const grupoA = cohorts.createCohort(course.id, "Grupo F6 A", teacher.id);
  const grupoB = cohorts.createCohort(course.id, "Grupo F6 B", teacher.id);
  check("El grupo queda ligado a su curso", grupoA.courseId === course.id);
  let dupErr = "";
  try {
    cohorts.createCohort(course.id, "grupo f6 a", teacher.id);
  } catch (e) {
    dupErr = (e as Error).message;
  }
  check("Nombre de grupo único en el curso (sin importar mayúsculas)", dupErr.includes("Ya existe"));
  const grupoOtro = cohorts.createCohort(course2.id, "Otro grupo", teacher.id);
  check(
    "Los filtros del curso solo ven sus grupos",
    cohorts.cohortOptions(course.id, { includeClosed: true }).every((g) => g.id !== grupoOtro.id) &&
      cohorts.cohortOptions(course.id).length === 2
  );
  let foreignErr = "";
  try {
    courses.enrollStudents(course.id, [student.id], teacher.id, { cohortId: grupoOtro.id });
  } catch (e) {
    foreignErr = (e as Error).message;
  }
  check("No se puede matricular con un grupo de otro curso", foreignErr.includes("no pertenece"));

  courses.enrollStudents(course.id, [student.id], teacher.id, { cohortId: grupoA.id });
  const e1 = progress.getEnrollment(course.id, student.id)!;
  check("Inscrito en ciclo 1 dentro del grupo A", e1.cycle === 1 && e1.cohortId === grupoA.id);

  console.log("\n— Ciclo 1: aprobar y emitir");
  // Secuencial: primero la lectura (desbloquea el examen opcional)
  readAndEvaluate(course.id, student.id, lectura.id);
  const attempt1 = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
  check("El intento queda atado a la matrícula", attempt1.enrollmentId === e1.id);
  const e1done = db.select().from(enrollments).where(eq(enrollments.id, e1.id)).get()!;
  check("Ciclo 1 aprobado", e1done.status === "completed");
  const cert1 = await certs.issueCertificate(e1.id);
  check("Certificado 1 emitido con vencimiento", !!cert1?.expiresAt);
  const months = cert1!.expiresAt ? (cert1!.expiresAt.getTime() - cert1!.issuedAt.getTime()) / (30.4 * 86_400_000) : 0;
  check("Vence ~12 meses después de emitirse", months > 11.5 && months < 12.5, months.toFixed(2));

  console.log("\n— Papelera: baja accidental de un aprobado");
  courses.unenrollStudent(course.id, student.id, teacher.id);
  const dropped = db.select().from(enrollments).where(eq(enrollments.id, e1.id)).get()!;
  check("Baja guarda el estatus previo (aprobado)", dropped.status === "dropped" && dropped.droppedFrom === "completed");
  check("La baja no toca el certificado", !!db.select().from(certsTable).where(eq(certsTable.id, cert1!.id)).get() && !db.select().from(certsTable).where(eq(certsTable.id, cert1!.id)).get()!.revoked);
  const trash = courses.listDroppedEnrollments(course.id);
  check("Aparece en la papelera con su folio", trash.length === 1 && trash[0].certificateFolio === cert1!.folio, trash);
  check("La papelera sabe quién lo dio de baja", trash[0]?.droppedByName === teacher.fullName);
  check("No aparece en la lista del curso", !courses.listCourseStudents(course.id).some((s) => s.studentId === student.id));
  const restored = courses.restoreEnrollments([e1.id]);
  const back = db.select().from(enrollments).where(eq(enrollments.id, e1.id)).get()!;
  check("Restaurar lo devuelve como APROBADO", restored === 1 && back.status === "completed" && back.droppedAt === null);
  check("Papelera vacía tras restaurar", courses.listDroppedEnrollments(course.id).length === 0);
  // Reinscribir a un dado de baja también restaura (no abre ciclo nuevo)
  courses.unenrollStudent(course.id, student.id, teacher.id);
  courses.enrollStudents(course.id, [student.id], teacher.id);
  const again = progress.getEnrollment(course.id, student.id)!;
  check("Reinscribir a un dado de baja restaura el MISMO ciclo", again.id === e1.id && again.cycle === 1 && again.status === "completed");

  console.log("\n— Traer un grupo de otro curso");
  const imported = courses.importCohortIntoCourse(grupoA.id, course2.id, teacher.id);
  const inCourse2 = progress.getEnrollment(course2.id, student.id);
  const copy = imported.cohortId ? cohorts.getCohort(imported.cohortId) : null;
  check("Inscribe a los miembros en el otro curso", imported.enrolled === 1 && !!inCourse2);
  check(
    "…dentro de un grupo con el MISMO nombre, propio de ese curso",
    copy?.name === "Grupo F6 A" && copy?.courseId === course2.id && inCourse2?.cohortId === copy?.id
  );
  check(
    "El grupo original no cambia",
    cohorts.getCohort(grupoA.id)?.courseId === course.id && cohorts.cohortStudentIds(grupoA.id).includes(student.id)
  );
  const importedAgain = courses.importCohortIntoCourse(grupoA.id, course2.id, teacher.id);
  check(
    "Importar de nuevo no duplica (los ya inscritos se quedan igual)",
    importedAgain.enrolled === 0 && importedAgain.alreadyEnrolled === 1 && importedAgain.cohortId === imported.cohortId
  );

  console.log("\n— Vencimiento y panel");
  const past = Date.now() - 2 * 86_400_000;
  db.update(certsTable).set({ expiresAt: new Date(past) }).where(eq(certsTable.id, cert1!.id)).run();
  const expired = renewals.listRenewals(ownScope(teacher), { tab: "expired" }).filter((r) => r.courseId === course.id);
  check("Aparece en «Vencidos»", expired.length === 1 && expired[0].folio === cert1!.folio, expired.length);
  check("Muestra su grupo", expired[0]?.cohortName === "Grupo F6 A");
  const counts = renewals.renewalCounts(ownScope(teacher));
  check("El contador cuenta el vencido", counts.expired >= 1, counts);
  const verifyExpired = certs.verifyCertificate(cert1!.folio);
  check("Verificación: auténtico pero vencido", verifyExpired.status === "valid" && verifyExpired.expired === true, verifyExpired.status);

  console.log("\n— Reinscribir desde el panel → ciclo 2");
  let renewForeignErr = "";
  try {
    renewals.renewCertificates(teacher, [cert1!.id], { mode: "existing", cohortId: grupoOtro.id });
  } catch (e) {
    renewForeignErr = (e as Error).message;
  }
  check("Reinscribir con un grupo de otro curso se rechaza", renewForeignErr.includes("otro curso"));
  const result = renewals.renewCertificates(teacher, [cert1!.id], { mode: "existing", cohortId: grupoB.id });
  check("Reinscripción aplicada", result.renewed === 1, result);
  const e2 = progress.getEnrollment(course.id, student.id)!;
  check("Ciclo 2 activo en el grupo B", e2.cycle === 2 && e2.status === "active" && e2.cohortId === grupoB.id, { cycle: e2.cycle, status: e2.status });
  const progress2 = progress.getProgressMap(e2.id);
  check("Ciclo 2 empieza con progreso en cero", progress2.size === 0 || [...progress2.values()].every((p) => p.status !== "completed"));
  check("Ciclo 2 empieza con intentos en cero", listAttempts(examen.id, student.id).length === 0);
  check("Los intentos del ciclo 1 se conservan", listAttempts(examen.id, student.id, e1.id).length === 1);
  const cert1After = db.select().from(certsTable).where(eq(certsTable.id, cert1!.id)).get()!;
  check("Certificado 1 marcado «renovado» y enlazado", cert1After.renewalState === "renewed" && cert1After.renewedEnrollmentId === e2.id);
  check("Ya no aparece en el panel", renewals.listRenewals(ownScope(teacher), { tab: "expired" }).every((r) => r.certificateId !== cert1!.id));
  const roster = courses.listCourseStudents(course.id).filter((s) => s.studentId === student.id);
  check("El alumno aparece UNA vez en la lista del curso", roster.length === 1);
  const again2 = renewals.renewCertificates(teacher, [cert1!.id]);
  check("Reinscribir dos veces no duplica ciclos", again2.renewed === 0);

  console.log("\n— Ciclo 2: aprobar y emitir certificado nuevo");
  readAndEvaluate(course.id, student.id, lectura.id);
  const cert2 = await certs.issueCertificate(e2.id);
  check("Certificado 2 emitido con folio distinto", !!cert2 && cert2.folio !== cert1!.folio);
  const allCerts = db.select().from(certsTable).where(and(eq(certsTable.courseId, course.id), eq(certsTable.studentId, student.id))).all();
  check("Ambos certificados existen (historial)", allCerts.length === 2);

  console.log("\n— Descartar del panel");
  db.update(certsTable).set({ expiresAt: new Date(past) }).where(eq(certsTable.id, cert2!.id)).run();
  const dismissed = renewals.dismissCertificates(teacher, [cert2!.id], "reemplazado", "NOM-002 2027");
  const cert2After = db.select().from(certsTable).where(eq(certsTable.id, cert2!.id)).get()!;
  check("Descartado con motivo", dismissed === 1 && cert2After.renewalState === "dismissed" && (cert2After.renewalNote ?? "").includes("NOM-002 2027"));
  check("Sale del panel", renewals.listRenewals(ownScope(teacher), { tab: "expired" }).every((r) => r.certificateId !== cert2!.id));

  console.log("\n— Filtros de grupo");
  cohorts.setCohortStatus(grupoB.id, "closed", teacher.id);
  const defFilter = cohorts.cohortCondition(cohorts.parseCohortFilter(undefined));
  const visibleDefault = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, course.id), defFilter ?? undefined))
    .all();
  check("Por defecto se ocultan los grupos cerrados", visibleDefault.every((r) => r.id !== e2.id));
  const allFilter = cohorts.cohortCondition(cohorts.parseCohortFilter("all"));
  const visibleAll = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, course.id), allFilter ?? undefined))
    .all();
  check("«Todos» los muestra", visibleAll.some((r) => r.id === e2.id));
  const listed = cohorts.listCohorts(ownScope(teacher), { status: "all", courseId: course.id });
  check(
    "Lista de grupos del curso con conteos",
    listed.length === 2 && listed.some((g) => g.name === "Grupo F6 B" && g.status === "closed" && g.courseTitle === TITLE),
    listed.map((g) => [g.name, g.status, g.enrollmentCount])
  );
  let closedNameErr = "";
  try {
    cohorts.findOrCreateCohort(course.id, "grupo f6 b", teacher.id);
  } catch (e) {
    closedNameErr = (e as Error).message;
  }
  check("Un nombre de grupo cerrado no se reutiliza en silencio", closedNameErr.includes("cerrado"));
  cohorts.setCohortStatus(grupoB.id, "open", teacher.id);

  // La plantilla de prueba no se queda (el curso demo se borra al final)
  if (!failures) {
    db.update(coursesTable)
      .set({ certificateTemplateId: null })
      .where(and(eq(coursesTable.id, course.id), eq(coursesTable.certificateTemplateId, template.id)))
      .run();
    removeUnusedDemoTemplates(teacher.id);
    check("La plantilla de prueba no se queda", !certs.getTemplate(template.id));
  }

  // No dejar la campana de las cuentas demo llena de avisos de prueba
  cleanupSmokeNotifications([course.id, course2.id]);
  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exit(1);
  }
  removeDemoCourses([TITLE, TITLE2], teacher.id);
  console.log("\n✅ TODO PASÓ (F6)");
}

main();
