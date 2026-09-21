import "server-only";
import { cohortCondition, type CohortFilter } from "./cohorts";
import { latestCycleOnly } from "./enrollment-scope";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { enrollments, itemProgress, examAttempts } from "@/server/db/schema";
import { linearOrder } from "./tree";
import { getExam, examMaxScore } from "./exams";
import { computeFinalScorePercent, listAttempts } from "./exam-scoring";

/**
 * Estadísticas de curso para el maestro. Formas según buenas prácticas de visualización:
 * - KPIs = stat tiles (números, no gráficas)
 * - Completitud por lección = barras horizontales de UNA medida (un solo matiz;
 *   la identidad de la lección la dan la etiqueta + icono de tipo, no el color)
 * - Distribución de avance = histograma de 5 cubetas (mismo matiz; la cubeta
 *   "100%" puede ir en verde ÉXITO con etiqueta — estado, no serie)
 * - Exámenes = barras de promedio con línea de referencia en la calificación
 *   mínima
 */

export type CourseStats = {
  enrolled: number;
  started: number;
  completed: number;
  completionRate: number; // %
  avgProgress: number; // %
  avgTotalSeconds: number;
  /** Cubetas 0-24, 25-49, 50-74, 75-99, 100 */
  progressBuckets: { label: string; count: number; isComplete: boolean }[];
  /** % de matriculados que completaron cada lección requerida (orden DFS) */
  itemCompletion: {
    itemId: string;
    title: string;
    kind: string;
    completedCount: number;
    percent: number;
  }[];
  exams: {
    itemId: string;
    title: string;
    avgPercent: number | null;
    passRate: number | null; // % de quienes tienen score que aprueban
    passScore: number | null;
    attemptsCount: number;
    studentsWithScore: number;
    maxScore: number;
  }[];
};

export function courseStats(courseId: string, opts: { cohort?: CohortFilter } = {}): CourseStats {
  // Ciclo vigente de cada alumno, sin bajas y respetando el filtro de grupo
  const cohortCond = cohortCondition(opts.cohort ?? { kind: "default" });
  const scope = and(
    eq(enrollments.courseId, courseId),
    sql`${enrollments.status} != 'dropped'`,
    latestCycleOnly,
    ...(cohortCond ? [cohortCond] : [])
  );
  const active = db
    .select({ id: enrollments.id, studentId: enrollments.studentId, status: enrollments.status })
    .from(enrollments)
    .where(scope)
    .all();

  const enrolled = active.length;
  const completedEnrollments = active.filter((e) => e.status === "completed").length;

  const items = linearOrder(courseId).filter((i) => i.visible && i.requiredForCompletion);
  const requiredCount = items.length;

  // Progreso por matrícula en una sola consulta
  const progressRows = enrolled
    ? db
        .select({
          enrollmentId: itemProgress.enrollmentId,
          itemId: itemProgress.itemId,
          status: itemProgress.status,
          totalSeconds: itemProgress.totalSeconds,
        })
        .from(itemProgress)
        .innerJoin(enrollments, eq(itemProgress.enrollmentId, enrollments.id))
        .where(scope)
        .all()
    : [];

  const byEnrollment = new Map<string, { completed: Set<string>; seconds: number; any: boolean }>();
  for (const e of active) byEnrollment.set(e.id, { completed: new Set(), seconds: 0, any: false });
  const requiredIds = new Set(items.map((i) => i.id));
  for (const row of progressRows) {
    const entry = byEnrollment.get(row.enrollmentId);
    if (!entry) continue;
    entry.any = true;
    entry.seconds += row.totalSeconds;
    if (row.status === "completed" && requiredIds.has(row.itemId)) entry.completed.add(row.itemId);
  }

  const percents = [...byEnrollment.values()].map((e) =>
    requiredCount === 0 ? 0 : Math.round((e.completed.size / requiredCount) * 100)
  );
  const started = [...byEnrollment.values()].filter((e) => e.any).length;
  const avgProgress = enrolled ? Math.round(percents.reduce((a, b) => a + b, 0) / enrolled) : 0;
  const avgTotalSeconds = enrolled
    ? Math.round([...byEnrollment.values()].reduce((a, e) => a + e.seconds, 0) / enrolled)
    : 0;

  const buckets = [
    { label: "0–24%", min: 0, max: 24, isComplete: false },
    { label: "25–49%", min: 25, max: 49, isComplete: false },
    { label: "50–74%", min: 50, max: 74, isComplete: false },
    { label: "75–99%", min: 75, max: 99, isComplete: false },
    { label: "100%", min: 100, max: 100, isComplete: true },
  ].map((b) => ({
    label: b.label,
    isComplete: b.isComplete,
    count: percents.filter((p) => p >= b.min && p <= b.max).length,
  }));

  const itemCompletion = items.map((item) => {
    const count = [...byEnrollment.values()].filter((e) => e.completed.has(item.id)).length;
    return {
      itemId: item.id,
      title: item.title,
      kind: item.kind,
      completedCount: count,
      percent: enrolled ? Math.round((count / enrolled) * 100) : 0,
    };
  });

  // Exámenes: TODOS los visibles (también los opcionales — el maestro quiere
  // ver sus promedios aunque no cuenten para el 100%)
  const exams = linearOrder(courseId)
    .filter((i) => i.visible && i.kind === "exam")
    .map((item) => {
      const exam = getExam(item.id)!;
      const scores: number[] = [];
      for (const e of active) {
        const pct = computeFinalScorePercent(exam, listAttempts(item.id, e.studentId, e.id));
        if (pct !== null) scores.push(pct);
      }
      const attemptsCount =
        db
          .select({ n: sql<number>`COUNT(*)` })
          .from(examAttempts)
          .where(and(eq(examAttempts.examItemId, item.id), sql`${examAttempts.status} != 'in_progress'`))
          .get()?.n ?? 0;
      const avg = scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null;
      const passRate =
        scores.length && exam.passScore !== null
          ? Math.round((scores.filter((s) => s >= exam.passScore!).length / scores.length) * 100)
          : null;
      return {
        itemId: item.id,
        title: item.title,
        avgPercent: avg,
        passRate,
        passScore: exam.passScore,
        attemptsCount,
        studentsWithScore: scores.length,
        maxScore: examMaxScore(item.id),
      };
    });

  return {
    enrolled,
    started,
    completed: completedEnrollments,
    completionRate: enrolled ? Math.round((completedEnrollments / enrolled) * 100) : 0,
    avgProgress,
    avgTotalSeconds,
    progressBuckets: buckets,
    itemCompletion,
    exams,
  };
}
