import "server-only";
import { listTeacherCourses } from "@/server/services/courses";
import { schema, str, param, type AssistantTool } from "../tool-types";

const STATUS: Record<string, string> = { draft: "borrador", published: "publicado", archived: "archivado" };

/** Cursos del contexto de vista. */
export const buscarCurso: AssistantTool = {
  name: "buscar_curso",
  description: "Busca cursos por título. Devuelve hasta 5 con su id y estado.",
  parameters: schema({ texto: str("Título o parte del título; vacío para listar los más recientes") }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const texto = param(params, "texto");
    const rows = listTeacherCourses(ctx.scope, texto).slice(0, 5);
    if (rows.length === 0) return { forModel: texto ? `No hay cursos que coincidan con «${texto}».` : "No hay cursos todavía." };
    const lines = rows.map(({ course, enrolled }) => `- ${course.title} (${STATUS[course.status] ?? course.status}, ${enrolled} matriculados) id=${course.id}`);
    return { forModel: `${rows.length} curso(s):\n${lines.join("\n")}` };
  },
};
