import "server-only";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import {
  enrollments,
  courses,
  notifications,
  exams as examsTable,
} from "@/server/db/schema";
import { linearOrder } from "./tree";
import { getProgressMap } from "./progress";
import { listAttempts, computeFinalScorePercent } from "./exam-scoring";
import { enqueueJob } from "@/server/jobs/queue";

// ─── Tipos de reglas ─────────────────────────────────────────────────────────

export type Condition =
  | { type: "viewing_completion"; min_percent: number }
  | { type: "exam_average"; min_percent: number; scope: "all" | string[] }
  | { type: "exam_specific"; item_id: string; min_percent: number }
  | { type: "all_items_completed" };

export type RuleGroup = { op: "AND" | "OR"; conditions: (Condition | RuleGroup)[] };

export const DEFAULT_RULES: RuleGroup = {
  op: "AND",
  conditions: [{ type: "all_items_completed" }],
};

export type ConditionResult = {
  condition: Condition;
  passed: boolean;
  /** Valor alcanzado (%) o null si aún no evaluable (p. ej. examen sin intento) */
  value: number | null;
  label: string;
};

export type EvaluationResult = {
  passed: boolean;
  results: ConditionResult[];
};

// ─── Contexto de evaluación ──────────────────────────────────────────────────

type EvalContext = {
  courseId: string;
  studentId: string;
  /** % de ítems de contenido (document/video/text) requeridos completados */
  viewingPercent: number;
  /** examItemId -> { title, percent | null (sin intento calificado) } */
  examScores: Map<string, { title: string; percent: number | null }>;
  /** Todos los ítems requeridos completados */
  allCompleted: boolean;
};

function buildContext(enrollmentId: string): EvalContext | null {
  const enrollment = db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get();
  if (!enrollment) return null;

  const order = linearOrder(enrollment.courseId).filter((i) => i.visible);
  const required = order.filter((i) => i.requiredForCompletion);
  const progress = getProgressMap(enrollmentId);

  const viewingItems = required.filter((i) =>
    ["document", "video", "text"].includes(i.kind)
  );
  const viewingDone = viewingItems.filter((i) => progress.get(i.id)?.status === "completed").length;
  const viewingPercent =
    viewingItems.length === 0 ? 100 : Math.round((viewingDone / viewingItems.length) * 100);

  const allCompleted = required.every((i) => progress.get(i.id)?.status === "completed");

  const examScores = new Map<string, { title: string; percent: number | null }>();
  const examItems = order.filter((i) => i.kind === "exam");
  for (const item of examItems) {
    const exam = db.select().from(examsTable).where(eq(examsTable.itemId, item.id)).get();
    if (!exam) continue;
    const attempts = listAttempts(item.id, enrollment.studentId, enrollment.id);
    const percent = computeFinalScorePercent(exam, attempts);
    examScores.set(item.id, {
      title: item.title,
      percent: percent === null ? null : Math.round(percent * 10) / 10,
    });
  }

  return {
    courseId: enrollment.courseId,
    studentId: enrollment.studentId,
    viewingPercent,
    examScores,
    allCompleted,
  };
}

// ─── Evaluación ──────────────────────────────────────────────────────────────

