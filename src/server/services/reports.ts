import "server-only";
import { getEnrollment } from "./progress";
import { latestCycleOnly } from "./enrollment-scope";
import { cohortCondition, type CohortFilter } from "./cohorts";
import { matchesSearch } from "@/server/db/search";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { enrollments, users, itemProgress, assignmentSubmissions } from "@/server/db/schema";
import { courses } from "@/server/db/schema";
import { linearOrder, getItem, type CourseItem } from "./tree";
import { getExam, listAttempts, computeFinalScorePercent } from "./exams";

// ─── Matriz alumnos × ítems (DISENO-UX §2.11) ────────────────────────────────

export type CellState =
  | "completed" // ● verde
  | "in_progress" // ◐ ámbar
  | "available" // ○ gris
  | "locked" // candado
  | "overdue"; // rojo: fecha pasada sin completar

export type MatrixCell = {
  state: CellState;
  percent: number;
  /** Solo exámenes: aprobado según passScore (Completado ≠ Aprobado) */
  examPassed?: boolean;
  examScorePercent?: number | null;
};

export type MatrixColumn = {
  itemId: string;
  title: string;
  kind: CourseItem["kind"];
  folderTitle: string | null;
};

export type MatrixRow = {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  email: string;
  coursePercent: number;
  courseCompleted: boolean;
  atRisk: boolean;
  cells: MatrixCell[];
};

export type MatrixFilter = "all" | "at_risk" | "completed";

const RISK_WINDOW_MS = 7 * 24 * 3600_000;

