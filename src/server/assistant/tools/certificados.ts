import "server-only";
import { certificadosQuery, type CertificadoEstado } from "../queries";
import { schema, str, strEnum, param, type AssistantTool } from "../tool-types";
import { cursoFiltro, resultBlocks } from "./consulta-comun";

const ESTADOS = ["emitidos", "por_vencer", "vencidos"] as const;

/** Ventana por defecto de «por vencer» cuando la IA no manda un número. */
const DIAS_POR_DEFECTO = 30;

/** Certificados de la vista: emitidos, por vencer o ya vencidos. */
export const certificados: AssistantTool = {
  name: "certificados",
  description:
    "Certificados: los emitidos, los que vencen dentro de unos días o los que ya vencieron. Los revocados no cuentan.",
  parameters: schema({
    estado: strEnum('Qué certificados: «emitidos», «por_vencer» o «vencidos»', [...ESTADOS]),
    curso_id: str('Id del curso para mirar solo ese curso, de buscar_curso («» = todos los de tu vista)'),
    dias: str('Solo con «por_vencer»: días de la ventana, en número («» = 30; máximo 365)'),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const curso = cursoFiltro(params, ctx);
    if ("error" in curso) return { forModel: curso.error };
    // La IA manda los números como texto: lo que no sea un número útil vale 30
    const n = Number(param(params, "dias"));
    const dias = Number.isFinite(n) && n > 0 ? n : DIAS_POR_DEFECTO;
    const estado = param(params, "estado") as CertificadoEstado;
    return resultBlocks(certificadosQuery(ctx.scope, estado, curso.id, dias), ctx, "certificados");
  },
};
