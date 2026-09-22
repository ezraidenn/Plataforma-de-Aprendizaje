"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { actingOwnerId } from "@/server/auth/view-scope";
import { getAiKey, getAiSettings } from "@/server/services/ai-settings";
import { interpretStudentsChunkWithRetry } from "@/server/services/ai-student-import";
import {
  cohortsForRows,
  importStudents,
  studentRowsToCsv,
  validateStudentsCsv,
} from "@/server/services/csv-import";
import { getOwnedCourse } from "@/server/services/courses";
import type { StudentDraft } from "@/lib/student-draft";

/**
 * «Importar con IA» de estudiantes. La IA solo lee la lista; lo que se crea
 * pasa por las MISMAS reglas que el CSV (validateStudentsCsv / importStudents):
 * las filas revisadas se vuelven CSV en el servidor.
 */

const MAX_ROWS = 5000;
const MAX_CHUNK_CHARS = 20_000;
const NO_KEY = "La IA no está configurada. Pide al administrador que agregue la clave de OpenAI.";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

type Row = { fullName: string; email: string };

/** Un tramo de texto de la lista → estudiantes. */
export async function analyzeStudentsChunkAction(input: {
  chunk: string;
}): Promise<{ drafts: StudentDraft[] } | { error: string }> {
  await requireTeacher();
  const chunk = input.chunk?.trim() ?? "";
  if (!chunk) return { drafts: [] };
  if (chunk.length > MAX_CHUNK_CHARS) return { error: "Este fragmento es demasiado largo para procesarlo." };
  const key = getAiKey();
  if (!key) return { error: NO_KEY };
  try {
    return { drafts: await interpretStudentsChunkWithRetry(chunk, { key, model: getAiSettings().model }) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo interpretar el archivo.") };
  }
}

export type AiStudentCheck = { status: "ok" | "duplicate" | "invalid"; message: string };

/**
 * Revisión en vivo de la vista previa: qué filas se crearán, cuáles ya
 * existen y cuáles tienen errores. No escribe nada.
 */
export async function validateAiStudentsAction(input: {
  rows: Row[];
}): Promise<{ ok: true; checks: AiStudentCheck[] } | { error: string }> {
  await requireTeacher();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) return { ok: true, checks: [] };
  if (rows.length > MAX_ROWS) return { error: `Máximo ${MAX_ROWS} estudiantes por importación` };
  try {
    const { rows: checked } = validateStudentsCsv(studentRowsToCsv(rows));
    return { ok: true, checks: checked.map((r) => ({ status: r.status, message: r.message })) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo revisar la lista.") };
  }
}

export type AiImportStudentsResult =
  | {
      ok: true;
      created: number;
      skipped: number;
      enrolled: number;
      /** Contiene las contraseñas generadas: descargable UNA sola vez */
      resultCsv: string;
    }
  | { error: string };

/**
 * Crea las cuentas (y, si se eligió curso, las matricula; con `useGroups`,
 * cada una en el grupo que traía la lista, creándolo si no existe).
 */
export async function importAiStudentsAction(input: {
  rows: (Row & { group?: string })[];
  enrollCourseId?: string | null;
  enrollDuplicates?: boolean;
  useGroups?: boolean;
}): Promise<AiImportStudentsResult> {
  const user = await requireTeacher();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) return { error: "No hay estudiantes para importar" };
  if (rows.length > MAX_ROWS) return { error: `Máximo ${MAX_ROWS} estudiantes por importación` };

  let enrollCourseId: string | null = null;
  let courseOwnerId: string | null = null;
  if (input.enrollCourseId) {
    const course = getOwnedCourse(input.enrollCourseId, user);
    if (!course) return { error: "No encontramos ese curso o no te pertenece" };
    enrollCourseId = course.id;
    // Igual que el CSV: los importados quedan a nombre del dueño del curso
    courseOwnerId = course.ownerId;
  }

  // Grupos de la lista → grupos del curso (se crean si no existen; uno cerrado se rechaza)
  let cohortByEmail: Record<string, string> | undefined;
  if (enrollCourseId && input.useGroups) {
    try {
      cohortByEmail = cohortsForRows(enrollCourseId, rows, user.id);
    } catch (err) {
      return { error: errorMessage(err, "No se pudieron preparar los grupos") };
    }
  }

  try {
    const scope = await getViewScope(user);
    const result = await importStudents({
      csvText: studentRowsToCsv(rows),
      createdBy: courseOwnerId ?? actingOwnerId(scope, user),
      actorId: user.id,
      enrollCourseId,
      enrollDuplicates: Boolean(input.enrollDuplicates) && enrollCourseId !== null,
      cohortByEmail,
      auditAction: "ai_import_students",
    });
    revalidatePath("/teach/students");
    revalidatePath("/teach/dashboard");
    if (enrollCourseId) {
      revalidatePath(`/teach/courses/${enrollCourseId}/students`);
      revalidatePath("/teach/groups");
    }
    return { ok: true, ...result };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo completar la importación. Intenta de nuevo.") };
  }
}
