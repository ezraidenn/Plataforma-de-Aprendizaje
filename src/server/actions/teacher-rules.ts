"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { courses } from "@/server/db/schema";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { linearOrder } from "@/server/services/tree";
import { reevaluateCourse, type Condition, type RuleGroup } from "@/server/services/rules-engine";

export type SaveRulesResult = { ok: true } | { error: string };

function isValidPercent(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 100;
}

/**
 * Valida y normaliza una condición que viene del cliente. Devuelve la condición
 * saneada (sin campos extra) o un mensaje de error en español llano.
 */
function sanitizeCondition(
  raw: Condition,
  examIds: Set<string>
): { condition: Condition } | { error: string } {
  switch (raw.type) {
    case "viewing_completion":
      if (!isValidPercent(raw.min_percent)) {
        return { error: "El porcentaje de contenido visto debe estar entre 1 y 100" };
      }
      return { condition: { type: "viewing_completion", min_percent: raw.min_percent } };

    case "exam_average": {
      if (!isValidPercent(raw.min_percent)) {
        return { error: "El promedio mínimo de exámenes debe estar entre 1 y 100" };
      }
      if (raw.scope === "all") {
        return { condition: { type: "exam_average", min_percent: raw.min_percent, scope: "all" } };
      }
      if (!Array.isArray(raw.scope) || raw.scope.length === 0) {
        return { error: "Elige al menos un examen para el promedio" };
      }
      if (raw.scope.some((id) => !examIds.has(id))) {
        return { error: "Uno de los exámenes elegidos ya no existe en el curso" };
      }
      return {
        condition: { type: "exam_average", min_percent: raw.min_percent, scope: [...raw.scope] },
      };
    }

    case "exam_specific":
      if (!raw.item_id || !examIds.has(raw.item_id)) {
        return { error: "Elige el examen para la condición de examen específico" };
      }
      if (!isValidPercent(raw.min_percent)) {
        return { error: "La calificación mínima del examen debe estar entre 1 y 100" };
      }
      return {
        condition: { type: "exam_specific", item_id: raw.item_id, min_percent: raw.min_percent },
      };

    case "all_items_completed":
      return { condition: { type: "all_items_completed" } };

    default:
      return { error: "Hay una condición que no reconocemos. Recarga la página." };
  }
}

/**
 * Guarda las reglas de aprobación (Y u O, sin anidar) en courses.completionRules y
 * re-evalúa a todos los matriculados activos. Nunca des-aprueba a nadie.
 */
export async function saveRulesAction(
  courseId: string,
  conditions: Condition[],
  op: "AND" | "OR" = "AND"
): Promise<SaveRulesResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { error: "Agrega al menos una condición" };
  }
  if (conditions.length > 20) {
    return { error: "Demasiadas condiciones (máximo 20)" };
  }
  if (op !== "AND" && op !== "OR") {
    return { error: "Operador no válido" };
  }

  const examIds = new Set(
    linearOrder(courseId)
      .filter((item) => item.kind === "exam")
      .map((item) => item.id)
  );

  const sanitized: Condition[] = [];
  for (const raw of conditions) {
    const result = sanitizeCondition(raw, examIds);
    if ("error" in result) return result;
    sanitized.push(result.condition);
  }

  const rules: RuleGroup = { op, conditions: sanitized };

  try {
    db.update(courses)
      .set({ completionRules: rules, updatedAt: new Date() })
      .where(eq(courses.id, courseId))
      .run();

    // Re-evaluación inmediata: quien ya cumple, aprueba; nadie pierde nada
    reevaluateCourse(courseId);

    revalidatePath(`/teach/courses/${courseId}`, "layout");
    return { ok: true };
  } catch {
    return { error: "No se pudieron guardar las reglas. Intenta de nuevo." };
  }
}
