/**
 * Prueba end-to-end de Fase 4: pool aleatorio de preguntas, matriz de
 * reportes + CSV, importación de estudiantes por CSV y protecciones de admin.
 *
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/smoke-f4.ts
 */
import { cleanupSmokeNotifications, removeDemoCourses } from "./lib/smoke-cleanup";
import { eq, like } from "drizzle-orm";
import { db } from "../src/server/db";
import { users, courses as coursesTable, itemTexts } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import * as examsSvc from "../src/server/services/exams";
import * as reports from "../src/server/services/reports";
import * as csvImport from "../src/server/services/csv-import";
import * as admin from "../src/server/services/admin";

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
  const adminUser = db.select().from(users).where(eq(users.email, "admin@empresa.local")).get()!;
  const student = db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;

  // Limpieza de corridas anteriores
  const TITLE = "Curso demo F4 — Pool y reportes";
  for (const p of db.select().from(coursesTable).where(eq(coursesTable.title, TITLE)).all()) {
    courses.deleteCourse(p.id);
  }
  for (const u of db.select().from(users).where(like(users.email, "imp-%@empresa.local")).all()) {
    db.delete(users).where(eq(users.id, u.id)).run();
  }

  console.log("\n— Pool aleatorio: 5 preguntas en banco, 2 por intento");
  const course = courses.createCourse({ ownerId: teacher.id, title: TITLE });
  const lectura = tree.createItem({ courseId: course.id, parentId: null, kind: "text", title: "Intro" });
  db.update(itemTexts).set({ minReadSeconds: 0 }).where(eq(itemTexts.itemId, lectura.id)).run();

  const examen = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen pool" });
  const qIds: string[] = [];
  for (let i = 1; i <= 5; i++) {
    qIds.push(
      examsSvc.createQuestion(examen.id, {
        type: "true_false",
        promptMd: `Pregunta ${i}`,
        points: 2,
        options: [
          { textMd: "Verdadero", isCorrect: true },
          { textMd: "Falso", isCorrect: false },
        ],
      })
    );
  }
  examsSvc.updateExamSettings(examen.id, { drawCount: 2, maxAttempts: null });
  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [student.id], teacher.id);
  progress.textHeartbeat({ courseId: course.id, studentId: student.id, itemId: lectura.id });

  const attempt = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
  const drawn = attempt.questionOrder as string[];
  check("El intento sortea exactamente 2 preguntas", drawn.length === 2, `${drawn.length}`);
  check("Las sorteadas pertenecen al banco", drawn.every((id) => qIds.includes(id)));
  check("maxScore = 4 (2 preguntas × 2 pts), no 10", attempt.maxScoreSnapshot === 4, `${attempt.maxScoreSnapshot}`);

  // Responder bien SOLO las 2 sorteadas → 100%
  const all = examsSvc.listQuestions(examen.id);
  for (const qid of drawn) {
    const q = all.find((x) => x.id === qid)!;
    examsSvc.saveAnswer({
      studentId: student.id,
      attemptId: attempt.id,
      questionId: qid,
      selectedOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
    });
  }
  const sub = examsSvc.submitAttempt({ courseId: course.id, studentId: student.id, attemptId: attempt.id });
  check("Calificado solo sobre las sorteadas: 4/4", sub.finalScore === 4 && sub.status === "graded", JSON.stringify({ f: sub.finalScore }));
  const pct = examsSvc.computeFinalScorePercent(examsSvc.getExam(examen.id)!, examsSvc.listAttempts(examen.id, student.id));
  check("Porcentaje 100%", pct === 100, `${pct}`);

  // Variación entre intentos (con 10 intentos, la probabilidad de que todos
  // sorteen el mismo par es (1/10)^9 — si pasa, algo está mal)
  const seen = new Set<string>([...drawn].sort().join(","));
  for (let i = 0; i < 9; i++) {
    const a = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: examen.id });
    seen.add(([...(a.questionOrder as string[])].sort()).join(","));
    examsSvc.submitAttempt({ courseId: course.id, studentId: student.id, attemptId: a.id });
  }
  check("El sorteo varía entre intentos", seen.size > 1, `combinaciones=${seen.size}`);

  console.log("\n— Matriz de reportes");
  const matrix = reports.courseMatrix(course.id, {});
  check("Columnas = ítems requeridos (2)", matrix.columns.length === 2);
  check("Fila del estudiante presente", matrix.rows.some((r) => r.studentId === student.id));
  const row = matrix.rows.find((r) => r.studentId === student.id)!;
  check("Celda de examen con aprobado ✓", row.cells[1].examPassed === true && row.cells[1].examScorePercent === 100);
  check("Curso al 100%", row.coursePercent === 100);

  const detail = reports.studentDetail(course.id, student.id)!;
  const examDetail = detail.find((d) => d.kind === "exam") as { attempts?: unknown[] };
  check("Drill-down con intentos (10)", (examDetail.attempts?.length ?? 0) === 10, `${examDetail.attempts?.length}`);

  const csv = reports.matrixToCsv(course.id, {});
  check("CSV con BOM y encabezado", csv.startsWith("﻿") && csv.includes("Estudiante,Correo"));
  check("CSV incluye al estudiante", csv.includes(student.fullName));

  console.log("\n— Importación CSV");
  const csvText = [
    "nombre,correo,contrasena",
    "Import Uno,imp-uno@empresa.local,",
    "Import Dos,imp-dos@empresa.local,ClaveSegura99",
    `Duplicado,${student.email},`,
    "Sin Correo,noesuncorreo,",
    "Import Uno Bis,imp-uno@empresa.local,",
  ].join("\r\n");

  const validation = csvImport.validateStudentsCsv(csvText);
  check("Validación: 2 ok, 1 duplicado, 2 inválidos",
    validation.ok === 2 && validation.duplicates === 1 && validation.invalid === 2,
    JSON.stringify({ ok: validation.ok, d: validation.duplicates, i: validation.invalid }));

  const result = await csvImport.importStudents({
    csvText,
    createdBy: teacher.id,
    enrollCourseId: course.id,
  });
  check("Importados 2, omitidos 3", result.created === 2 && result.skipped === 3, JSON.stringify(result));
  check("Matriculados los 2 nuevos", result.enrolled === 2);
  check("Reporte incluye contraseña generada", /imp-uno@empresa\.local,[^,\r\n]+,Creado/.test(result.resultCsv));
  const created = db.select().from(users).where(eq(users.email, "imp-uno@empresa.local")).get();
  check("Usuario creado con rol student", created?.role === "student");

  console.log("\n— Protecciones de administración");
  let selfErr = "";
  try { admin.adminSetActive(adminUser.id, adminUser.id, false); } catch (e) { selfErr = (e as Error).message; }
  check("No puedes desactivarte a ti mismo", selfErr.includes("propia"));

  let lastAdminErr = "";
  try { admin.adminChangeRole(teacher.id, adminUser.id, "teacher"); } catch (e) { lastAdminErr = (e as Error).message; }
  check("Protegido el único admin", lastAdminErr.includes("único administrador"));

  const stats = admin.platformStats();
  check("Stats: usuarios y cursos > 0", stats.users.total > 0 && stats.courses.total > 0);
  check("Stats: tamaño de DB > 0", stats.dbSizeBytes > 0);

  const auditRows = admin.listAuditLog({ page: 1 });
  check("Auditoría registró la importación", auditRows.rows.some((r) => r.action === "import_csv"));

  console.log(failures === 0 ? "\n✅ TODO PASÓ (F4)" : `\n❌ ${failures} fallas`);
  // No dejar la campana de las cuentas demo llena de avisos de prueba
  cleanupSmokeNotifications([course.id]);
  if (failures === 0) removeDemoCourses([TITLE], teacher.id);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
