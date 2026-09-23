import "server-only";
import type { SessionUser } from "@/server/auth/sessions";
import type { ViewScope } from "@/server/auth/view-scope";
import { renewalCounts } from "@/server/services/renewals";
import { gradingQueue } from "@/server/services/grading";
import { listTeacherCourses } from "@/server/services/courses";
import { sinEntrarCount } from "./queries";

/**
 * Lo que vale la pena atender hoy, en forma de pregunta. El panel las pinta
 * al abrirse en blanco: en vez de una caja vacía, tres atajos a lo que de
 * verdad está esperando, con su cifra al lado.
 *
 * Reglas fijas de aquí:
 * - Todo sale del contexto (`scope`), nunca del rol: un maestro solo ve lo suyo.
 * - Solo entra lo que tiene cuenta mayor que cero: una sugerencia con 0 sobra.
 * - Cada texto es una pregunta que la IA sabe contestar con las herramientas
 *   que ya existen (certificados, pendientes, buscar_curso…).
 * - En cuanto hay tres se deja de contar: lo de abajo ni se consulta.
 */

export type Suggestion = { text: string; detail: string };

/** Cuántas se pintan: más no caben bajo el texto de bienvenida. */
const MAX = 3;

function make(text: string, count: number, singular: string, plural: string): Suggestion | null {
  return count > 0 ? { text, detail: `${count} ${count === 1 ? singular : plural}` } : null;
}

export function platformSuggestions(user: SessionUser, scope: ViewScope): Suggestion[] {
  // Los cursos se leen una sola vez, y solo si hacen falta
  let courses: ReturnType<typeof listTeacherCourses> | null = null;
  const cursos = () => (courses ??= listTeacherCourses(scope));

  // En orden de prioridad: lo que vence manda sobre lo que solo está en borrador
  const candidates: (() => Suggestion | null)[] = [
    () => make("¿A quién le vence el certificado este mes?", renewalCounts(scope).expiring, "certificado", "certificados"),
    () => make("¿Qué tengo por calificar?", gradingQueue(scope).length, "pendiente", "pendientes"),
    () => make("¿Quién no ha entrado todavía?", sinEntrarCount(scope), "alumno", "alumnos"),
    () =>
      make(
        "¿Qué cursos no tienen diploma?",
        cursos().filter((c) => c.course.status === "published" && !c.course.certificateTemplateId).length,
        "curso",
        "cursos"
      ),
    () => make("¿Qué cursos están en borrador?", cursos().filter((c) => c.course.status === "draft" && c.enrolled > 0).length, "curso", "cursos"),
  ];

  const out: Suggestion[] = [];
  for (const candidate of candidates) {
    if (out.length === MAX) break;
    const suggestion = candidate();
    if (suggestion) out.push(suggestion);
  }
  return out;
}
