import "server-only";
import { getOwnedCourse } from "@/server/services/courses";
import { findCohortByName, type CohortFilter } from "@/server/services/cohorts";
import {
  courseMatrix,
  matrixToCsv,
  type CellState,
  type MatrixColumn,
  type MatrixFilter,
  type MatrixRow,
} from "@/server/services/reports";
import type { Cell, SheetSpec } from "@/server/services/xlsx";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { schema, str, strEnum, param, type AssistantTool } from "../tool-types";
import { corto, reporteDescargas } from "./reporte-comun";

/**
 * «Dame el avance del curso en Excel»: la MISMA matriz de la pantalla de
 * Reportes (alumnos × lecciones), en una hoja con colores y en el CSV de
 * siempre.
 *
 * Nada se recalcula aquí: las filas, el porcentaje del curso y el riesgo salen
 * de `courseMatrix`, y el CSV de `matrixToCsv`, así que el archivo dice
 * exactamente lo mismo que la pantalla.
 */

const SOLO = ["", "en_riesgo", "completados"] as const;

/** El enum de la herramienta → el filtro que ya entiende la matriz. */
const FILTRO: Record<string, MatrixFilter> = { en_riesgo: "at_risk", completados: "completed" };

const FILTRO_LABEL: Record<MatrixFilter, string> = {
  all: "todos los alumnos",
  at_risk: "solo los que van en riesgo",
  completed: "solo los que ya terminaron",
};

/**
 * Cada estado de una celda, con su color en la hoja. El mapa es el de la
 * pantalla de Reportes: verde lo completado, sin color lo que está en marcha,
 * gris lo que ni se ha empezado y rojo lo que no puede avanzar —bloqueado por
 * la secuencia— o ya se le pasó la fecha (que es lo que pone al alumno en
 * riesgo).
 */
const ESTADO: Record<CellState, { label: string; style: Cell["style"] }> = {
  completed: { label: "Completado", style: "good" },
  in_progress: { label: "En progreso", style: "normal" },
  available: { label: "Sin empezar", style: "muted" },
  locked: { label: "Bloqueado", style: "bad" },
  overdue: { label: "Vencido", style: "bad" },
};

/** Cuántas lecciones flojas se señalan en el resumen. */
const PEORES = 3;

/** Las lecciones que menos gente completó, de peor a mejor. */
function leccionesFlojas(columns: MatrixColumn[], rows: MatrixRow[]): { titulo: string; parte: number }[] {
  if (columns.length === 0 || rows.length === 0) return [];
  return columns
    .map((col, i) => ({
      titulo: tituloDe(col),
      parte: rows.filter((r) => r.cells[i]?.state === "completed").length / rows.length,
    }))
    .sort((a, b) => a.parte - b.parte)
    .slice(0, PEORES);
}

/** El título de la columna lleva su carpeta delante cuando la lección está en una. */
function tituloDe(col: MatrixColumn): string {
  return col.folderTitle ? `${col.folderTitle} · ${col.title}` : col.title;
}

/** La celda de una lección: su estado y, si es examen, el puntaje como en el CSV. */
function celda(cell: MatrixRow["cells"][number], col: MatrixColumn): Cell {
  const { label, style } = ESTADO[cell.state];
  if (col.kind === "exam") {
    const puntaje =
      cell.examScorePercent === null || cell.examScorePercent === undefined
        ? "sin intento"
        : `${cell.examScorePercent}% ${cell.examPassed ? "aprobado" : "no aprobado"}`;
    return { text: `${label} (${puntaje})`, style };
  }
  return { text: label, style };
}

const estadoDelCurso = (row: MatrixRow) => (row.courseCompleted ? "Aprobado" : row.atRisk ? "En riesgo" : "Activo");

