"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import { getExam, listQuestions } from "@/server/services/exams";
import {
  EXAM_CSV_TEMPLATE,
  exportExamCsv,
  validateExamCsv,
  importExamCsv,
} from "@/server/services/exam-csv";
import {
  exportLessonsCsv,
  validateLessonsCsv,
  importLessonsCsv,
} from "@/server/services/bulk-lessons";
import {
  ROSTER_CSV_TEMPLATE,
  exportRosterCsv,
  validateRosterCsv,
  importRosterCsv,
} from "@/server/services/bulk-roster";
import { slugifyFilename } from "@/components/teach/csv-download";

// Acciones de operación masiva del maestro: examen (CSV), lecciones (CSV),
// matrícula (CSV). Cada operación tiene su trío export / validate / import.
// Nada se escribe hasta el paso de importación; la validación es solo lectura.

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export type CsvExportResult = { csv: string; filename: string } | { error: string };
export type CsvTemplateResult = { template: string };

// ─── Guards ──────────────────────────────────────────────────────────────────

type CourseContext = { userId: string; courseTitle: string };

/** El curso debe existir y pertenecer al maestro (admin ve todos). */
async function guardCourse(
  courseId: string
): Promise<{ error: string } | CourseContext> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  return { userId: user.id, courseTitle: course.title };
}

type ExamContext = { userId: string; courseId: string; examTitle: string };

