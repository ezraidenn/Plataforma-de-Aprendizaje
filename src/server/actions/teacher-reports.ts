"use server";

import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { parseCohortFilter } from "@/server/services/cohorts";
import {
  studentDetail,
  matrixToCsv,
  type MatrixFilter,
} from "@/server/services/reports";

// ─── Drill-down por alumno (Sheet lateral de /teach/reports) ─────────────────

export type StudentDetailAttempt = {
  attemptId: string;
  attemptNumber: number;
  status: "in_progress" | "submitted" | "graded";
  finalScore: number | null;
  maxScore: number | null;
  submittedAt: number | null;
};

export type StudentDetailSubmission = {
  submissionId: string;
  status: "submitted" | "graded" | "returned";
  score: number | null;
  isLate: boolean;
  submittedAt: number;
};

export type StudentDetailItem = {
  itemId: string;
  title: string;
  kind: "folder" | "document" | "video" | "text" | "exam" | "assignment" | "resource" | "link";
  required: boolean;
  status: "locked" | "available" | "in_progress" | "completed";
  percent: number;
  totalSeconds: number;
  completedAt: number | null;
  /** Solo exámenes */
  attempts?: StudentDetailAttempt[];
  /** Solo tareas (null = sin entrega) */
  submission?: StudentDetailSubmission | null;
};

export type StudentDetailResult =
  | { ok: true; items: StudentDetailItem[] }
  | { error: string };

export async function studentDetailAction(
  courseId: string,
  studentId: string
): Promise<StudentDetailResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  try {
    const detail = studentDetail(courseId, studentId);
    if (!detail) return { error: "Este estudiante no está matriculado en el curso" };

    return {
      ok: true,
      items: detail.map((item) => ({
        itemId: item.itemId,
        title: item.title,
        kind: item.kind,
        required: item.required,
        status: item.status,
        percent: item.percent,
        totalSeconds: item.totalSeconds,
        completedAt: item.completedAt,
        attempts: "attempts" in item ? item.attempts : undefined,
        submission: "submission" in item ? item.submission : undefined,
      })),
    };
  } catch {
    return { error: "No se pudo cargar el detalle. Intenta de nuevo." };
  }
}

// ─── Export CSV (exporta el filtro actual, DISENO-UX §2.11) ──────────────────

export type ExportMatrixResult = { ok: true; csv: string } | { error: string };

export async function exportMatrixCsvAction(
  courseId: string,
  opts: { search?: string; filter?: MatrixFilter; grupo?: string }
): Promise<ExportMatrixResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  try {
    // Mismo filtro de grupo que la tabla en pantalla (`?grupo=`)
    const { grupo, ...rest } = opts;
    return { ok: true, csv: matrixToCsv(courseId, { ...rest, cohort: parseCohortFilter(grupo) }) };
  } catch {
    return { error: "No se pudo generar el CSV. Intenta de nuevo." };
  }
}
