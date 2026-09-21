/**
 * Prueba end-to-end de Fase 2: exámenes (autocalificación, políticas de
 * intentos, ventanas), motor de reglas + notificaciones, y video (intervalos,
 * anti-seek) — contra los servicios reales con reloj de verdad.
 *
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/smoke-f2.ts
 */
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import { eq, and } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Readable } from "node:stream";

import { db } from "../src/server/db";
import {
  users,
  itemTexts,
  itemVideos,
  courses as coursesTable,
  notifications,
  enrollments,
} from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import * as examsSvc from "../src/server/services/exams";
import * as video from "../src/server/services/video";
import * as rules from "../src/server/services/rules-engine";
import { attachDocumentFile } from "../src/server/services/documents";
import { saveStream } from "../src/server/services/storage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
  const student = db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;

  // Curso F2 limpio en cada corrida
  const TITLE = "Curso demo F2 — Exámenes y video";
  for (const p of db.select().from(coursesTable).where(eq(coursesTable.title, TITLE)).all()) {
    courses.deleteCourse(p.id);
  }

  console.log("\n— Estructura: lectura + video + examen");
  const course = courses.createCourse({ ownerId: teacher.id, title: TITLE });

  const lectura = tree.createItem({ courseId: course.id, parentId: null, kind: "text", title: "Introducción" });
  db.update(itemTexts).set({ contentMd: "Intro", minReadSeconds: 0 }).where(eq(itemTexts.itemId, lectura.id)).run();

  const vid = tree.createItem({ courseId: course.id, parentId: null, kind: "video", title: "Video de seguridad" });
  video.setVideoLink({ itemId: vid.id, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", durationSeconds: 10 });
  check("parseVideoUrl youtu.be", video.parseVideoUrl("https://youtu.be/abc123DEF45")?.videoId === "abc123DEF45");
  check("parseVideoUrl inválido rechazado", video.parseVideoUrl("https://ejemplo.com/x") === null);

  const examen = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen final" });
  examsSvc.updateExamSettings(examen.id, { maxAttempts: 2, attemptScorePolicy: "best", passScore: 80 });

  // Preguntas: 4 autocalificables (10 pts)
  const q1 = examsSvc.createQuestion(examen.id, {
    type: "single_choice", promptMd: "¿Extintor para fuego eléctrico?", points: 3,
    options: [
      { textMd: "Agua", isCorrect: false },
      { textMd: "CO2", isCorrect: true },
      { textMd: "Espuma", isCorrect: false },
    ],
  });
  const q2 = examsSvc.createQuestion(examen.id, {
    type: "multiple_choice", promptMd: "Elementos del fuego (elige todos)", points: 3,
    options: [
      { textMd: "Oxígeno", isCorrect: true },
      { textMd: "Calor", isCorrect: true },
      { textMd: "Nitrógeno", isCorrect: false },
    ],
  });
  const q3 = examsSvc.createQuestion(examen.id, {
    type: "true_false", promptMd: "El CO2 conduce electricidad", points: 2,
    options: [
      { textMd: "Verdadero", isCorrect: false },
      { textMd: "Falso", isCorrect: true },
    ],
  });
  const q4 = examsSvc.createQuestion(examen.id, {
    type: "short_text", promptMd: "Número de emergencias", points: 2,
    config: { accepted: ["911"] },
  });
  check("Máximo del examen = 10 pts", examsSvc.examMaxScore(examen.id) === 10);

  let validationError = "";
  try {
    examsSvc.createQuestion(examen.id, {
      type: "single_choice", promptMd: "Sin correcta", points: 1,
      options: [{ textMd: "A", isCorrect: false }, { textMd: "B", isCorrect: false }],
    });
  } catch (e) { validationError = (e as Error).message; }
  check("Validación: pregunta sin correcta rechazada", validationError.includes("correcta"));

  console.log("\n— Reglas: contenido 100% Y promedio exámenes >= 80%");
  db.update(coursesTable)
    .set({
      completionRules: {
        op: "AND",
        conditions: [
          { type: "viewing_completion", min_percent: 100 },
          { type: "exam_average", min_percent: 80, scope: "all" },
        ],
      },
    })
    .where(eq(coursesTable.id, course.id))
    .run();

  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [student.id], teacher.id);
  const enrollment = progress.getEnrollment(course.id, student.id)!;

  console.log("\n— Secuencia: el examen está bloqueado hasta ver el contenido");
  let startErr = "";
  try {
    examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
  } catch (e) { startErr = (e as Error).message; }
  check("startAttempt bloqueado por secuencia", startErr.includes("bloqueado"));

  progress.textHeartbeat({ courseId: course.id, studentId: student.id, itemId: lectura.id });

  console.log("\n— Video: intervalos con reloj real (duración 10 s)");
  let vh = video.videoHeartbeat({ courseId: course.id, studentId: student.id, itemId: vid.id, position: 0 });
  check("Primer latido de video: 0%", vh.percent === 0);
  vh = video.videoHeartbeat({ courseId: course.id, studentId: student.id, itemId: vid.id, position: 8 });
  check("Seek adelante inmediato NO acredita", vh.percent === 0 && vh.maxPosition === 8, JSON.stringify(vh));
  // regresar al inicio y ver de verdad
  video.videoHeartbeat({ courseId: course.id, studentId: student.id, itemId: vid.id, position: 0 });
  await sleep(3300);
  vh = video.videoHeartbeat({ courseId: course.id, studentId: student.id, itemId: vid.id, position: 3.3 });
  check("3.3 s reales acreditan ~33%", vh.percent >= 30 && vh.percent <= 36, `percent=${vh.percent}`);
  await sleep(3300);
  vh = video.videoHeartbeat({ courseId: course.id, studentId: student.id, itemId: vid.id, position: 6.6 });
  await sleep(3400);
  vh = video.videoHeartbeat({ courseId: course.id, studentId: student.id, itemId: vid.id, position: 9.9 });
  check("Cobertura >= 97% completa el video", vh.completed && vh.percent === 100, JSON.stringify(vh));

  console.log("\n— Examen: intento 1 perfecto (política best)");
  const attempt1 = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
  check("Intento 1 iniciado", attempt1.attemptNumber === 1 && attempt1.status === "in_progress");
  check("Orden de preguntas snapshot", Array.isArray(attempt1.questionOrder) && (attempt1.questionOrder as string[]).length === 4);

  const qs = examsSvc.listQuestions(examen.id);
  const opt = (qid: string, pred: (o: { isCorrect: boolean }) => boolean) =>
    qs.find((q) => q.id === qid)!.options.filter(pred).map((o) => o.id);

  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt1.id, questionId: q1, selectedOptionIds: opt(q1, (o) => o.isCorrect) });
  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt1.id, questionId: q2, selectedOptionIds: opt(q2, (o) => o.isCorrect) });
  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt1.id, questionId: q3, selectedOptionIds: opt(q3, (o) => o.isCorrect) });
  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt1.id, questionId: q4, answerText: " 911 " });

  const submitted1 = examsSvc.submitAttempt({ courseId: course.id, studentId: student.id, attemptId: attempt1.id });
  check("Intento 1 autocalificado 10/10", submitted1.status === "graded" && submitted1.finalScore === 10, JSON.stringify({ s: submitted1.status, f: submitted1.finalScore }));

  console.log("\n— Aprobación del curso (evento: score publicado)");
  const enrollmentAfter = db.select().from(enrollments).where(eq(enrollments.id, enrollment.id)).get()!;
  check("Enrollment marcado como completado", enrollmentAfter.status === "completed" && !!enrollmentAfter.completedAt);

  const notis = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.type, "course_completed")))
    .all()
    .filter((n) => (n.payload as { enrollmentId?: string }).enrollmentId === enrollment.id);
  check("Notificaciones a maestro y estudiante", notis.length === 2, `n=${notis.length}`);

  const display = rules.evaluateForDisplay(enrollment.id)!;
  check("Desglose de reglas: todo cumplido", display.passed && display.results.every((r) => r.passed));

  console.log("\n— Intento 2 malo: política 'best' conserva el 100%");
  const attempt2 = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt2.id, questionId: q1, selectedOptionIds: opt(q1, (o) => !o.isCorrect).slice(0, 1) });
  examsSvc.submitAttempt({ courseId: course.id, studentId: student.id, attemptId: attempt2.id });
  const exam = examsSvc.getExam(examen.id)!;
  const finalPct = examsSvc.computeFinalScorePercent(exam, examsSvc.listAttempts(examen.id, student.id));
  check("best => sigue 100%", finalPct === 100, `pct=${finalPct}`);

  let limitErr = "";
  try {
    examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
  } catch (e) { limitErr = (e as Error).message; }
  check("Límite de 2 intentos aplicado", limitErr.includes("intentos"));

  console.log("\n— Ventana de fechas");
  examsSvc.updateExamSettings(examen.id, { closesAt: new Date(Date.now() - 60_000) });
  check("Estado de ventana: closed", examsSvc.examWindowState(examsSvc.getExam(examen.id)!) === "closed");
  examsSvc.updateExamSettings(examen.id, { closesAt: null });

  console.log("\n— Examen con pregunta abierta queda 'submitted' (sin score)");
  const examen2 = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen con abierta" });
  const oq = examsSvc.createQuestion(examen2.id, { type: "open_text", promptMd: "Describe el procedimiento", points: 5 });
  const a3 = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen2.id });
  examsSvc.saveAnswer({ studentId: student.id, attemptId: a3.id, questionId: oq, answerText: "Primero evacuar..." });
  const s3 = examsSvc.submitAttempt({ courseId: course.id, studentId: student.id, attemptId: a3.id });
  check("Queda submitted con finalScore null", s3.status === "submitted" && s3.finalScore === null);

  console.log(failures === 0 ? "\n✅ TODO PASÓ (F2)" : `\n❌ ${failures} fallas`);
  // No dejar la campana de las cuentas demo llena de avisos de prueba
  cleanupSmokeNotifications([course.id]);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