/** Hoja «Avance»: las columnas fijas del CSV y una más por lección. (Exportada para pnpm smoke:assistant.) */
export function hojaAvance(columns: MatrixColumn[], rows: MatrixRow[]): SheetSpec {
  return {
    name: "Avance",
    columns: [
      { title: "Estudiante", width: 8 },
      { title: "Correo", width: 9 },
      { title: "% Curso", width: 3 },
      { title: "Estado", width: 4 },
      ...columns.map((c) => ({ title: tituloDe(c), width: 7 })),
    ],
    rows: rows.map((row): Cell[] => {
      const estado = estadoDelCurso(row);
      return [
        { text: row.studentName },
        { text: row.email },
        { text: `${row.coursePercent}%`, percent: row.coursePercent / 100 },
        { text: estado, style: row.courseCompleted ? "good" : row.atRisk ? "bad" : "normal" },
        ...row.cells.map((cell, i) => celda(cell, columns[i])),
      ];
    }),
  };
}

/**
 * Hoja «Resumen»: las cifras del curso y, si tiene lecciones, las que menos
 * gente ha completado (que es lo que el maestro va a querer atender).
 */
export function hojaResumen(
  opts: { curso: string; grupo: string; filtro: MatrixFilter; incluidos: number; total: number },
  columns: MatrixColumn[],
  rows: MatrixRow[]
): SheetSpec {
  const completados = rows.filter((r) => r.courseCompleted).length;
  const sinEmpezar = rows.filter((r) => r.coursePercent === 0).length;
  const medio = rows.length === 0 ? 0 : Math.round(rows.reduce((acc, r) => acc + r.coursePercent, 0) / rows.length);

  const filas: Cell[][] = [
    [{ text: "Curso" }, { text: opts.curso }],
    [{ text: "Grupo" }, { text: opts.grupo || "todos" }],
    [{ text: "Filtro" }, { text: FILTRO_LABEL[opts.filtro] }],
    [{ text: "Alumnos" }, { text: String(opts.total), number: opts.total }],
    [{ text: "Completados" }, { text: String(completados), number: completados }],
    [{ text: "Avance medio" }, { text: `${medio}%`, percent: medio / 100 }],
    [{ text: "Sin empezar" }, { text: String(sinEmpezar), number: sinEmpezar }],
    [{ text: "Lecciones requeridas" }, { text: String(columns.length), number: columns.length }],
  ];
  if (opts.incluidos < opts.total) {
    filas.push([{ text: "Filas en el archivo", style: "bad" }, { text: `${opts.incluidos} de ${opts.total}`, style: "bad" }]);
  }

  // Las lecciones con menos avance: % de los alumnos del reporte que la completó
  const flojas = leccionesFlojas(columns, rows);
  if (flojas.length > 0) {
    filas.push([{ text: "" }]);
    filas.push([
      { text: "Lecciones con menos avance", style: "header" },
      { text: "La completó", style: "header" },
    ]);
    for (const f of flojas) {
      const pct = Math.round(f.parte * 100);
      filas.push([{ text: f.titulo }, { text: `${pct}%`, percent: f.parte, style: pct === 0 ? "bad" : undefined }]);
    }
  }

  return { name: "Resumen", columns: [{ title: "Dato", width: 11 }, { title: "Valor", width: 9 }], rows: filas };
}