function evalCondition(cond: Condition, ctx: EvalContext): ConditionResult {
  switch (cond.type) {
    case "viewing_completion": {
      const passed = ctx.viewingPercent >= cond.min_percent;
      return {
        condition: cond,
        passed,
        value: ctx.viewingPercent,
        label: `Ver el contenido (mínimo ${cond.min_percent}%)`,
      };
    }
    case "exam_average": {
      const ids =
        cond.scope === "all" ? [...ctx.examScores.keys()] : cond.scope.filter((id) => ctx.examScores.has(id));
      if (ids.length === 0) {
        return { condition: cond, passed: true, value: 100, label: "Promedio de exámenes (sin exámenes)" };
      }
      const scores = ids.map((id) => ctx.examScores.get(id)!.percent);
      if (scores.some((s) => s === null)) {
        return {
          condition: cond,
          passed: false,
          value: null,
          label: `Promedio de exámenes (mínimo ${cond.min_percent}%)`,
        };
      }
      const avg = (scores as number[]).reduce((a, b) => a + b, 0) / scores.length;
      return {
        condition: cond,
        passed: avg >= cond.min_percent,
        value: Math.round(avg * 10) / 10,
        label: `Promedio de exámenes (mínimo ${cond.min_percent}%)`,
      };
    }
    case "exam_specific": {
      const entry = ctx.examScores.get(cond.item_id);
      const title = entry?.title ?? "Examen";
      if (!entry || entry.percent === null) {
        return {
          condition: cond,
          passed: false,
          value: null,
          label: `${title} (mínimo ${cond.min_percent}%)`,
        };
      }
      return {
        condition: cond,
        passed: entry.percent >= cond.min_percent,
        value: entry.percent,
        label: `${title} (mínimo ${cond.min_percent}%)`,
      };
    }
    case "all_items_completed":
      return {
        condition: cond,
        passed: ctx.allCompleted,
        value: ctx.allCompleted ? 100 : null,
        label: "Completar todo el contenido requerido",
      };
  }
}

function isGroup(node: Condition | RuleGroup): node is RuleGroup {
  return "op" in node;
}

function evalNode(node: Condition | RuleGroup, ctx: EvalContext, out: ConditionResult[]): boolean {
  if (isGroup(node)) {
    const results = node.conditions.map((c) => evalNode(c, ctx, out));
    return node.op === "AND" ? results.every(Boolean) : results.some(Boolean);
  }
  const result = evalCondition(node, ctx);
  out.push(result);
  return result.passed;
}

export function getCourseRules(courseId: string): RuleGroup {
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  const rules = course?.completionRules as RuleGroup | null;
  return rules && Array.isArray(rules.conditions) && rules.conditions.length > 0
    ? rules
    : DEFAULT_RULES;
}

/** Evaluación de solo lectura (para mostrar el desglose "te falta..."). */
export function evaluateForDisplay(enrollmentId: string): EvaluationResult | null {
  const ctx = buildContext(enrollmentId);
  if (!ctx) return null;
  const rules = getCourseRules(ctx.courseId);
  const results: ConditionResult[] = [];
  const passed = evalNode(rules, ctx, results);
  return { passed, results };
}

/**
 * Evaluación por evento (ítem completado / score publicado). Idempotente:
 * si pasa y el enrollment no estaba completado, lo marca y notifica a
 * maestro y estudiante. NUNCA des-aprueba.
 */
export function evaluateEnrollment(enrollmentId: string): EvaluationResult | null {
  const evaluation = evaluateForDisplay(enrollmentId);
  if (!evaluation?.passed) return evaluation;

  const enrollment = db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get();
  if (!enrollment || enrollment.status === "completed") return evaluation;

  const course = db.select().from(courses).where(eq(courses.id, enrollment.courseId)).get();
  if (!course) return evaluation;

  const now = new Date();
  db.transaction(() => {
    // Revalidar dentro de la transacción (idempotencia ante eventos concurrentes)
    const fresh = db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get();
    if (!fresh || fresh.status === "completed") return;

    db.update(enrollments)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(enrollments.id, enrollmentId))
      .run();

    const payload = {
      courseId: course.id,
      courseTitle: course.title,
      studentId: enrollment.studentId,
      enrollmentId,
    };
    // createdAt explícito (ms), como notify(): el default de la columna redondea
    // al segundo y desordena la campana
    const createdAt = new Date();
    db.insert(notifications)
      .values([
        { id: nanoid(), userId: course.ownerId, type: "course_completed", payload, createdAt },
        { id: nanoid(), userId: enrollment.studentId, type: "course_completed", payload, createdAt },
      ])
      .run();
  });

  // Certificado (si el curso tiene plantilla): lo genera el worker en segundo plano
  if (course.certificateTemplateId) {
    enqueueJob("generate_certificate", { enrollmentId });
  }

  return evaluation;
}

/** Re-evalúa a todos los matriculados activos (al cambiar las reglas). */
export function reevaluateCourse(courseId: string) {
  const rows = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.status, "active")))
    .all();
  for (const row of rows) evaluateEnrollment(row.id);
}
