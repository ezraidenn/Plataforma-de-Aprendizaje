/**
 * Prueba F5: CSV de exámenes (export → import round-trip), lecciones masivas,
 * matrícula masiva y estadísticas.
 *
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/smoke-f5.ts
 */
import { cleanupSmokeNotifications, removeDemoCourses } from "./lib/smoke-cleanup";
import { eq, like } from "drizzle-orm";
import { db } from "../src/server/db";
import { users, courses as coursesTable, itemTexts } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import * as examsSvc from "../src/server/services/exams";
import * as examCsv from "../src/server/services/exam-csv";
import * as bulkLessons from "../src/server/services/bulk-lessons";
import * as bulkRoster from "../src/server/services/bulk-roster";
import * as stats from "../src/server/services/stats";

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
  const student2 = db.select().from(users).where(like(users.email, "imp-uno@%")).get()!;

  const TITLE = "Curso demo F5 — Masivo";
  for (const p of db.select().from(coursesTable).where(eq(coursesTable.title, TITLE)).all()) {
    courses.deleteCourse(p.id);
  }

  console.log("\n— CSV de exámenes: plantilla → import → export round-trip");
  const course = courses.createCourse({ ownerId: teacher.id, title: TITLE });
  const lectura = tree.createItem({ courseId: course.id, parentId: null, kind: "text", title: "Intro" });
  db.update(itemTexts).set({ minReadSeconds: 0 }).where(eq(itemTexts.itemId, lectura.id)).run();
  const examen = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen CSV" });

  const validated = examCsv.validateExamCsv(examCsv.EXAM_CSV_TEMPLATE);
  check("Plantilla: 7 filas válidas (todos los tipos)", validated.ok === 7 && validated.invalid === 0,
    JSON.stringify({ ok: validated.ok, inv: validated.invalid }));

  const imported = examCsv.importExamCsv({ actorId: teacher.id, examItemId: examen.id, csvText: examCsv.EXAM_CSV_TEMPLATE, mode: "replace" });
  check("Importadas 7 preguntas", imported.imported === 7);
  const qs = examsSvc.listQuestions(examen.id);
  check("Tipos correctos tras import",
    JSON.stringify(qs.map((q) => q.type)) ===
      JSON.stringify(["single_choice", "multiple_choice", "true_false", "short_text", "matching", "ordering", "open_text"]));
  const mc = qs[1];
  check("Múltiple con 3 correctas de 4", mc.options.length === 4 && mc.options.filter((o) => o.isCorrect).length === 3);

  const exported = examCsv.exportExamCsv(examen.id);
  const revalidated = examCsv.validateExamCsv(exported);
  check("Round-trip: el export re-valida completo", revalidated.ok === 7 && revalidated.invalid === 0);

  const badCsv = "tipo,pregunta,puntos,correctas\nopcion_unica,Sin opciones,2,1\ninvento,Qué,1,";
  const badVal = examCsv.validateExamCsv(badCsv);
  check("Filas malas detectadas con motivo", badVal.invalid === 2 && badVal.rows[1].message.includes("desconocido"));

  console.log("\n— Lecciones masivas: export → editar → import");
  const lessonsCsv = bulkLessons.exportLessonsCsv(course.id);
  check("Export incluye id y columnas editables", lessonsCsv.includes("id,carpeta,tipo,titulo") && lessonsCsv.includes(lectura.id));

  const edited = lessonsCsv
    .replace("Intro", "Introducción renovada")
    .replace(`${examen.id},,examen,Examen CSV,SI,heredar`, `${examen.id},,examen,Examen CSV,NO,libre`);
  const lessonVal = bulkLessons.validateLessonsCsv(course.id, edited);
  check("Detecta 2 filas con cambios", lessonVal.ok === 2, JSON.stringify(lessonVal.rows.map((r) => r.message)));

  const applied = bulkLessons.importLessonsCsv({ actorId: teacher.id, courseId: course.id, csvText: edited });
  check("Aplica 2 cambios", applied.updated === 2);
  check("Título actualizado", tree.getItem(lectura.id)!.title === "Introducción renovada");
  const examItem = tree.getItem(examen.id)!;
  check("Requerido NO + secuencia libre", !examItem.requiredForCompletion && examItem.sequenceMode === "free");

  let tamperErr = "";
  try {
    bulkLessons.validateLessonsCsv(course.id, lessonsCsv.replace(lectura.id, "id-falso-xyz"));
  } catch (e) { tamperErr = (e as Error).message; }
  const tamperedRows = bulkLessons.validateLessonsCsv(course.id, lessonsCsv.replace(lectura.id, "id-falso-xyz"));
  check("Id ajeno/alterado rechazado por fila", tamperedRows.invalid >= 1 && tamperErr === "");

  console.log("\n— Matrícula masiva");
  courses.publishCourse(course.id);
  const rosterCsv = [
    "correo,accion",
    `${student.email},matricular`,
    `${student2.email},matricular`,
    "noexiste@empresa.local,matricular",
    `${teacher.email},matricular`,
  ].join("\n");
  const rosterVal = bulkRoster.validateRosterCsv(course.id, rosterCsv);
  check("2 por matricular, 2 inválidos (inexistente + no-estudiante)",
    rosterVal.toEnroll === 2 && rosterVal.invalid === 2, JSON.stringify(rosterVal));

  const rosterResult = bulkRoster.importRosterCsv({ actorId: teacher.id, courseId: course.id, csvText: rosterCsv });
  check("Matriculados 2", rosterResult.enrolled === 2);

  const unenrollCsv = `correo,accion\n${student2.email},quitar`;
  const un = bulkRoster.importRosterCsv({ actorId: teacher.id, courseId: course.id, csvText: unenrollCsv });
  check("Baja aplicada", un.unenrolled === 1);

  const reenroll = bulkRoster.importRosterCsv({ actorId: teacher.id, courseId: course.id, csvText: `correo,accion\n${student2.email},matricular` });
  check("Re-matrícula reactiva la baja (sin duplicar fila)", reenroll.enrolled === 1);
  check("Roster final: 2 activos", courses.listCourseStudents(course.id).length === 2);

  const rosterExport = bulkRoster.exportRosterCsv(course.id);
  check("Export de roster con progreso", rosterExport.includes(student.email) && rosterExport.includes("progreso"));

  console.log("\n— Estadísticas");
  progress.textHeartbeat({ courseId: course.id, studentId: student.id, itemId: lectura.id });
  const s = stats.courseStats(course.id);
  check("Matriculados 2, iniciado 1", s.enrolled === 2 && s.started === 1, JSON.stringify({ e: s.enrolled, st: s.started }));
  check("Cubetas suman matriculados", s.progressBuckets.reduce((a, b) => a + b.count, 0) === 2);
  check("Completitud por lección presente", s.itemCompletion.some((i) => i.itemId === lectura.id && i.completedCount === 1));
  check("Examen en stats sin intentos (avg null)", s.exams.length === 1 && s.exams[0].avgPercent === null);

  console.log(failures === 0 ? "\n✅ TODO PASÓ (F5)" : `\n❌ ${failures} fallas`);
  // No dejar la campana de las cuentas demo llena de avisos de prueba
  cleanupSmokeNotifications([course.id]);
  if (failures === 0) removeDemoCourses([TITLE], teacher.id);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