export const reporteAvance: AssistantTool = {
  name: "reporte_avance",
  description:
    "El REPORTE de avance de un curso en Excel y CSV: una fila por alumno y una columna por lección, con su estado en color, el % del curso y una hoja de resumen con las lecciones que menos gente completó. Se puede acotar a un grupo o a los que van en riesgo o ya terminaron. Para cifras sueltas de un curso usa resumen_curso; para listas de alumnos o matrículas, listado.",
  parameters: schema({
    curso_id: str("Id del curso del reporte, de buscar_curso. Hace falta siempre"),
    grupo: str('Nombre del grupo tal como se llama en el curso, p. ej. «Matutino» («» = todos)'),
    solo: strEnum('Acota a «en_riesgo» (con algo vencido o muy atrasados), «completados» o «» = todos los alumnos', [
      ...SOLO,
    ]),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  async run(params, ctx) {
    const id = param(params, "curso_id");
    if (!id) {
      return { forModel: "Para el reporte de avance necesito el id del curso; búscalo con buscar_curso y vuelve a llamarme." };
    }
    const course = getOwnedCourse(id, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece; no generé ningún reporte." };

    // El grupo llega por su nombre: aquí se convierte en el mismo filtro que usa la pantalla
    const grupo = param(params, "grupo");
    let cohort: CohortFilter = { kind: "default" };
    if (grupo) {
      // `findCohortByName` se queja de los nombres imposibles (muy cortos o larguísimos)
      const encontrado = (() => {
        try {
          return findCohortByName(course.id, grupo);
        } catch {
          return null;
        }
      })();
      if (!encontrado) {
        return {
          forModel: `${course.title} no tiene ningún grupo llamado «${grupo}»; no generé nada. Pregúntale al usuario el nombre exacto del grupo o hazlo sin grupo.`,
        };
      }
      cohort = { kind: "one", id: encontrado.id };
    }

    const solo = param(params, "solo");
    const filter = FILTRO[solo] ?? "all";
    const acotado = grupo || filter !== "all";
    const { columns, rows, total } = courseMatrix(course.id, { page: 1, pageSize: 100000, filter, cohort });

    if (columns.length === 0) {
      return {
        forModel: `${course.title} no tiene ninguna lección que cuente para completar el curso, así que no hay avance que reportar. El contenido se agrega en el editor del curso.`,
      };
    }
    if (rows.length === 0) {
      return {
        forModel: acotado
          ? `Ningún alumno de ${course.title} pasa ese filtro (${[grupo ? `grupo «${grupo}»` : "", FILTRO_LABEL[filter]].filter(Boolean).join(", ")}), así que no generé ningún archivo.`
          : `${course.title} todavía no tiene alumnos matriculados; no hay avance que reportar.`,
      };
    }

    const completados = rows.filter((r) => r.courseCompleted).length;
    const enRiesgo = rows.filter((r) => r.atRisk).length;
    const medio = Math.round(rows.reduce((acc, r) => acc + r.coursePercent, 0) / rows.length);
    // Se piden todas las filas, igual que el CSV de la pantalla de Reportes.
    // `courseMatrix` tiene un tope de 100 000 para que un curso descomunal no
    // se lleve la memoria; si alguna vez recortara, el resumen y el texto lo dicen
    const recortado = rows.length < total;

    const blocks: AssistantBlock[] = [
      {
        type: "tiles",
        tiles: [
          { label: "Alumnos", value: String(total) },
          { label: "Completados", value: String(completados) },
          { label: "Avance medio", value: `${medio}%` },
          { label: "En riesgo", value: String(enRiesgo) },
        ],
      },
      {
        type: "table",
        columns: ["Alumno", "% Curso", "Estado"],
        rows: rows.slice(0, 10).map((r) => [r.studentName, `${r.coursePercent}%`, estadoDelCurso(r)]),
        more: Math.max(0, total - 10),
      },
    ];

    const { blocks: descargas, texto } = await reporteDescargas(ctx, {
      nombre: "reporte-avance",
      sheets: [
        hojaAvance(columns, rows),
        hojaResumen({ curso: course.title, grupo, filtro: filter, incluidos: rows.length, total }, columns, rows),
      ],
      // El MISMO CSV de la pantalla de Reportes: el formato no se duplica aquí
      csv: matrixToCsv(course.id, { filter, cohort }),
      cuantas: recortado ? `${rows.length} de ${total} alumnos` : `${rows.length} ${rows.length === 1 ? "alumno" : "alumnos"}`,
    });
    blocks.push(...descargas);

    const floja = leccionesFlojas(columns, rows)[0];
    const donde = grupo ? ` (grupo «${grupo}»)` : "";
    const filtrado = filter === "all" ? "" : ` (${FILTRO_LABEL[filter]})`;
    return {
      forModel: corto(
        `Reporte de avance de ${course.title}${donde}${filtrado}: ${total} alumno(s), ${completados} completado(s), avance medio ${medio} %, ${enRiesgo} en riesgo, ${columns.length} lección(es).${floja ? ` La que menos avanza: «${floja.titulo}» (${Math.round(floja.parte * 100)} %).` : ""}${recortado ? ` Ojo: el archivo solo trae los primeros ${rows.length}, y las cifras son de esos.` : ""}`,
        texto
      ),
      blocks,
    };
  },
};
