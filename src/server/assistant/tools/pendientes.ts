import "server-only";
import { pendientesQuery, type PendienteTipo } from "../queries";
import { schema, str, strEnum, param, type AssistantTool } from "../tool-types";
import { cursoFiltro, resultBlocks } from "./consulta-comun";

const TIPOS = ["sin_entrar", "sin_entregar", "reprobados"] as const;

/** Lo que falta: quién no entra, qué no se ha entregado y quién reprobó. */
export const pendientes: AssistantTool = {
  name: "pendientes",
  description:
    "Lo que falta: alumnos que llevan 14 días sin entrar, tareas sin entregar o exámenes por debajo del mínimo.",
  parameters: schema({
    tipo: strEnum(
      'Qué falta: «sin_entrar» (14 días sin acceso), «sin_entregar» (tareas pendientes) o «reprobados» (último intento por debajo del mínimo)',
      [...TIPOS]
    ),
    curso_id: str('Id del curso para mirar solo ese curso, de buscar_curso («» = todos los de tu vista)'),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const curso = cursoFiltro(params, ctx);
    if ("error" in curso) return { forModel: curso.error };
    // Un tipo que no conocemos lo resuelve la consulta («sin entrar»), no revienta
    const tipo = param(params, "tipo") as PendienteTipo;
    return resultBlocks(pendientesQuery(ctx.scope, tipo, curso.id), ctx, "pendientes");
  },
};
