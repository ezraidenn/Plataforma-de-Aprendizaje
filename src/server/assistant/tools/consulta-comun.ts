import "server-only";
import { getOwnedCourse } from "@/server/services/courses";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { createExport, exportFileName } from "../exports";
import type { QueryResult } from "../queries";
import { param, type ToolCtx, type ToolResult } from "../tool-types";

/**
 * Lo común a movimientos, pendientes, certificados y panorama: resolver el
 * curso del parámetro y convertir el `QueryResult` en lo que ve el usuario
 * (tiles, tabla corta y, si hay filas, el CSV entero como descarga).
 *
 * La descarga vive en la conversación y caduca a las 24 horas: son datos
 * personales, no un archivo del curso.
 */

/** Curso del parámetro `curso_id`: `null` = todos los de la vista; `error` = no es suyo. */
export function cursoFiltro(
  params: Record<string, unknown>,
  ctx: ToolCtx
): { id: string | null } | { error: string } {
  const id = param(params, "curso_id");
  if (!id) return { id: null };
  const course = getOwnedCourse(id, ctx.user);
  if (!course) {
    return { error: "No encontramos ese curso o no te pertenece; no consulté nada. Busca el id con buscar_curso." };
  }
  return { id: course.id };
}

/**
 * Lo que devuelve una consulta: cifras y tabla para el usuario, una línea para
 * la IA. Con filas se guarda el CSV completo y se ofrece como descarga; su id
 * también va en el texto de la IA para que pueda volver a ofrecerla.
 */
export function resultBlocks(result: QueryResult, ctx: ToolCtx, nombre: string): ToolResult {
  const blocks: AssistantBlock[] = [{ type: "tiles", tiles: result.tiles }];
  // Sin filas no se pinta la tabla: los tiles ya dicen que no hay nada
  if (result.rows.length > 0) {
    blocks.push({ type: "table", columns: result.columns, rows: result.rows, more: result.total - result.rows.length });
  }
  if (result.total === 0) return { forModel: result.forModel, blocks };

  const exportId = createExport(ctx.conversationId, exportFileName(nombre), result.csv);
  blocks.push({
    type: "download",
    label: "Descargar CSV",
    href: `/api/assistant/export/${exportId}`,
    detail: `${result.total} ${result.total === 1 ? "fila" : "filas"} · caduca en 24 horas`,
  });
  return { forModel: `${result.forModel} Descarga: ${exportId}.`, blocks };
}
