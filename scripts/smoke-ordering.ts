/**
 * Tipo «Ordenar pasos»: puntaje por pares consecutivos, barajado que nunca
 * deja el orden correcto y el flujo real (crear, responder, calificar).
 *
 * Uso: pnpm smoke:ordering
 */
import { orderingScore, shuffledOrder } from "../src/lib/ordering";
import { eq, like } from "drizzle-orm";
import { db } from "../src/server/db";
import { courses as coursesTable, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import { buildRunnerQuestions } from "../src/components/student/lesson-data";
import { EXAM_CSV_TEMPLATE, exportExamCsv, validateExamCsv } from "../src/server/services/exam-csv";
import { cleanupSmokeNotifications, removeDemoCourses } from "./lib/smoke-cleanup";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function pure() {
  console.log("\n— Puntaje por pares consecutivos");
  check("Todo en orden: 1", orderingScore([0, 1, 2, 3, 4]) === 1);
  check("Invertido: 0", orderingScore([4, 3, 2, 1, 0]) === 0);
  check("Un paso al final (4 pasos buenos seguidos): 3 de 4", orderingScore([1, 2, 3, 4, 0]) === 0.75, orderingScore([1, 2, 3, 4, 0]));
  check("Dos pasos vecinos intercambiados: 1 de 4", orderingScore([0, 2, 1, 3, 4]) === 0.25, orderingScore([0, 2, 1, 3, 4]));
  check("Dos pasos en orden: 1", orderingScore([0, 1]) === 1);
  check("Un solo paso o ninguno: 0", orderingScore([0]) === 0 && orderingScore([]) === 0);

  console.log("\n— Barajado");
  let neverIdentity = true;
  let allPresent = true;
  for (let n = 2; n <= 10; n++) {
    for (let k = 0; k < 200; k++) {
      const order = shuffledOrder(n);
      if (order.every((v, i) => v === i)) neverIdentity = false;
      if ([...order].sort((a, b) => a - b).some((v, i) => v !== i)) allPresent = false;
    }
  }
  check("Nunca deja el orden correcto (2 a 10 pasos, 200 veces cada uno)", neverIdentity);
  check("Siempre trae todos los pasos una vez", allPresent);
}

const PREFIX = "Curso demo — Ordenar pasos";
const STEPS = ["Jalar el seguro", "Apuntar a la base", "Presionar la palanca", "Barrer de lado a lado"];

function validation() {
  console.log("\n— Validación");
  const base = { type: "ordering" as const, promptMd: "Ordena el uso del extintor", points: 4 };
  const fails = (config: unknown) => {
    try {
      examsSvc.validateQuestion({ ...base, config });
      return false;
    } catch {
      return true;
    }
  };
  check("Rechaza menos de 3 pasos", fails({ steps: ["A", "B"] }));
  check("Rechaza más de 10 pasos", fails({ steps: Array.from({ length: 11 }, (_, i) => `Paso ${i}`) }));
  check("Rechaza pasos vacíos", fails({ steps: ["A", " ", "C"] }));
  check("Rechaza pasos repetidos", fails({ steps: ["A", "B", "a"] }));
  check("Acepta 4 pasos válidos", !fails({ steps: STEPS }));
}

function endToEnd() {
  console.log("\n— Flujo real");
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
  const student = db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;
  for (const c of db.select().from(coursesTable).where(like(coursesTable.title, `${PREFIX}%`)).all()) courses.deleteCourse(c.id);

  const course = courses.createCourse({ ownerId: teacher.id, title: PREFIX });
  const exam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen ordenar" });
  const qid = examsSvc.createQuestion(exam.id, { type: "ordering", promptMd: "Ordena el uso del extintor", points: 4, config: { steps: STEPS } });
  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [student.id], teacher.id);

  const attempt = examsSvc.startAttempt({ courseId: course.id, studentId: student.id, examItemId: exam.id });
  const rq = buildRunnerQuestions(attempt).find((q) => q.id === qid)!;
  check("Viaja con los 4 pasos", rq.ordering?.steps.length === 4);
  check("Viaja revuelto", rq.ordering!.steps.map((s) => s.text).join("|") !== STEPS.join("|"));
  check("Los tokens no son índices", rq.ordering!.steps.every((s) => !/^\d+$/.test(s.token)));
  check("No viaja la configuración", !("config" in rq));

  // El alumno deja el primer paso al final: 2 de 3 pares bien
  const tokenOf = (text: string) => rq.ordering!.steps.find((s) => s.text === text)!.token;
  const answer = [STEPS[1], STEPS[2], STEPS[3], STEPS[0]].map(tokenOf);
  examsSvc.saveAnswer({ studentId: student.id, attemptId: attempt.id, questionId: qid, answerText: JSON.stringify(answer) });
  const graded = examsSvc.submitAttempt({ courseId: course.id, studentId: student.id, attemptId: attempt.id });
  check("Califica por pares: 2 de 3 → 2.67 de 4", Math.abs((graded.finalScore ?? 0) - 2.67) < 0.01, graded.finalScore);

  console.log("\n— CSV");
  const csv = exportExamCsv(exam.id);
  check("La exportación trae el tipo «ordenar»", csv.includes("ordenar"));
  check("…y los pasos en orden, separados por |", csv.includes(STEPS.join(" | ")));
  const back = validateExamCsv(csv);
  const row = back.rows.find((r) => r.typeLabel === "Ordenar pasos");
  check("Al volver a subirlo, la fila es válida", row?.status === "ok", row);
  check("…con los mismos pasos", JSON.stringify((row as { input?: { config?: { steps?: string[] } } } | undefined)?.input?.config?.steps) === JSON.stringify(STEPS));
  const legacy = validateExamCsv("tipo,pregunta,puntos,opcion_1,opcion_2,correctas\r\nopcion_unica,¿2+2?,1,4,5,1");
  check("Un CSV viejo sin columna «pasos» sigue funcionando", legacy.ok === 1);
  const template = validateExamCsv(EXAM_CSV_TEMPLATE);
  check("La plantilla trae los 7 tipos y todas sus filas son válidas", template.ok === 7 && template.invalid === 0, { ok: template.ok, invalid: template.invalid });

  cleanupSmokeNotifications([course.id]);
  if (!failures) removeDemoCourses([PREFIX], teacher.id);
}

async function main() {
  pure();
  validation();
  endToEnd();

  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exit(1);
  }
  console.log("\n✅ ORDENAR PASOS OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
