import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { exams, examAttempts } from "@/server/db/schema";
import { currentEnrollmentIdForItem } from "./enrollment-scope";

export type Exam = typeof exams.$inferSelect;
export type ExamAttempt = typeof examAttempts.$inferSelect;

/**
 * Intentos del alumno en un examen, dentro de UNA matrícula: la indicada o, si
 * no se indica, la del ciclo vigente. Así los intentos de un ciclo anterior no
 * cuentan contra el límite del ciclo nuevo.
 */
export function listAttempts(
  examItemId: string,
  studentId: string,
  enrollmentId?: string
): ExamAttempt[] {
  const scope = enrollmentId ?? currentEnrollmentIdForItem(examItemId, studentId);
  // Sin matrícula (p. ej. vista previa del maestro): no hay intentos que contar
  if (!scope) return [];
  return db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.examItemId, examItemId), eq(examAttempts.enrollmentId, scope)))
    .orderBy(asc(examAttempts.attemptNumber))
    .all();
}

/** % final del examen según la política de intentos (best/last/average). */
export function computeFinalScorePercent(exam: Exam, attempts: ExamAttempt[]): number | null {
  const graded = attempts.filter((a) => a.status === "graded" && a.finalScore !== null);
  if (graded.length === 0) return null;
  const pct = (a: ExamAttempt) =>
    a.maxScoreSnapshot && a.maxScoreSnapshot > 0
      ? ((a.finalScore ?? 0) / a.maxScoreSnapshot) * 100
      : 0;
  switch (exam.attemptScorePolicy) {
    case "best":
      return Math.max(...graded.map(pct));
    case "last":
      return pct(graded[graded.length - 1]);
    case "average":
      return graded.reduce((s, a) => s + pct(a), 0) / graded.length;
  }
}
