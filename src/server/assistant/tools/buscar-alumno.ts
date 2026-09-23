import "server-only";
import { listStudents } from "@/server/services/courses";
import { schema, str, param, type AssistantTool } from "../tool-types";

/**
 * Busca en el pool: la base de alumnos es una sola y cualquier alumno se puede
 * matricular. Marca a los que no son del maestro del contexto (sus reportes,
 * avisos y cuenta no están a su alcance).
 */
export const buscarAlumno: AssistantTool = {
  name: "buscar_alumno",
  description:
    "Busca alumnos por nombre o correo en la base de alumnos, que es una sola para todos los maestros. Devuelve hasta 5 con su id, para usar en otras herramientas.",
  parameters: schema({ texto: str("Nombre, parte del nombre o correo") }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const texto = param(params, "texto");
    if (!texto) return { forModel: "Falta el texto a buscar." };
    const { rows, total } = listStudents(ctx.scope, { search: texto, page: 1, pageSize: 5, pool: true });
    if (rows.length === 0) return { forModel: `No hay alumnos que coincidan con «${texto}».` };
    const lines = rows.map(
      (r) =>
        `- ${r.fullName} <${r.email}> id=${r.id}${r.active ? "" : " (deshabilitado)"}${
          r.mine ? "" : " (aún no está en tus cursos: se puede matricular)"
        }`
    );
    const more = total > rows.length ? ` Hay ${total - rows.length} más; pide un texto más específico.` : "";
    return { forModel: `${rows.length} alumno(s):\n${lines.join("\n")}${more}` };
  },
};
