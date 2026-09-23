/**
 * Corregir una calificación ya puesta, contra la base real: la nota se
 * recalcula de verdad, queda registrada en la auditoría, el alumno solo recibe
 * otro aviso si el número cambió y lo que ya se certificó no se toca.
 *
 * Uso: pnpm smoke:regrade
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cleanupSmokeGradingAudit, cleanupSmokeNotifications, removeDemoCourses } from "./lib/smoke-cleanup";
import { db } from "../src/server/db";
import { ownScope } from "../src/server/auth/view-scope";
import {
  assignmentSubmissions,
  auditLog,
  certificates as certsTable,
  certificateTemplates,
  courses as coursesTable,
  enrollments,
  examAttempts,
  jobs,
  notifications,
  users,
} from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import * as examsSvc from "../src/server/services/exams";
import * as assignments from "../src/server/services/assignments";
import * as grading from "../src/server/services/grading";
import * as certs from "../src/server/services/certificates";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const TITLE = "Curso demo — Corregir calificación";
const TEMPLATE_NAME = "Diploma demo — Corregir";

const teacher = () => db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
const student = () => db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;

/** Avisos que le llegaron al alumno por una lección concreta. */
function notices(itemId: string, type: "grade_published" | "submission_returned"): number {
  return db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, student().id),
        eq(notifications.type, type),
        sql`json_extract(${notifications.payload}, '$.itemId') = ${itemId}`
      )
    )
    .all().length;
}

function auditRows(action: string, entityId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId)))
    .all();
}

type Detalle = { scoreBefore?: number; scoreAfter?: number; score?: number; studentName?: string };
const detalle = (row: { detail: unknown } | undefined): Detalle => (row?.detail ?? {}) as Detalle;

