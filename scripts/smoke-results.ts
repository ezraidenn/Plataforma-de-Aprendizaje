/**
 * Publicar resultados de un examen: la regla de visibilidad y el flujo real
 * (manual, al cierre, preguntas abiertas) contra la base.
 *
 * Uso: pnpm smoke:results
 */
import { resultsVisible, type ExamResultsMode } from "../src/lib/exam-results";
import { cleanupSmokeGradingAudit, cleanupSmokeNotifications, removeDemoCourses } from "./lib/smoke-cleanup";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "../src/server/db";
import { courses as coursesTable, notifications, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import * as results from "../src/server/services/exam-results";
import { gradeOpenAnswer } from "../src/server/services/grading";
import { buildExamLessonData } from "../src/components/student/lesson-data";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const HOUR = 3_600_000;

function pureRule() {
  console.log("\n— Regla de visibilidad");
  const now = Date.UTC(2026, 8, 11, 12);
  const at = (ms: number) => new Date(ms);
  check("Al enviar: siempre visibles", resultsVisible({ showResultsMode: "immediately", closesAt: null, resultsPublishedAt: null }, now));
  check("Al cierre: ocultos antes de cerrar", !resultsVisible({ showResultsMode: "after_close", closesAt: at(now + HOUR), resultsPublishedAt: null }, now));
  check("Al cierre: visibles al cerrar", resultsVisible({ showResultsMode: "after_close", closesAt: at(now), resultsPublishedAt: null }, now));
  check("Al cierre: publicados antes del cierre", resultsVisible({ showResultsMode: "after_close", closesAt: at(now + HOUR), resultsPublishedAt: at(now - HOUR) }, now));
  check("Al cierre sin fecha: ocultos hasta publicar", !resultsVisible({ showResultsMode: "after_close", closesAt: null, resultsPublishedAt: null }, now));
  check("Al cierre sin fecha: publicados", resultsVisible({ showResultsMode: "after_close", closesAt: null, resultsPublishedAt: at(now) }, now));
  check("Cuando yo decida: ocultos aunque el examen cerró", !resultsVisible({ showResultsMode: "manual", closesAt: at(now - HOUR), resultsPublishedAt: null }, now));
  check("Cuando yo decida: publicados", resultsVisible({ showResultsMode: "manual", closesAt: null, resultsPublishedAt: at(now) }, now));
}

const PREFIX = "Curso demo — Publicar resultados";
const courseIds: string[] = [];
const teacher = () => db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
const student = () => db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;

/** Curso publicado con un examen (una de opción múltiple y, si se pide, una abierta). */
function setup(label: string, mode: ExamResultsMode, opts: { closesAt?: Date; withOpen?: boolean } = {}) {
  const course = courses.createCourse({ ownerId: teacher().id, title: `${PREFIX} · ${label}` });
  courseIds.push(course.id);
  const exam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: `Examen ${label}` });
  examsSvc.createQuestion(exam.id, {
    type: "single_choice",
    promptMd: "¿2 + 2?",
    points: 1,
    options: [
      { textMd: "4", isCorrect: true },
      { textMd: "5", isCorrect: false },
    ],
  });
  if (opts.withOpen) examsSvc.createQuestion(exam.id, { type: "open_text", promptMd: "Explica por qué", points: 1 });
  examsSvc.updateExamSettings(exam.id, { showResultsMode: mode, closesAt: opts.closesAt ?? null });
  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [student().id], teacher().id);
  return { courseId: course.id, itemId: exam.id };
}

/** El alumno responde todo bien y envía. */
function takeExam(courseId: string, itemId: string) {
  const studentId = student().id;
  const attempt = examsSvc.startAttempt({ courseId, studentId, examItemId: itemId });
  for (const q of examsSvc.listQuestions(itemId)) {
    if (q.type === "open_text") examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: q.id, answerText: "Porque sí" });
    else examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: q.id, selectedOptionIds: [q.options.find((o) => o.isCorrect)!.id] });
  }
  return examsSvc.submitAttempt({ courseId, studentId, attemptId: attempt.id });
}

function lessonData(itemId: string) {
  const d = buildExamLessonData(itemId, student().id);
  if (d.kind !== "exam") throw new Error("Examen no disponible");
  return d;
}

