/**
 * Reglas de aprobación con Y / O contra el motor real: con Y hay que cumplir
 * todas las condiciones; con O basta una.
 *
 * Uso: pnpm smoke:rules
 */
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import { eq } from "drizzle-orm";
import { db } from "../src/server/db";
import { courses as coursesTable, enrollments, itemTexts, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import * as examsSvc from "../src/server/services/exams";
import { evaluateEnrollment, evaluateForDisplay, type Condition } from "../src/server/services/rules-engine";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const TITLE = "Curso demo — Reglas Y/O";

async function main() {
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
  const student = db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;

  for (const c of db.select().from(coursesTable).where(eq(coursesTable.title, TITLE)).all()) courses.deleteCourse(c.id);

  const course = courses.createCourse({ ownerId: teacher.id, title: TITLE });
  const lectura = tree.createItem({ courseId: course.id, parentId: null, kind: "text", title: "Lectura" });
  db.update(itemTexts).set({ minReadSeconds: 0 }).where(eq(itemTexts.itemId, lectura.id)).run();
  const examen = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen" });
  examsSvc.createQuestion(examen.id, {
    type: "single_choice",
    promptMd: "¿2 + 2?",
    points: 1,
    options: [
      { textMd: "4", isCorrect: true },
      { textMd: "5", isCorrect: false },
    ],
  });

  const conditions: Condition[] = [
    { type: "viewing_completion", min_percent: 100 },
    { type: "exam_average", min_percent: 80, scope: "all" },
  ];
  const setRules = (op: "AND" | "OR") =>
    db.update(coursesTable).set({ completionRules: { op, conditions } }).where(eq(coursesTable.id, course.id)).run();
  const statusOf = (enrollmentId: string) => db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get()!.status;

  setRules("AND");
  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [student.id], teacher.id);
  const enrollment = progress.getEnrollment(course.id, student.id)!;

  console.log("\n— Con Y (todas)");
  progress.textHeartbeat({ courseId: course.id, studentId: student.id, itemId: lectura.id });
  evaluateEnrollment(enrollment.id);
  const display = evaluateForDisplay(enrollment.id)!;
  check("El contenido llega a 100 %", display.results.some((r) => r.condition.type === "viewing_completion" && r.passed));
  check("Sin examen no aprueba", !display.passed && statusOf(enrollment.id) === "active", statusOf(enrollment.id));

  console.log("\n— Con O (al menos una)");
  setRules("OR");
  evaluateEnrollment(enrollment.id);
  check("Basta el contenido: aprueba", statusOf(enrollment.id) === "completed", statusOf(enrollment.id));

  cleanupSmokeNotifications([course.id]);
  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exit(1);
  }
  console.log("\n✅ REGLAS Y/O OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