/** Cursos y plantillas que dejó una corrida anterior interrumpida. */
function removeLeftovers(teacherId: string) {
  for (const c of db.select().from(coursesTable).where(like(coursesTable.title, `${TITLE}%`)).all()) {
    db.delete(certsTable).where(eq(certsTable.courseId, c.id)).run();
    courses.deleteCourse(c.id);
  }
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
  const t = teacher();
  const s = student();
  removeLeftovers(t.id);

  // Todo lo que esta corrida crea fuera de los cursos, para borrarlo al final
  const entityIds: string[] = [];
  const enrollmentIds: string[] = [];
  let otroMaestroId = "";

  console.log("\n— Curso con examen (abierta) y tarea; aprueba con 80 % del examen");
  const template = certs.createTemplate(t.id, TEMPLATE_NAME);
  const course = courses.createCourse({ ownerId: t.id, title: TITLE });

  const examen = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen de seguridad" });
  const qAuto = examsSvc.createQuestion(examen.id, {
    type: "single_choice",
    promptMd: "¿Cuál es la salida de emergencia?",
    points: 5,
    options: [
      { textMd: "La señalizada", isCorrect: true },
      { textMd: "El elevador", isCorrect: false },
    ],
  });
  const qOpen = examsSvc.createQuestion(examen.id, {
    type: "open_text",
    promptMd: "Explica el protocolo",
    points: 5,
  });
  const tarea = tree.createItem({ courseId: course.id, parentId: null, kind: "assignment", title: "Plan de evacuación" });
  assignments.updateAssignmentSettings(tarea.id, { maxScore: 100, allowResubmission: true });
  const pendiente = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen pendiente" });
  const qPend = examsSvc.createQuestion(pendiente.id, { type: "open_text", promptMd: "¿Qué harías?", points: 10 });

  db.update(coursesTable)
    .set({
      certificateTemplateId: template.id,
      // Sin secuencia obligatoria: la prueba entra a cada lección cuando le toca
      enforceSequence: false,
      completionRules: {
        op: "AND",
        conditions: [{ type: "exam_specific", item_id: examen.id, min_percent: 80 }],
      },
    })
    .where(eq(coursesTable.id, course.id))
    .run();
  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [s.id], t.id);
  const enrollment = progress.getEnrollment(course.id, s.id)!;
  enrollmentIds.push(enrollment.id);

  try {
    // El alumno responde bien la de opción (5 pts) y escribe la abierta
    const a1 = examsSvc.startAttempt({ courseId: course.id, studentId: s.id, examItemId: examen.id });
    examsSvc.saveAnswer({
      studentId: s.id,
      attemptId: a1.id,
      questionId: qAuto,
      selectedOptionIds: [examsSvc.listQuestions(examen.id).find((q) => q.id === qAuto)!.options.find((o) => o.isCorrect)!.id],
    });
    examsSvc.saveAnswer({ studentId: s.id, attemptId: a1.id, questionId: qOpen, answerText: "Salir por la ruta señalizada." });
    const enviado = examsSvc.submitAttempt({ courseId: course.id, studentId: s.id, attemptId: a1.id });
    entityIds.push(a1.id);
    check("Con abierta pendiente el intento queda en revisión", enviado.status === "submitted", enviado.status);

    console.log("\n— Calificar por primera vez (1 de 5 en la abierta)");
    const r1 = grading.gradeOpenAnswer({ gradedBy: t.id, attemptId: a1.id, questionId: qOpen, points: 1 });
    const fila1 = db.select().from(examAttempts).where(eq(examAttempts.id, a1.id)).get()!;
    check("Se publica la nota y no es corrección", r1.finalized && !r1.regraded, r1);
    check("Devuelve la nota: null → 6", r1.scoreBefore === null && r1.scoreAfter === 6, r1);
    check("La base guarda 6 y el intento queda calificado", fila1.finalScore === 6 && fila1.status === "graded", fila1.finalScore);
    check("Firma quién y cuándo calificó", fila1.gradedBy === t.id && fila1.gradedAt !== null);
    check("Auditoría grade_exam con la nota", auditRows("grade_exam", a1.id).length === 1 && detalle(auditRows("grade_exam", a1.id)[0]).score === 6);
    check("El alumno recibe 1 aviso", notices(examen.id, "grade_published") === 1);
    check("60 % < 80 %: no completa el curso", db.select().from(enrollments).where(eq(enrollments.id, enrollment.id)).get()!.status === "active");
    check("Sin aviso de certificado", r1.warning === undefined, r1.warning);

    console.log("\n— Corregir al alza (3 de 5): la nota cambia y ahora sí aprueba");
    const r2 = grading.gradeOpenAnswer({ gradedBy: t.id, attemptId: a1.id, questionId: qOpen, points: 3 });
    const fila2 = db.select().from(examAttempts).where(eq(examAttempts.id, a1.id)).get()!;
    check("Devuelve la corrección: 6 → 8", r2.regraded && r2.scoreBefore === 6 && r2.scoreAfter === 8, r2);
    check("La base guarda 8 (manual 3 + auto 5)", fila2.finalScore === 8 && fila2.manualScore === 3, { f: fila2.finalScore, m: fila2.manualScore });
    const reg1 = auditRows("regrade_exam", a1.id);
    check("Auditoría regrade_exam con antes y después", reg1.length === 1 && detalle(reg1[0]).scoreBefore === 6 && detalle(reg1[0]).scoreAfter === 8, reg1.map((r) => r.detail));
    check("La auditoría dice de quién es la nota", detalle(reg1[0]).studentName === s.fullName, detalle(reg1[0]).studentName);
    check("El alumno recibe otro aviso", notices(examen.id, "grade_published") === 2);
    check("Al alza: la matrícula pasa a completada", db.select().from(enrollments).where(eq(enrollments.id, enrollment.id)).get()!.status === "completed");
    check("No avisa de certificado: antes de esta corrección no estaba completado", r2.warning === undefined, r2.warning);

    console.log("\n— Corregir con los mismos puntos: no se molesta al alumno");
    const r3 = grading.gradeOpenAnswer({ gradedBy: t.id, attemptId: a1.id, questionId: qOpen, points: 3 });
    check("La nota sigue en 8", r3.regraded && r3.scoreBefore === 8 && r3.scoreAfter === 8, r3);
    check("Sin aviso nuevo", notices(examen.id, "grade_published") === 2);
    check("Pero queda registrado que se volvió a revisar", auditRows("regrade_exam", a1.id).length === 2);

    console.log("\n— Corregir a la baja a quien ya tiene certificado");
    const cert = await certs.issueCertificate(enrollment.id);
    check("Certificado emitido", !!cert, cert?.folio);
    if (cert) entityIds.push(cert.id);
    const r4 = grading.gradeOpenAnswer({
      gradedBy: t.id,
      attemptId: a1.id,
      questionId: qOpen,
      points: 0,
      feedbackMd: "Revisado otra vez: falta el punto de reunión",
    });
    const fila4 = db.select().from(examAttempts).where(eq(examAttempts.id, a1.id)).get()!;
    check("Devuelve la corrección: 8 → 5", r4.scoreBefore === 8 && r4.scoreAfter === 5, r4);
    check("La base guarda 5", fila4.finalScore === 5 && fila4.manualScore === 0, fila4.finalScore);
    check("La matrícula sigue completada (no se des-aprueba a nadie)", db.select().from(enrollments).where(eq(enrollments.id, enrollment.id)).get()!.status === "completed");
    const certVivo = db.select().from(certsTable).where(eq(certsTable.id, cert!.id)).get();
    check("El certificado sigue existiendo y válido", !!certVivo && !certVivo.revoked);
    check("Avisa al maestro con el folio", (r4.warning ?? "").includes(cert!.folio), r4.warning);
    check("El alumno recibe el tercer aviso (la nota bajó)", notices(examen.id, "grade_published") === 3);

    const reabierto = grading.attemptForGrading(a1.id)!;
    const abierta = reabierto.openAnswers.find((o) => o.questionId === qOpen)!;
    check("Se puede reabrir lo calificado con sus puntos y comentarios", abierta.manualPoints === 0 && (abierta.feedbackMd ?? "").includes("punto de reunión"), abierta);

    console.log("\n— Tarea: calificar, corregir y devolver");
    const entrega = assignments.submitAssignment({
      courseId: course.id,
      studentId: s.id,
      itemId: tarea.id,
      answerText: "Mi plan de evacuación",
    });
    entityIds.push(entrega.id);
    const g1 = grading.gradeSubmission({ gradedBy: t.id, submissionId: entrega.id, score: 70, feedbackMd: "Bien", action: "grade" });
    check("Primera nota: 70 y no es corrección", !g1.regraded && g1.scoreBefore === null && g1.scoreAfter === 70, g1);
    check("Auditoría grade_assignment", auditRows("grade_assignment", entrega.id).length === 1);
    check("El alumno recibe 1 aviso", notices(tarea.id, "grade_published") === 1);

    const g2 = grading.gradeSubmission({ gradedBy: t.id, submissionId: entrega.id, score: 90, feedbackMd: "Mejor de lo que leí", action: "grade" });
    const sub2 = db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, entrega.id)).get()!;
    check("Corrección 70 → 90", g2.regraded && g2.scoreBefore === 70 && g2.scoreAfter === 90, g2);
    check("La base guarda 90", sub2.score === 90 && sub2.status === "graded", sub2.score);
    const reg2 = auditRows("regrade_assignment", entrega.id);
    check("Auditoría regrade_assignment con antes y después", reg2.length === 1 && detalle(reg2[0]).scoreBefore === 70 && detalle(reg2[0]).scoreAfter === 90, reg2.map((r) => r.detail));
    check("El alumno recibe otro aviso", notices(tarea.id, "grade_published") === 2);
    check("Avisa que ya completó el curso", (g2.warning ?? "").includes(cert!.folio), g2.warning);

    const g3 = grading.gradeSubmission({ gradedBy: t.id, submissionId: entrega.id, score: 90, feedbackMd: "Mejor de lo que leí", action: "grade" });
    check("Misma nota: sin aviso nuevo", g3.scoreAfter === 90 && notices(tarea.id, "grade_published") === 2, g3);

    const dev = grading.gradeSubmission({ gradedBy: t.id, submissionId: entrega.id, score: 0, feedbackMd: "Complétalo, por favor", action: "return" });
    const sub3 = db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, entrega.id)).get()!;
    check("Devolver sigue funcionando", sub3.status === "returned" && !dev.regraded, sub3.status);
    check("El alumno recibe «te la devolvieron»", notices(tarea.id, "submission_returned") === 1);
    check("Devolver no manda «calificación publicada»", notices(tarea.id, "grade_published") === 2);

    console.log("\n— Lista de lo ya calificado");
    const aPend = examsSvc.startAttempt({ courseId: course.id, studentId: s.id, examItemId: pendiente.id });
    examsSvc.saveAnswer({ studentId: s.id, attemptId: aPend.id, questionId: qPend, answerText: "Avisar y evacuar" });
    examsSvc.submitAttempt({ courseId: course.id, studentId: s.id, attemptId: aPend.id });
    entityIds.push(aPend.id);

    const lista = grading.gradedRecently(ownScope(t), { courseId: course.id });
    const examEntry = lista.find((e) => e.kind === "exam" && e.attemptId === a1.id);
    const tareaEntry = lista.find((e) => e.kind === "assignment" && e.submissionId === entrega.id);
    check("Trae el examen calificado con su nota", examEntry?.score === 5 && examEntry?.maxScore === 10, { s: examEntry?.score, m: examEntry?.maxScore });
    check("Dice quién calificó y cuándo", examEntry?.gradedByName === t.fullName && !!examEntry?.gradedAt, examEntry?.gradedByName);
    check("Trae la tarea devuelta con su estado", tareaEntry?.status === "returned" && tareaEntry?.maxScore === 100, tareaEntry?.status);
    check("No trae lo pendiente de calificar", !lista.some((e) => e.kind === "exam" && e.attemptId === aPend.id));
    check("Lo pendiente sigue en la cola de por calificar", grading.gradingQueue(ownScope(t)).some((e) => e.kind === "exam" && e.attemptId === aPend.id));
    check("Lo más reciente primero", lista.length >= 2 && (lista[0].gradedAt?.getTime() ?? 0) >= (lista[1].gradedAt?.getTime() ?? 0));
    check("Respeta el límite", grading.gradedRecently(ownScope(t), { courseId: course.id, limit: 1 }).length === 1);

    otroMaestroId = nanoid();
    db.insert(users)
      .values({ id: otroMaestroId, email: "zregrade-maestro@test.local", passwordHash: "x", fullName: "zregrade Maestro", role: "teacher" })
      .run();
    const otro = { id: otroMaestroId, role: "teacher" };
    check("Otro maestro no ve lo de este curso", grading.gradedRecently(ownScope(otro)).every((e) => e.courseId !== course.id));
    check("«General» sí lo ve", grading.gradedRecently({ kind: "all" }, { courseId: course.id }).length >= 2);
  } finally {
    // Limpieza: nada de esto debe quedarse en la base real
    cleanupSmokeGradingAudit([course.id]);
    if (entityIds.length) {
      db.delete(auditLog).where(and(eq(auditLog.action, "issue_certificate"), inArray(auditLog.entityId, entityIds))).run();
    }
    for (const id of enrollmentIds) {
      db.delete(jobs)
        .where(and(eq(jobs.type, "generate_certificate"), sql`json_extract(${jobs.payload}, '$.enrollmentId') = ${id}`))
        .run();
    }
    if (otroMaestroId) db.delete(users).where(eq(users.id, otroMaestroId)).run();
    cleanupSmokeNotifications([course.id]);
    removeDemoCourses([TITLE], t.id);
    removeLeftovers(t.id);
  }

  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exit(1);
  }
  console.log("\n✅ CORREGIR CALIFICACIÓN OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
