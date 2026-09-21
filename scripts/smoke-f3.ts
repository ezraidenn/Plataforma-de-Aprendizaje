/**
 * Prueba end-to-end de Fase 3: tareas, calificación manual, notificaciones,
 * emisión de certificado con plantilla + folio + QR y verificación.
 *
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/smoke-f3.ts
 */
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import { and, eq, sql } from "drizzle-orm";
import { Readable } from "node:stream";

import { db } from "../src/server/db";
import { ownScope } from "../src/server/auth/view-scope";
import {
  users,
  itemTexts,
  courses as coursesTable,
  enrollments,
  jobs,
  certificates as certsTable,
  certificateTemplates,
  examAttempts,
  assignmentSubmissions,
} from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import * as examsSvc from "../src/server/services/exams";
import * as assignments from "../src/server/services/assignments";
import * as grading from "../src/server/services/grading";
import * as certs from "../src/server/services/certificates";
import * as notifs from "../src/server/services/notifications";
import * as resources from "../src/server/services/resources";
import { saveStream } from "../src/server/services/storage";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TEMPLATE_NAME = "Diploma demo";

/**
 * Cada corrida crea una plantilla «Diploma demo» y antes se quedaba para
 * siempre (una por corrida). Borra las del maestro demo con ese nombre que
 * ningún curso usa: al inicio, las de corridas viejas; al final, la de esta.
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

  const TITLE = "Curso demo F3 — Certificación";
  for (const p of db.select().from(coursesTable).where(eq(coursesTable.title, TITLE)).all()) {
    // Limpieza de prueba: borrar primero los certificados de corridas anteriores
    // (en producción deleteCourse los protege y exige archivar)
    db.delete(certsTable).where(eq(certsTable.courseId, p.id)).run();
    courses.deleteCourse(p.id);
  }
  removeUnusedDemoTemplates(teacher.id);

  console.log("\n— Plantilla de certificado");
  const template = certs.createTemplate(teacher.id, TEMPLATE_NAME);
  check("Plantilla con campos default", (template.fields as unknown[]).length >= 4);

  console.log("\n— Curso: lectura + tarea + examen con abierta; regla: promedio >= 60");
  const course = courses.createCourse({ ownerId: teacher.id, title: TITLE });
  db.update(coursesTable)
    .set({
      certificateTemplateId: template.id,
      completionRules: {
        op: "AND",
        conditions: [
          { type: "viewing_completion", min_percent: 100 },
          { type: "exam_average", min_percent: 60, scope: "all" },
        ],
      },
    })
    .where(eq(coursesTable.id, course.id))
    .run();

  const lectura = tree.createItem({ courseId: course.id, parentId: null, kind: "text", title: "Intro" });
  db.update(itemTexts).set({ minReadSeconds: 0 }).where(eq(itemTexts.itemId, lectura.id)).run();

  const tarea = tree.createItem({ courseId: course.id, parentId: null, kind: "assignment", title: "Plan de evacuación" });
  assignments.updateAssignmentSettings(tarea.id, { maxScore: 100, allowResubmission: true });

  const examen = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen abierto" });
  const q1 = examsSvc.createQuestion(examen.id, {
    type: "single_choice", promptMd: "2+2", points: 5,
    options: [{ textMd: "4", isCorrect: true }, { textMd: "5", isCorrect: false }],
  });
  const q2 = examsSvc.createQuestion(examen.id, { type: "open_text", promptMd: "Explica el protocolo", points: 5 });

  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [student.id], teacher.id);
  const enrollment = progress.getEnrollment(course.id, student.id)!;

  console.log("\n— Flujo del estudiante");
  progress.textHeartbeat({ courseId: course.id, studentId: student.id, itemId: lectura.id });

  const file = await saveStream({
    stream: Readable.from(Buffer.from("entrega de prueba")),
    originalName: "plan.pdf",
    mimeType: "application/pdf",
    kind: "submission",
    uploadedBy: student.id,
  });
  const submission = assignments.submitAssignment({
    courseId: course.id, studentId: student.id, itemId: tarea.id, fileId: file.id, comment: "Mi plan",
  });
  check("Tarea entregada (status submitted)", submission.status === "submitted");

  const attempt = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt.id, questionId: q1, selectedOptionIds: examsSvc.listQuestions(examen.id).find((q) => q.id === q1)!.options.filter((o) => o.isCorrect).map((o) => o.id) });
  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt.id, questionId: q2, answerText: "Evacuar en orden por la ruta señalizada." });
  const sub = examsSvc.submitAttempt({ courseId: course.id, studentId: student.id, attemptId: attempt.id });
  check("Examen queda submitted (abierta pendiente)", sub.status === "submitted" && sub.autoScore === 5);

  const enrollMid = db.select().from(enrollments).where(eq(enrollments.id, enrollment.id)).get()!;
  check("Curso AÚN NO aprobado (falta calificar)", enrollMid.status === "active");

  const teacherNotifs = notifs.listNotifications(teacher.id, 10).map((n) => n.type);
  check("Maestro notificado: entrega + examen por calificar",
    teacherNotifs.includes("assignment_submitted") && teacherNotifs.includes("exam_needs_grading"),
    teacherNotifs.join(","));

  console.log("\n— Cola de calificación del maestro");
  const queue = grading.gradingQueue(ownScope(teacher));
  const examEntry = queue.find((e) => e.kind === "exam" && e.courseTitle === TITLE);
  const taskEntry = queue.find((e) => e.kind === "assignment" && e.courseTitle === TITLE);
  check("Cola contiene el examen y la tarea", !!examEntry && !!taskEntry, JSON.stringify(queue.map((q) => q.kind)));
  check("Examen reporta 1 pregunta pendiente", examEntry?.kind === "exam" && examEntry.pendingQuestions === 1);

  const forGrading = grading.attemptForGrading(attempt.id)!;
  check("attemptForGrading trae la abierta", forGrading.openAnswers.length === 1 && forGrading.openAnswers[0].answerText !== null);

  let rangeErr = "";
  try {
    grading.gradeOpenAnswer({ gradedBy: teacher.id, attemptId: attempt.id, questionId: q2, points: 99 });
  } catch (e) { rangeErr = (e as Error).message; }
  check("Puntos fuera de rango rechazados", rangeErr.includes("entre 0 y"));

  const graded = grading.gradeOpenAnswer({ gradedBy: teacher.id, attemptId: attempt.id, questionId: q2, points: 4, feedbackMd: "Bien, falta el punto de reunión" });
  check("Al calificar la última abierta se finaliza", graded.finalized);

  const attemptFinal = db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id)).get()!;
  check("final_score = auto 5 + manual 4", attemptFinal.finalScore === 9 && attemptFinal.status === "graded", JSON.stringify({ f: attemptFinal.finalScore }));

  console.log("\n— Aprobación y certificado");
  const enrollAfter = db.select().from(enrollments).where(eq(enrollments.id, enrollment.id)).get()!;
  check("Curso aprobado tras publicar score (90% >= 60%)", enrollAfter.status === "completed");

  const certJob = db.select().from(jobs).where(eq(jobs.type, "generate_certificate")).all()
    .find((j) => (j.payload as { enrollmentId?: string }).enrollmentId === enrollment.id);
  check("Job generate_certificate encolado", !!certJob);

  // Simular al worker (en el server corre solo; aquí lo invocamos directo)
  const cert = await certs.issueCertificate(enrollment.id);
  check("Certificado emitido", !!cert);
  check("Folio con formato CERT-YYYY-######-XXXX", /^CERT-\d{4}-\d{6}-[A-Z2-9]{4}$/.test(cert!.folio), cert!.folio);

  // El PDF ya no se guarda en disco: se genera al descargar desde templateSnapshot
  check("No deja PDF en disco", cert!.pdfFileId === null);
  check("Guarda copia de la plantilla al emitir", !!cert!.templateSnapshot);
  const rendered = await certs.renderCertificateFor(cert!);
  check("Se genera bajo demanda y pesa > 1KB", !!rendered && rendered.bytes.length > 1024);
  check(
    "Es un PDF válido (header %PDF-)",
    Buffer.from(rendered!.bytes.subarray(0, 5)).toString() === "%PDF-"
  );
  check("El nombre del archivo lleva el folio", rendered!.fileName.includes(cert!.folio));

  const again = await certs.issueCertificate(enrollment.id);
  check("Emisión idempotente (mismo folio)", again?.folio === cert!.folio);

  console.log("\n— Verificación pública");
  const v = certs.verifyCertificate(cert!.folio);
  check("Folio válido verifica", v.status === "valid" && v.studentName === student.fullName && v.courseTitle === TITLE);
  check("Folio inexistente → not_found", certs.verifyCertificate("CERT-2099-999999-XXXX").status === "not_found");

  // La validez es por estado (existe y no está revocado), no por la firma: un
  // hash que no coincide (p. ej. otro APP_SECRET tras reinstalar) no invalida
  // el QR impreso
  db.update(certsTable).set({ verificationHash: "manipulado" }).where(eq(certsTable.id, cert!.id)).run();
  check("Hash distinto → sigue valid (no depende del secreto)", certs.verifyCertificate(cert!.folio).status === "valid");
  db.update(certsTable)
    .set({ verificationHash: certs.verificationHash(cert!.folio, cert!.studentId, cert!.courseId, cert!.issuedAt.getTime()) })
    .where(eq(certsTable.id, cert!.id))
    .run();

  certs.revokeCertificate(cert!.id, "Prueba de revocación");
  check("Revocado → revoked", certs.verifyCertificate(cert!.folio).status === "revoked");
  db.update(certsTable).set({ revoked: false, revokedReason: null, revokedAt: null }).where(eq(certsTable.id, cert!.id)).run();

  console.log("\n— Calificar tarea y notificaciones del alumno");
  grading.gradeSubmission({ gradedBy: teacher.id, submissionId: submission.id, score: 90, feedbackMd: "Buen trabajo", action: "grade" });
  const gradedSub = db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, submission.id)).get()!;
  check("Tarea calificada 90", gradedSub.status === "graded" && gradedSub.score === 90);

  const studentTypes = notifs.listNotifications(student.id, 20).map((n) => n.type);
  check("Alumno notificado: score publicado + curso completado + certificado",
    studentTypes.includes("grade_published") && studentTypes.includes("course_completed") && studentTypes.includes("certificate_issued"),
    studentTypes.join(","));
  check("unreadCount del alumno > 0", notifs.unreadCount(student.id) > 0);
  notifs.markAllRead(student.id);
  check("markAllRead deja 0", notifs.unreadCount(student.id) === 0);

  console.log("\n— Recurso descargable, enlace externo y entrega estilo Teams");
  // Los nuevos ítems se agregan al curso ya completado; son opcionales (no
  // requeridos) para no alterar el estado de la matrícula.
  const enlace = tree.createItem({ courseId: course.id, parentId: null, kind: "link", title: "Norma oficial" });
  tree.updateItem(course.id, enlace.id, { requiredForCompletion: false, sequenceMode: "free" });
  check("Ítem link crea fila item_links vacía", resources.getLink(enlace.id)?.url === "");
  let urlErr = "";
  try { resources.updateLink(enlace.id, { url: "ftp://malo" }); } catch (e) { urlErr = (e as Error).message; }
  check("updateLink rechaza URL sin http(s)", urlErr.includes("http"));
  resources.updateLink(enlace.id, { url: "https://www.gob.mx/stps", description: "NOM-035" });
  const linkRow = resources.getLink(enlace.id)!;
  check("updateLink guarda URL y descripción", linkRow.url === "https://www.gob.mx/stps" && linkRow.description === "NOM-035");
  resources.markLinkOpened(course.id, student.id, enlace.id);
  check("markLinkOpened completa el ítem", progress.getProgressMap(enrollment.id).get(enlace.id)?.status === "completed");

  const recurso = tree.createItem({ courseId: course.id, parentId: null, kind: "resource", title: "Formatos" });
  tree.updateItem(course.id, recurso.id, { requiredForCompletion: false, sequenceMode: "free" });
  const resFile = await saveStream({
    stream: Readable.from(Buffer.from("col1,col2\n1,2")),
    originalName: "formato.csv",
    mimeType: "text/csv",
    kind: "resource",
    uploadedBy: teacher.id,
  });
  const resFile2 = await saveStream({
    stream: Readable.from(Buffer.from("zip")),
    originalName: "anexos.zip",
    mimeType: "application/zip",
    kind: "resource",
    uploadedBy: teacher.id,
  });
  let kindErr = "";
  try { resources.addResourceFile(recurso.id, file.id, teacher); } catch (e) { kindErr = (e as Error).message; }
  check("addResourceFile rechaza archivos de otro kind", kindErr.length > 0);
  resources.addResourceFile(recurso.id, resFile.id, teacher);
  resources.addResourceFile(recurso.id, resFile2.id, teacher);
  let resList = resources.listResourceFiles(recurso.id);
  check("Recurso lista 2 archivos en orden", resList.length === 2 && resList[0].originalName === "formato.csv" && resList[1].position === 1);
  resources.reorderResourceFiles(recurso.id, [resList[1].id, resList[0].id]);
  resList = resources.listResourceFiles(recurso.id);
  check("reorderResourceFiles invierte el orden", resList[0].originalName === "anexos.zip");
  check("resourceItemForFile resuelve ítem/curso", resources.resourceItemForFile(resFile.id)?.courseId === course.id);
  resources.markResourceDownloaded(course.id, student.id, recurso.id);
  check("markResourceDownloaded completa el ítem", progress.getProgressMap(enrollment.id).get(recurso.id)?.status === "completed");
  resources.removeResourceFile(recurso.id, resList[0].id);
  check("removeResourceFile deja 1", resources.listResourceFiles(recurso.id).length === 1);

  const tarea2 = tree.createItem({ courseId: course.id, parentId: null, kind: "assignment", title: "Reflexión" });
  tree.updateItem(course.id, tarea2.id, { requiredForCompletion: false, sequenceMode: "free" });
  assignments.updateAssignmentSettings(tarea2.id, { allowResubmission: true });
  const attFile = await saveStream({
    stream: Readable.from(Buffer.from("rubrica")),
    originalName: "rubrica.pdf",
    mimeType: "application/pdf",
    kind: "attachment",
    uploadedBy: teacher.id,
  });
  assignments.addAssignmentAttachment(tarea2.id, attFile.id, teacher);
  check("Adjunto de tarea listado", assignments.listAssignmentAttachments(tarea2.id)[0]?.originalName === "rubrica.pdf");
  check("attachmentItemForFile resuelve ítem", assignments.attachmentItemForFile(attFile.id)?.itemId === tarea2.id);

  let emptyErr = "";
  try { assignments.submitAssignment({ courseId: course.id, studentId: student.id, itemId: tarea2.id }); } catch (e) { emptyErr = (e as Error).message; }
  check("Entrega vacía rechazada", emptyErr.includes("respuesta"));

  const textOnly = assignments.submitAssignment({
    courseId: course.id, studentId: student.id, itemId: tarea2.id, answerText: "<p>Mi <strong>reflexión</strong></p>",
  });
  check("Entrega solo texto: fileId null y answerText guardado", textOnly.fileId === null && textOnly.answerText.includes("<strong>"));
  check("Entrega solo texto sin archivos", assignments.listSubmissionFiles(textOnly).length === 0);

  const s1 = await saveStream({ stream: Readable.from(Buffer.from("a")), originalName: "a.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "submission", uploadedBy: student.id });
  const s2 = await saveStream({ stream: Readable.from(Buffer.from("b")), originalName: "b.pdf", mimeType: "application/pdf", kind: "submission", uploadedBy: student.id });
  const multi = assignments.submitAssignment({
    courseId: course.id, studentId: student.id, itemId: tarea2.id, fileIds: [s1.id, s2.id], answerText: "", comment: "Dos archivos",
  });
  const multiFiles = assignments.listSubmissionFiles(multi);
  check("Entrega con 2 archivos: fileId = primero y 2 filas en submission_files",
    multi.fileId === s1.id && multiFiles.length === 2 && multiFiles[1].originalName === "b.pdf");
  let foreignErr = "";
  try {
    assignments.submitAssignment({ courseId: course.id, studentId: student.id, itemId: tarea2.id, fileIds: [attFile.id] });
  } catch (e) { foreignErr = (e as Error).message; }
  check("Archivo ajeno (kind attachment) rechazado en entrega", foreignErr.length > 0);

  // La plantilla de prueba no se queda: el curso demo sigue, ya sin plantilla
  if (failures === 0) {
    db.update(coursesTable)
      .set({ certificateTemplateId: null })
      .where(and(eq(coursesTable.id, course.id), eq(coursesTable.certificateTemplateId, template.id)))
      .run();
    removeUnusedDemoTemplates(teacher.id);
    check("La plantilla de prueba no se queda", !certs.getTemplate(template.id));
  }

  console.log(failures === 0 ? "\n✅ TODO PASÓ (F3)" : `\n❌ ${failures} fallas`);
  // No dejar la campana de las cuentas demo llena de avisos de prueba
  cleanupSmokeNotifications([course.id]);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
