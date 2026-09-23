import "server-only";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { buildXlsx, type SheetSpec } from "@/server/services/xlsx";
import { XLSX_MIME, createExport, createFileExport, exportFileName } from "../exports";
import type { ToolCtx } from "../tool-types";

/**
 * Lo común a los dos reportes (`reporte_avance` y `reporte_periodo`): dejar el
 * mismo par de descargas y recortar lo que ve la IA.
 *
 * El Excel necesita LibreOffice y puede fallar; el CSV nunca. Por eso el CSV
 * se ofrece siempre y, cuando falta el Excel, el texto de la IA lo dice para
 * que pueda avisarlo.
 */

/** Tope duro de lo que ve la IA, el mismo que en las consultas. */
const MAX_FOR_MODEL = 400;

/**
 * Una línea para la IA: sin saltos y nunca más de 400 caracteres. Lo que se
 * recorta es la descripción, nunca la `cola`: ahí van los ids de las descargas
 * y sin ellos la IA no las puede volver a ofrecer.
 */
export function corto(text: string, cola = ""): string {
  const limpio = (s: string) => s.replace(/\s+/g, " ").trim();
  const fin = limpio(cola);
  const margen = MAX_FOR_MODEL - (fin ? fin.length + 1 : 0);
  const cabeza = limpio(text);
  const recortada = cabeza.length <= margen ? cabeza : `${cabeza.slice(0, Math.max(0, margen - 1))}…`;
  return fin ? `${recortada} ${fin}`.trim() : recortada;
}

/**
 * Guarda el Excel y el CSV del reporte y devuelve sus dos bloques de descarga
 * (Excel primero) más el trozo de texto que se le añade a la IA con los ids.
 */
export async function reporteDescargas(
  ctx: ToolCtx,
  opts: { nombre: string; sheets: SheetSpec[]; csv: string; cuantas: string }
): Promise<{ blocks: AssistantBlock[]; texto: string }> {
  const blocks: AssistantBlock[] = [];
  let excelId = "";
  let aviso = "";

  try {
    const bytes = await buildXlsx(opts.sheets);
    excelId = await createFileExport(
      ctx.conversationId,
      exportFileName(opts.nombre, "xlsx"),
      bytes,
      XLSX_MIME,
      ctx.user.id
    );
    blocks.push({
      type: "download",
      label: "Descargar Excel",
      href: `/api/assistant/export/${excelId}`,
      detail: `${Math.max(1, Math.round(bytes.length / 1024))} KB · ${opts.cuantas} · caduca en 24 horas`,
    });
  } catch {
    // Sin LibreOffice no hay Excel; el CSV lleva los mismos datos
    aviso = " No se pudo generar el Excel: queda solo el CSV.";
  }

  const csvId = createExport(ctx.conversationId, exportFileName(opts.nombre), opts.csv);
  blocks.push({
    type: "download",
    label: "Descargar CSV",
    href: `/api/assistant/export/${csvId}`,
    detail: `${opts.cuantas} · caduca en 24 horas`,
  });

  const descargas = excelId ? `${excelId} (Excel) y ${csvId} (CSV)` : `${csvId} (CSV)`;
  return { blocks, texto: `${aviso} Descargas: ${descargas}.` };
}
