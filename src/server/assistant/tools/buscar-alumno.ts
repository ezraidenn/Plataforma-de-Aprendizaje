import "server-only";
import { listStudents } from "@/server/services/courses";
import { schema, str, param, type AssistantTool } from "../tool-types";

/** Alumnos visibles en el contexto (los propios del maestro). */
export const buscarAlumno: AssistantTool = {
  name: "buscar_alumno",
  description: "Busca alumnos por nombre o correo. Devuelve hasta 5 con su id, para usar en otras herramientas.",
  parameters: schema({ texto: str("Nombre, parte del nombre o correo") }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const texto = param(params, "texto");
    if (!texto) return { forModel: "Falta el texto a buscar." };
    const { rows, total } = listStudents(ctx.scope, { search: texto, page: 1, pageSize: 5 });
    if (rows.length === 0) return { forModel: `No hay alumnos que coincidan con «${texto}».` };
    const lines = rows.map((r) => `- ${r.fullName} <${r.email}> id=${r.id}${r.active ? "" : " (deshabilitado)"}`);
    const more = total > rows.length ? ` Hay ${total - rows.length} más; pide un texto más específico.` : "";
    return { forModel: `${rows.length} alumno(s):\n${lines.join("\n")}${more}` };
  },
};
