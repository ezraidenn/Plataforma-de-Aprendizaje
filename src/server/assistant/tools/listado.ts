import "server-only";
import { dateRange } from "@/lib/assistant-dates";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { buildXlsx } from "@/server/services/xlsx";
import {
  listadoQuery,
  type ListadoCertificado,
  type ListadoDe,
  type ListadoEstado,
  type ListadoOrden,
} from "../listado";
import { XLSX_MIME, createExport, createFileExport, exportFileName } from "../exports";
import { schema, str, strEnum, param, type AssistantTool } from "../tool-types";
import { cursoFiltro } from "./consulta-comun";

/**
 * «Dame la lista de X con estos filtros», con la lista de verdad: tabla en el
 * panel, Excel con formato y CSV. No usa `resultBlocks` porque deja DOS
 * descargas, y la del Excel puede fallar (necesita LibreOffice): en ese caso se
 * ofrece solo el CSV y la IA se entera por el texto.
 */

const DE = ["alumnos", "matriculas", "certificados"] as const;
const ESTADOS = ["", "activos", "completados", "bajas", "sin_entrar", "reprobados"] as const;
const CERTIFICADO = ["", "si", "no"] as const;
const ORDENES = ["", "nombre", "avance", "reciente"] as const;

/** Un porcentaje que la IA manda como texto. Lo que no sea 0–100 es «sin filtro». */
function porcentaje(params: Record<string, unknown>, key: string): number | null {
  const raw = param(params, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * El tramo de fechas, o `null` si no pidieron ninguna. `dateRange` nunca
 * devuelve vacío (lo que no entiende es «hoy»), así que solo se le llama
 * cuando de verdad hay algo que interpretar.
 */
function tramo(params: Record<string, unknown>): { desde: Date | null; hasta: Date | null } {
  const desde = param(params, "desde");
  const hasta = param(params, "hasta");
  if (!desde && !hasta) return { desde: null, hasta: null };
  const range = dateRange(desde, hasta);
  return { desde: range.from, hasta: range.to };
}

export const listado: AssistantTool = {
  name: "listado",
  description:
    "La LISTA a la medida: «dame la lista de alumnos/matrículas/certificados con estos filtros», para verla en tabla y bajarla en Excel o CSV. Combina curso, grupo, estado, avance, certificado y fechas. Para cifras y resúmenes («cuántos», «qué pasó esta semana», «quién no entra») usa movimientos, pendientes o certificados.",
  parameters: schema({
    de: strEnum('Qué se lista: «alumnos», «matriculas» o «certificados»', [...DE]),
    curso_id: str('Id del curso para listar solo ese curso, de buscar_curso («» = todos los de tu vista)'),
    grupo: str('Nombre del grupo tal como se llama en el curso, p. ej. «Matutino» («» = todos)'),
    estado: strEnum(
      'Filtro de estado: «activos», «completados», «bajas», «sin_entrar» (14 días sin acceso), «reprobados» (último intento por debajo del mínimo) o «» = todos. En certificados, «activos» son los vigentes y «bajas» los revocados',
      [...ESTADOS]
    ),
    avance_min: str('Avance mínimo en número de 0 a 100, p. ej. «50» («» = sin mínimo). Solo en alumnos y matriculas'),
    avance_max: str('Avance máximo en número de 0 a 100 («» = sin máximo). Solo en alumnos y matriculas'),
    con_certificado: strEnum('«si» = solo quien tiene certificado vigente, «no» = solo quien no lo tiene, «» = da igual', [
      ...CERTIFICADO,
    ]),
    desde: str(
      'Desde cuándo, en palabras o fecha: «esta semana», «mes pasado», «2026-09-01» («» = sin límite). Cuenta el alta en alumnos, la matrícula en matriculas y la emisión en certificados'
    ),
    hasta: str('Hasta cuándo, con fecha exacta («» = sin límite)'),
    orden: strEnum('Cómo se ordena: «nombre», «avance» (de mayor a menor), «reciente» (lo más nuevo primero) o «» = por nombre', [
      ...ORDENES,
    ]),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  async run(params, ctx) {
    const curso = cursoFiltro(params, ctx);
    if ("error" in curso) return { forModel: curso.error };

    const de = param(params, "de");
    const estado = param(params, "estado");
    const conCertificado = param(params, "con_certificado");
    const orden = param(params, "orden");
    const { desde, hasta } = tramo(params);

    const result = listadoQuery(ctx.scope, {
      // Lo que la IA mande fuera del enum se trata como el valor de siempre
      de: (DE as readonly string[]).includes(de) ? (de as ListadoDe) : "matriculas",
      courseId: curso.id,
      grupo: param(params, "grupo"),
      estado: estado && (ESTADOS as readonly string[]).includes(estado) ? (estado as ListadoEstado) : "todos",
      avanceMin: porcentaje(params, "avance_min"),
      avanceMax: porcentaje(params, "avance_max"),
      conCertificado:
        conCertificado === "si" || conCertificado === "no" ? (conCertificado as ListadoCertificado) : "da_igual",
      desde,
      hasta,
      orden: orden === "avance" || orden === "reciente" ? (orden as ListadoOrden) : "nombre",
    });

    const blocks: AssistantBlock[] = [{ type: "tiles", tiles: result.tiles }];
    if (result.rows.length > 0) {
      blocks.push({
        type: "table",
        columns: result.columns,
        rows: result.rows,
        more: result.total - result.rows.length,
      });
    }
    // Sin filas no hay nada que bajar: los tiles ya dicen que el filtro dejó todo fuera
    if (result.total === 0) return { forModel: result.forModel, blocks };

    const cuantas = `${result.total} ${result.total === 1 ? "fila" : "filas"}`;
    let excelId = "";
    let aviso = "";
    try {
      const bytes = await buildXlsx([result.sheet]);
      excelId = await createFileExport(
        ctx.conversationId,
        exportFileName("listado", "xlsx"),
        bytes,
        XLSX_MIME,
        ctx.user.id
      );
      blocks.push({
        type: "download",
        label: "Descargar Excel",
        href: `/api/assistant/export/${excelId}`,
        detail: `${Math.max(1, Math.round(bytes.length / 1024))} KB · ${cuantas} · caduca en 24 horas`,
      });
    } catch {
      // Sin LibreOffice no hay Excel; el CSV lleva exactamente lo mismo
      aviso = " No se pudo generar el Excel: queda solo el CSV.";
    }

    const csvId = createExport(ctx.conversationId, exportFileName("listado"), result.csv);
    blocks.push({
      type: "download",
      label: "Descargar CSV",
      href: `/api/assistant/export/${csvId}`,
      detail: `${cuantas} · caduca en 24 horas`,
    });

    const descargas = excelId ? `${excelId} (Excel) y ${csvId} (CSV)` : `${csvId} (CSV)`;
    return { forModel: `${result.forModel}${aviso} Descargas: ${descargas}.`, blocks };
  },
};