function notices(itemId: string, type: "results_available" | "grade_published") {
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

function manualFlow() {
  console.log("\n— Cuando yo decida");
  const { courseId, itemId } = setup("Manual", "manual");
  db.update(coursesTable)
    .set({ completionRules: { op: "AND", conditions: [{ type: "exam_specific", item_id: itemId, min_percent: 80 }] } })
    .where(eq(coursesTable.id, courseId))
    .run();
  const attempt = takeExam(courseId, itemId);
  check("El intento queda calificado", attempt.status === "graded", attempt.status);

  let d = lessonData(itemId);
  check("Oculto: sin % en «Intentos anteriores»", !d.resultsVisible && d.pastAttempts[0]?.percent === null, d.pastAttempts);
  check("Oculto: el curso lo lista como pendiente", results.hiddenResultsExamIds(courseId).has(itemId));
  check("1 alumno con intento", results.studentsWithAttempts(itemId) === 1);

  const first = results.setExamResultsPublished(itemId, true);
  d = lessonData(itemId);
  check("Publicar avisa a 1 alumno", first.notified === 1 && notices(itemId, "results_available") === 1, first);
  check("Publicado: % visible", d.resultsVisible && d.pastAttempts[0]?.percent === 100, d.pastAttempts);
  check("Publicado: deja de estar pendiente en el curso", !results.hiddenResultsExamIds(courseId).has(itemId));

  const again = results.setExamResultsPublished(itemId, true);
  check("Publicar otra vez no repite el aviso", again.notified === 0 && notices(itemId, "results_available") === 1, again);

  results.setExamResultsPublished(itemId, false);
  d = lessonData(itemId);
  check("Ocultar: vuelve a oculto", !d.resultsVisible && d.pastAttempts[0]?.percent === null);

  const republish = results.setExamResultsPublished(itemId, true);
  check("Republicar tras ocultar no repite el aviso", republish.notified === 0 && notices(itemId, "results_available") === 1);
}

function afterCloseFlow() {
  console.log("\n— Al cerrar el examen");
  const now = Date.now();
  const { courseId, itemId } = setup("Al cierre", "after_close", { closesAt: new Date(now + HOUR) });
  takeExam(courseId, itemId);

  check("Abierto: oculto", !lessonData(itemId).resultsVisible);
  results.runResultsAvailable(now);
  check("Abierto: el worker no avisa", notices(itemId, "results_available") === 0);

  examsSvc.updateExamSettings(itemId, { closesAt: new Date(now - 1000) });
  const d = lessonData(itemId);
  check("Cerrado: % visible", d.resultsVisible && d.pastAttempts[0]?.percent === 100, d.pastAttempts);

  results.runResultsAvailable(now);
  check("Cerrado: el worker avisa 1 vez", notices(itemId, "results_available") === 1);
  check("Queda marcado como avisado", examsSvc.getExam(itemId)!.resultsNotifiedAt !== null);
  results.runResultsAvailable(now);
  check("Segunda corrida: sin avisos nuevos", notices(itemId, "results_available") === 1);

  examsSvc.updateExamSettings(itemId, { closesAt: new Date(now - 500) });
  check("Cambiar el cierre deja el aviso pendiente otra vez", examsSvc.getExam(itemId)!.resultsNotifiedAt === null);
  results.runResultsAvailable(now);
  check("…pero no repite el aviso a quien ya lo recibió", notices(itemId, "results_available") === 1);
}

function openQuestionFlow() {
  console.log("\n— Preguntas abiertas");
  const { courseId, itemId } = setup("Abierta", "manual", { withOpen: true });
  const attempt = takeExam(courseId, itemId);
  check("Con pregunta abierta queda en revisión", attempt.status === "submitted", attempt.status);
  check("En revisión no se le avisa al publicar", results.setExamResultsPublished(itemId, true).notified === 0);
  results.setExamResultsPublished(itemId, false);

  const open = examsSvc.listQuestions(itemId).find((q) => q.type === "open_text")!;
  const graded = gradeOpenAnswer({ gradedBy: teacher().id, attemptId: attempt.id, questionId: open.id, points: 1 });
  check("Termina la calificación", graded.finalized);
  check("Oculto: no avisa «Calificación publicada»", notices(itemId, "grade_published") === 0);
  check("Al publicar sí se le avisa", results.setExamResultsPublished(itemId, true).notified === 1);

  const visible = setup("Abierta al enviar", "immediately", { withOpen: true });
  const a2 = takeExam(visible.courseId, visible.itemId);
  const open2 = examsSvc.listQuestions(visible.itemId).find((q) => q.type === "open_text")!;
  gradeOpenAnswer({ gradedBy: teacher().id, attemptId: a2.id, questionId: open2.id, points: 1 });
  check("Visible: sí avisa «Calificación publicada»", notices(visible.itemId, "grade_published") === 1);
}

async function main() {
  pureRule();

  for (const c of db.select().from(coursesTable).where(like(coursesTable.title, `${PREFIX}%`)).all()) courses.deleteCourse(c.id);
  manualFlow();
  afterCloseFlow();
  openQuestionFlow();
  cleanupSmokeGradingAudit(courseIds);
  cleanupSmokeNotifications(courseIds);

  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exit(1);
  }
  removeDemoCourses(courseIds.map((id) => courses.getCourse(id)!.title), teacher().id);
  console.log("\n✅ PUBLICAR RESULTADOS OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
