import "server-only";
import { getOwnedCourse, listCourseStudents } from "@/server/services/courses";
import { schema, str, param, type AssistantTool } from "../tool-types";

const STATUS: Record<string, string> = { draft: "borrador", published: "publicado", archived: "archivado" };

/** Cifras de un curso del usuario. */
export const resumenCurso: AssistantTool = {
  name: "resumen_curso",
  description: "Resumen de un curso: estado, matriculados, completados y diploma asignado. Necesita el id (usa buscar_curso).",
  parameters: schema({ curso_id: str("Id del curso") }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const id = param(params, "curso_id");
    if (!id) return { forModel: "Falta curso_id." };
    const course = getOwnedCourse(id, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };
    const students = listCourseStudents(course.id);
    const completed = students.filter((s) => s.status === "completed").length;
    const forModel = `${course.title}: ${STATUS[course.status] ?? course.status}, ${students.length} matriculado(s), ${completed} completado(s), diploma ${course.certificateTemplateId ? "asignado" : "sin asignar"}. id=${course.id}`;
    return {
      forModel,
      blocks: [
        {
          type: "tiles",
          tiles: [
            { label: "Matriculados", value: String(students.length) },
            { label: "Completados", value: String(completed) },
            { label: "Estado", value: STATUS[course.status] ?? course.status },
          ],
        },
        {
          type: "links",
          links: [
            { label: "Abrir el curso", href: `/teach/courses/${course.id}`, icon: "course" },
            { label: "Ver alumnos", href: `/teach/courses/${course.id}/students`, icon: "user" },
          ],
        },
      ],
    };
  },
};