export function courseMatrix(
  courseId: string,
  opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    filter?: MatrixFilter;
    cohort?: CohortFilter;
  } = {}
) {
  const cohortCond = cohortCondition(opts.cohort ?? { kind: "default" });
  const page = Math.max(1, opts.page ?? 1);
  // La pantalla pide 50; las exportaciones piden todo. El tope alto solo evita
  // que un pageSize disparatado se lleve la memoria (antes cortaba a 100 y el
  // CSV de Reportes se quedaba en los primeros 100 alumnos sin avisar).
  const pageSize = Math.min(opts.pageSize ?? 50, 100_000);
  const now = Date.now();

  const courseEnforces =
    db.select({ e: courses.enforceSequence }).from(courses).where(eq(courses.id, courseId)).get()
      ?.e ?? true;

  const items = linearOrder(courseId).filter((i) => i.visible && i.requiredForCompletion);

  // Título de la carpeta contenedora (para agrupar encabezados de columna)
  const folderTitles = new Map<string, string>();
  for (const item of items) {
    if (item.parentId && !folderTitles.has(item.parentId)) {
      const parent = getItem(item.parentId);
      if (parent?.kind === "folder") folderTitles.set(item.parentId, parent.title);
    }
  }

  const columns: MatrixColumn[] = items.map((i) => ({
    itemId: i.id,
    title: i.title,
    kind: i.kind,
    folderTitle: i.parentId ? (folderTitles.get(i.parentId) ?? null) : null,
  }));

  // Deadlines por ítem para "vencido"
  const deadlines = new Map<string, number>();
  for (const item of items) {
    if (item.kind === "exam") {
      const exam = getExam(item.id);
      if (exam?.closesAt) deadlines.set(item.id, exam.closesAt.getTime());
    }
  }

  const term = opts.search?.trim();
  const whereBase = and(
    eq(enrollments.courseId, courseId),
    sql`${enrollments.status} != 'dropped'`,
    latestCycleOnly,
    ...(cohortCond ? [cohortCond] : []),
    term
      ? matchesSearch(term, [users.fullName, users.email])!
      : sql`1=1`
  );

  const enrolled = db
    .select({
      enrollmentId: enrollments.id,
      status: enrollments.status,
      studentId: users.id,
      studentName: users.fullName,
      email: users.email,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(whereBase)
    .orderBy(users.fullName)
    .all();

  const requiredCount = items.length;
  const rows: MatrixRow[] = enrolled.map((e) => {
    const progress = new Map(
      db
        .select()
        .from(itemProgress)
        .where(eq(itemProgress.enrollmentId, e.enrollmentId))
        .all()
        .map((p) => [p.itemId, p])
    );

    let blocked = false;
    let completedCount = 0;
    const cells: MatrixCell[] = items.map((item) => {
      const p = progress.get(item.id);
      const isCompleted = p?.status === "completed";
      if (isCompleted) completedCount++;

      let state: CellState;
      if (isCompleted) state = "completed";
      else if (blocked) state = "locked";
      else if (p?.status === "in_progress") state = "in_progress";
      else state = "available";

      const deadline = deadlines.get(item.id);
      if (!isCompleted && deadline && deadline < now) state = "overdue";

      // Secuencia EFECTIVA (misma regla que el gating real): un ítem
      // incompleto solo bloquea lo que sigue si su secuencia lo exige
      const mustComplete =
        item.sequenceMode === "required" ||
        (item.sequenceMode === "inherit" && courseEnforces);
      if (!isCompleted && mustComplete) blocked = true;

      const cell: MatrixCell = { state, percent: p?.percent ?? 0 };
      if (item.kind === "exam") {
        const exam = getExam(item.id);
        if (exam) {
          const pct = computeFinalScorePercent(exam, listAttempts(item.id, e.studentId, e.enrollmentId));
          cell.examScorePercent = pct === null ? null : Math.round(pct * 10) / 10;
          cell.examPassed =
            pct !== null && (exam.passScore === null || pct >= exam.passScore);
        }
      }
      return cell;
    });

    const coursePercent =
      requiredCount === 0 ? 0 : Math.round((completedCount / requiredCount) * 100);
    const upcomingDeadline = [...deadlines.values()].some(
      (d) => d > now && d < now + RISK_WINDOW_MS
    );
    const overdue = cells.some((c) => c.state === "overdue");
    const atRisk = overdue || (coursePercent < 50 && upcomingDeadline);

    return {
      enrollmentId: e.enrollmentId,
      studentId: e.studentId,
      studentName: e.studentName,
      email: e.email,
      coursePercent,
      courseCompleted: e.status === "completed",
      atRisk,
      cells,
    };
  });

  const filtered =
    opts.filter === "at_risk"
      ? rows.filter((r) => r.atRisk)
      : opts.filter === "completed"
        ? rows.filter((r) => r.courseCompleted)
        : rows;

  const total = filtered.length;
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return { columns, rows: pageRows, total, page, pageSize };
}

// ─── Drill-down por alumno ───────────────────────────────────────────────────

export function studentDetail(courseId: string, studentId: string) {
  // Ciclo vigente: el detalle muestra el avance actual, no el de un ciclo viejo
  const enrollment = getEnrollment(courseId, studentId);
  if (!enrollment) return null;

  const items = linearOrder(courseId).filter((i) => i.visible);
  const progress = new Map(
    db
      .select()
      .from(itemProgress)
      .where(eq(itemProgress.enrollmentId, enrollment.id))
      .all()
      .map((p) => [p.itemId, p])
  );

  return items.map((item) => {
    const p = progress.get(item.id);
    const base = {
      itemId: item.id,
      title: item.title,
      kind: item.kind,
      required: item.requiredForCompletion,
      status: p?.status ?? "available",
      percent: p?.percent ?? 0,
      totalSeconds: p?.totalSeconds ?? 0,
      completedAt: p?.completedAt?.getTime() ?? null,
    };

    if (item.kind === "exam") {
      const attempts = listAttempts(item.id, studentId, enrollment.id).map((a) => ({
        attemptNumber: a.attemptNumber,
        status: a.status,
        finalScore: a.finalScore,
        maxScore: a.maxScoreSnapshot,
        submittedAt: a.submittedAt?.getTime() ?? null,
      }));
      return { ...base, attempts };
    }
    if (item.kind === "assignment") {
      const submission = db
        .select()
        .from(assignmentSubmissions)
        .where(
          and(
            eq(assignmentSubmissions.itemId, item.id),
            eq(assignmentSubmissions.enrollmentId, enrollment.id)
          )
        )
        .orderBy(sql`${assignmentSubmissions.submittedAt} DESC`)
        .get();
      return {
        ...base,
        submission: submission
          ? {
              status: submission.status,
              score: submission.score,
              isLate: submission.isLate,
              submittedAt: submission.submittedAt.getTime(),
            }
          : null,
      };
    }
    return base;
  });
}

// ─── Export CSV ──────────────────────────────────────────────────────────────

function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CELL_LABEL: Record<CellState, string> = {
  completed: "Completado",
  in_progress: "En progreso",
  available: "Sin empezar",
  locked: "Bloqueado",
  overdue: "Vencido",
};

/** CSV de la matriz con el filtro actual (BOM UTF-8 para Excel). */
export function matrixToCsv(
  courseId: string,
  opts: { search?: string; filter?: MatrixFilter; cohort?: CohortFilter } = {}
): string {
  const { columns, rows } = courseMatrix(courseId, { ...opts, page: 1, pageSize: 100000 });

  const header = [
    "Estudiante",
    "Correo",
    "% Curso",
    "Estado del curso",
    ...columns.map((c) => c.title),
  ];
  const lines = [header.map(csvEscape).join(",")];

  for (const row of rows) {
    const cells = row.cells.map((cell, i) => {
      const col = columns[i];
      if (col.kind === "exam") {
        const score = cell.examScorePercent === null || cell.examScorePercent === undefined
          ? "sin intento"
          : `${cell.examScorePercent}%${cell.examPassed ? " aprobado" : " no aprobado"}`;
        return `${CELL_LABEL[cell.state]} (${score})`;
      }
      return cell.state === "completed" ? "Completado" : `${CELL_LABEL[cell.state]} (${cell.percent}%)`;
    });
    lines.push(
      [
        row.studentName,
        row.email,
        `${row.coursePercent}%`,
        row.courseCompleted ? "Aprobado" : row.atRisk ? "En riesgo" : "Activo",
        ...cells,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  return "﻿" + lines.join("\r\n");
}
