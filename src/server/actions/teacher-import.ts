"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { actingOwnerId } from "@/server/auth/view-scope";
import {
  CSV_TEMPLATE,
  validateStudentsCsv,
  importStudents,
} from "@/server/services/csv-import";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ─── Plantilla ───────────────────────────────────────────────────────────────

export type CsvTemplateResult = { template: string };

/** Devuelve la plantilla CSV (el cliente la baja como Blob). */
export async function csvTemplateAction(): Promise<CsvTemplateResult> {
  await requireTeacher();
  return { template: CSV_TEMPLATE };
}

// ─── Paso 2: validación (no escribe nada) ────────────────────────────────────

export type CsvPreviewRow = {
  line: number;
  fullName: string;
  email: string;
  status: "ok" | "duplicate" | "invalid";
  message: string;
};

export type ValidateCsvResult =
  | {
      ok: true;
      rows: CsvPreviewRow[];
      okCount: number;
      duplicates: number;
      invalid: number;
    }
  | { error: string };

export async function validateStudentsCsvAction(
  csvText: string
): Promise<ValidateCsvResult> {
  await requireTeacher();
  if (!csvText || !csvText.trim()) return { error: "El archivo está vacío" };

  try {
    const { rows, ok, duplicates, invalid } = validateStudentsCsv(csvText);
    // Las contraseñas NUNCA viajan en la vista previa; solo en el reporte final
    return {
      ok: true,
      rows: rows.map((r) => ({
        line: r.line,
        fullName: r.fullName,
        email: r.email,
        status: r.status,
        message: r.message,
      })),
      okCount: ok,
      duplicates,
      invalid,
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo leer el archivo. Revisa el formato.") };
  }
}

// ─── Paso 3: importación ─────────────────────────────────────────────────────

export type ImportCsvResult =
  | {
      ok: true;
      created: number;
      skipped: number;
      enrolled: number;
      /** Contiene las contraseñas generadas: descargable UNA sola vez */
      resultCsv: string;
    }
  | { error: string };

export async function importStudentsCsvAction(input: {
  csvText: string;
  enrollCourseId?: string | null;
  enrollDuplicates?: boolean;
}): Promise<ImportCsvResult> {
  const user = await requireTeacher();

  let enrollCourseId: string | null = null;
  let courseOwnerId: string | null = null;
  if (input.enrollCourseId) {
    const course = getOwnedCourse(input.enrollCourseId, user);
    if (!course) return { error: "No encontramos ese curso o no te pertenece" };
    enrollCourseId = course.id;
    // Los importados quedan a nombre del dueño del curso, no de quien ejecuta la importación
    courseOwnerId = course.ownerId;
  }

  try {
    const scope = await getViewScope(user);
    const result = await importStudents({
      csvText: input.csvText,
      createdBy: courseOwnerId ?? actingOwnerId(scope, user),
      actorId: user.id,
      enrollCourseId,
      enrollDuplicates: Boolean(input.enrollDuplicates) && enrollCourseId !== null,
      invite: true,
    });
    revalidatePath("/teach/students");
    revalidatePath("/teach/dashboard");
    if (enrollCourseId) revalidatePath(`/teach/courses/${enrollCourseId}/students`);
    return { ok: true, ...result };
  } catch (err) {
    return {
      error: errorMessage(err, "No se pudo completar la importación. Intenta de nuevo."),
    };
  }
}