/** El ítem debe ser un examen de un curso del maestro (ítem → curso → dueño). */
async function guardExamItem(
  itemId: string
): Promise<{ error: string } | ExamContext> {
  const user = await requireTeacher();
  const item = getItem(itemId);
  if (!item || item.kind !== "exam" || !getExam(itemId)) {
    return { error: "No encontramos este examen" };
  }
  const course = getOwnedCourse(item.courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  return { userId: user.id, courseId: item.courseId, examTitle: item.title };
}

// ═══ Examen: import/export CSV ═══════════════════════════════════════════════

export type ExamCsvPreviewRow = {
  line: number;
  status: "ok" | "invalid";
  message: string;
  preview: string;
  typeLabel: string;
};

export type ExamImportMode = "replace" | "append";

/** Plantilla de examen (el cliente la baja como Blob). */
export async function examCsvTemplateAction(): Promise<CsvTemplateResult> {
  await requireTeacher();
  return { template: EXAM_CSV_TEMPLATE };
}

export async function exportExamCsvAction(itemId: string): Promise<CsvExportResult> {
  const guard = await guardExamItem(itemId);
  if ("error" in guard) return guard;

  try {
    return {
      csv: exportExamCsv(itemId),
      filename: `examen-${slugifyFilename(guard.examTitle)}.csv`,
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo exportar el examen. Intenta de nuevo.") };
  }
}

export type ValidateExamCsvResult =
  | {
      ok: true;
      rows: ExamCsvPreviewRow[];
      okCount: number;
      invalid: number;
      /** Preguntas que hay HOY en el examen (para el aviso de "reemplazar"). */
      currentCount: number;
    }
  | { error: string };

export async function validateExamCsvAction(
  itemId: string,
  csvText: string
): Promise<ValidateExamCsvResult> {
  const guard = await guardExamItem(itemId);
  if ("error" in guard) return guard;
  if (!csvText || !csvText.trim()) return { error: "El archivo está vacío" };

  try {
    const { rows, ok, invalid } = validateExamCsv(csvText);
    return {
      ok: true,
      // Solo lo que la vista previa necesita (sin el input interno de cada fila)
      rows: rows.map(({ line, status, message, preview, typeLabel }) => ({
        line,
        status,
        message,
        preview,
        typeLabel,
      })),
      okCount: ok,
      invalid,
      currentCount: listQuestions(itemId).length,
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo leer el archivo. Revisa el formato.") };
  }
}

export type ImportExamCsvResult =
  | { ok: true; imported: number; skipped: number }
  | { error: string };

export async function importExamCsvAction(input: {
  itemId: string;
  csvText: string;
  mode: ExamImportMode;
}): Promise<ImportExamCsvResult> {
  const guard = await guardExamItem(input.itemId);
  if ("error" in guard) return guard;
  if (!input.csvText || !input.csvText.trim()) return { error: "El archivo está vacío" };
  if (input.mode !== "replace" && input.mode !== "append") {
    return { error: "Modo de importación desconocido" };
  }

  try {
    const result = importExamCsv({
      actorId: guard.userId,
      examItemId: input.itemId,
      csvText: input.csvText,
      mode: input.mode,
    });
    revalidatePath(`/teach/courses/${guard.courseId}/items/${input.itemId}/edit`);
    revalidatePath(`/teach/courses/${guard.courseId}/content`);
    return { ok: true, ...result };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo completar la importación. Intenta de nuevo.") };
  }
}

// ═══ Lecciones: edición masiva por CSV ═══════════════════════════════════════

export type LessonsCsvPreviewRow = {
  line: number;
  itemId: string;
  title: string;
  status: "ok" | "unchanged" | "invalid";
  message: string;
  changes: string[];
};

export async function exportLessonsCsvAction(courseId: string): Promise<CsvExportResult> {
  const guard = await guardCourse(courseId);
  if ("error" in guard) return guard;

  try {
    return {
      csv: exportLessonsCsv(courseId),
      filename: `lecciones-${slugifyFilename(guard.courseTitle)}.csv`,
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudieron exportar las lecciones. Intenta de nuevo.") };
  }
}

export type ValidateLessonsCsvResult =
  | {
      ok: true;
      rows: LessonsCsvPreviewRow[];
      okCount: number;
      unchanged: number;
      invalid: number;
    }
  | { error: string };

export async function validateLessonsCsvAction(
  courseId: string,
  csvText: string
): Promise<ValidateLessonsCsvResult> {
  const guard = await guardCourse(courseId);
  if ("error" in guard) return guard;
  if (!csvText || !csvText.trim()) return { error: "El archivo está vacío" };

  try {
    const result = validateLessonsCsv(courseId, csvText);
    return {
      ok: true,
      rows: result.rows.map(({ line, itemId, title, status, message, changes }) => ({
        line,
        itemId,
        title,
        status,
        message,
        changes,
      })),
      okCount: result.ok,
      unchanged: result.unchanged,
      invalid: result.invalid,
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo leer el archivo. Revisa el formato.") };
  }
}

export type ImportLessonsCsvResult = { ok: true; updated: number } | { error: string };

export async function importLessonsCsvAction(input: {
  courseId: string;
  csvText: string;
}): Promise<ImportLessonsCsvResult> {
  const guard = await guardCourse(input.courseId);
  if ("error" in guard) return guard;
  if (!input.csvText || !input.csvText.trim()) return { error: "El archivo está vacío" };

  try {
    const result = importLessonsCsv({
      actorId: guard.userId,
      courseId: input.courseId,
      csvText: input.csvText,
    });
    revalidatePath(`/teach/courses/${input.courseId}/content`);
    revalidatePath(`/teach/courses/${input.courseId}`);
    return { ok: true, updated: result.updated };
  } catch (err) {
    return { error: errorMessage(err, "No se pudieron aplicar los cambios. Intenta de nuevo.") };
  }
}

// ═══ Matrícula: gestión masiva por CSV ═══════════════════════════════════════

export type RosterCsvPreviewRow = {
  line: number;
  email: string;
  action: "enroll" | "unenroll";
  status: "ok" | "noop" | "invalid";
  message: string;
};

/** Plantilla vacía de matrícula (correo + accion). */
export async function rosterCsvTemplateAction(): Promise<CsvTemplateResult> {
  await requireTeacher();
  return { template: ROSTER_CSV_TEMPLATE };
}

/** Lista actual con progreso: sirve de reporte y de plantilla (columna accion). */
export async function exportRosterCsvAction(courseId: string): Promise<CsvExportResult> {
  const guard = await guardCourse(courseId);
  if ("error" in guard) return guard;

  try {
    return {
      csv: exportRosterCsv(courseId),
      filename: `matricula-${slugifyFilename(guard.courseTitle)}.csv`,
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo exportar la lista. Intenta de nuevo.") };
  }
}

export type ValidateRosterCsvResult =
  | {
      ok: true;
      rows: RosterCsvPreviewRow[];
      toEnroll: number;
      toUnenroll: number;
      noop: number;
      invalid: number;
    }
  | { error: string };

export async function validateRosterCsvAction(
  courseId: string,
  csvText: string
): Promise<ValidateRosterCsvResult> {
  const guard = await guardCourse(courseId);
  if ("error" in guard) return guard;
  if (!csvText || !csvText.trim()) return { error: "El archivo está vacío" };

  try {
    const result = validateRosterCsv(courseId, csvText);
    return {
      ok: true,
      // Sin studentId: el cliente no lo necesita
      rows: result.rows.map(({ line, email, action, status, message }) => ({
        line,
        email,
        action,
        status,
        message,
      })),
      toEnroll: result.toEnroll,
      toUnenroll: result.toUnenroll,
      noop: result.noop,
      invalid: result.invalid,
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo leer el archivo. Revisa el formato.") };
  }
}

export type ImportRosterCsvResult =
  | { ok: true; enrolled: number; unenrolled: number }
  | { error: string };

export async function importRosterCsvAction(input: {
  courseId: string;
  csvText: string;
}): Promise<ImportRosterCsvResult> {
  const guard = await guardCourse(input.courseId);
  if ("error" in guard) return guard;
  if (!input.csvText || !input.csvText.trim()) return { error: "El archivo está vacío" };

  try {
    const result = importRosterCsv({
      actorId: guard.userId,
      courseId: input.courseId,
      csvText: input.csvText,
    });
    revalidatePath(`/teach/courses/${input.courseId}/students`);
    revalidatePath("/teach/dashboard");
    return { ok: true, ...result };
  } catch (err) {
    return { error: errorMessage(err, "No se pudieron aplicar los cambios. Intenta de nuevo.") };
  }
}
