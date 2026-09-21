import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { courseItems, enrollments } from "@/server/db/schema";

/**
 * Matrícula vigente (ciclo más reciente) de un alumno en el curso al que
 * pertenece un ítem. Módulo sin dependencias de otros servicios para poder
 * usarlo desde exámenes, tareas y reportes sin ciclos de importación.
 *
 * Intentos de examen y entregas se guardan por matrícula: así un alumno que se
 * recertifica empieza el ciclo nuevo con intentos y entregas en cero, y los del
 * ciclo anterior se conservan como historial.
 */
export function currentEnrollmentIdForItem(itemId: string, studentId: string): string | null {
  const item = db
    .select({ courseId: courseItems.courseId })
    .from(courseItems)
    .where(eq(courseItems.id, itemId))
    .get();
  if (!item) return null;
  return (
    db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, item.courseId), eq(enrollments.studentId, studentId)))
      .orderBy(desc(enrollments.cycle))
      .limit(1)
      .get()?.id ?? null
  );
}

/**
 * Condición SQL: la fila de `enrollments` es el ciclo más reciente de ese
 * alumno en ese curso. Para listas (roster, matriz, «mis cursos»): un alumno
 * recertificado aparece una sola vez, con su ciclo vigente.
 *
 * OJO: en subconsultas correlacionadas la columna externa va calificada a mano
 * («"enrollments"."course_id"»); drizzle la resolvería contra la tabla interna.
 */
export const latestCycleOnly = sql`${enrollments.cycle} = (
  SELECT MAX(e2.cycle) FROM enrollments e2
  WHERE e2.course_id = "enrollments"."course_id"
    AND e2.student_id = "enrollments"."student_id"
)`;
