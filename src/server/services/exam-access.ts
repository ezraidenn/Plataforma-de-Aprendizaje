import "server-only";
import { getOwnedCourse } from "./courses";
import { getItem } from "./tree";
import { getExam } from "./exams";

export type ExamItem = NonNullable<ReturnType<typeof getItem>>;

/**
 * El ítem debe ser un examen de un curso del usuario (o de cualquiera, si es
 * admin). La usan las acciones del editor de exámenes, las de «Importar con
 * IA» y la ruta de visión.
 */
export function ownedExamItem(
  user: { id: string; role: string },
  courseId: string,
  itemId: string
): { item: ExamItem } | { error: string } {
  if (!getOwnedCourse(courseId, user)) return { error: "No encontramos este curso o no te pertenece" };
  const item = getItem(itemId);
  if (!item || item.courseId !== courseId || item.kind !== "exam" || !getExam(itemId)) {
    return { error: "No encontramos este examen" };
  }
  return { item };
}
