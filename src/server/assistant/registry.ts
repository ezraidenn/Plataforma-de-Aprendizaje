import "server-only";
import type { ToolDef } from "@/server/services/ai-client";
import type { AssistantTool, ToolRole } from "./tool-types";
import { irA } from "./tools/ir-a";
import { buscarAlumno } from "./tools/buscar-alumno";
import { buscarCurso } from "./tools/buscar-curso";
import { fichaAlumno } from "./tools/ficha-alumno";
import { resumenCurso } from "./tools/resumen-curso";
import { matricular, desmatricular } from "./tools/matricular";
import { altaAlumnos } from "./tools/alta-alumnos";
import { bajaAlumnos } from "./tools/baja-alumnos";
import { reactivarAlumnos } from "./tools/reactivar-alumnos";
import { crearCursos } from "./tools/crear-cursos";
import { movimientos } from "./tools/movimientos";
import { pendientes } from "./tools/pendientes";
import { certificados } from "./tools/certificados";
import { listado } from "./tools/listado";
import { panorama } from "./tools/panorama";
import { descargarCertificados, descargarCsv } from "./tools/descargas";
import { formatoExcel } from "./tools/formato-excel";
import { aplicarExcel } from "./tools/aplicar-excel";

/** Catálogo completo. Lo que la IA no ve aquí, no existe para ella. */
const ALL: AssistantTool[] = [
  irA,
  buscarAlumno,
  buscarCurso,
  fichaAlumno,
  resumenCurso,
  matricular,
  desmatricular,
  altaAlumnos,
  bajaAlumnos,
  reactivarAlumnos,
  crearCursos,
  movimientos,
  pendientes,
  certificados,
  listado,
  panorama,
  descargarCertificados,
  descargarCsv,
  formatoExcel,
  aplicarExcel,
];

/** Capacidades previstas que aún no existen: la IA responde «aún no puedo». */
export const NOT_YET = ["grupos, recordatorios, reportes, plantillas de diploma"];

export function toolsForRole(role: ToolRole): AssistantTool[] {
  return ALL.filter((t) => t.roles.includes(role));
}

export function toolByName(name: string): AssistantTool | null {
  return ALL.find((t) => t.name === name) ?? null;
}

export function toolDefsForRole(role: ToolRole): ToolDef[] {
  return toolsForRole(role).map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: true,
  }));
}
