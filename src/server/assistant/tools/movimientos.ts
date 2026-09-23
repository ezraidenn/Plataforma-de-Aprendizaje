import "server-only";
import { dateRange } from "@/lib/assistant-dates";
import { movimientosQuery } from "../queries";
import { schema, str, param, type AssistantTool } from "../tool-types";
import { cursoFiltro, resultBlocks } from "./consulta-comun";

/** Qué ha pasado en un tramo de días: entregas, exámenes, aprobados y certificados. */
export const movimientos: AssistantTool = {
  name: "movimientos",
  description:
    "Qué ha pasado en un periodo: entregas, exámenes enviados, cursos completados y certificados emitidos. Sirve para «qué pasó hoy», «cómo va la semana» o un tramo de fechas.",
  parameters: schema({
    desde: str(
      'Inicio del periodo tal como lo dijo la persona: «hoy», «ayer», «esta semana», «semana pasada», «este mes», «últimos 7 días», «siempre» o una fecha «2026-09-01»'
    ),
    hasta: str('Fin del periodo, solo con fechas exactas («» = hoy o el final del periodo)'),
    curso_id: str('Id del curso para mirar solo ese curso, de buscar_curso («» = todos los de tu vista)'),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const curso = cursoFiltro(params, ctx);
    if ("error" in curso) return { forModel: curso.error };
    // `dateRange` nunca falla: lo que no entiende es «hoy»
    const range = dateRange(param(params, "desde"), param(params, "hasta"));
    return resultBlocks(movimientosQuery(ctx.scope, range, curso.id), ctx, "movimientos");
  },
};
