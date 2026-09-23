import "server-only";
import { and, eq, gte, lte, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/server/db";
import type { ViewScope } from "@/server/auth/view-scope";
import { getOwnedCourse } from "@/server/services/courses";
import { studentVisibleCondition } from "@/server/services/student-scope";
import {
  assignmentSubmissions,
  certificates,
  courseItems,
  courses,
  enrollments,
  examAttempts,
  users,
} from "@/server/db/schema";
import type { Cell, SheetSpec } from "@/server/services/xlsx";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { dateRange, type DateRange } from "@/lib/assistant-dates";
import { courseFilters, movimientosQuery } from "../queries";
import { schema, str, param, type AssistantTool } from "../tool-types";
import { cursoFiltro } from "./consulta-comun";
import { corto, reporteDescargas } from "./reporte-comun";

/**
 * «¿Cómo nos fue este mes?» en Excel: las cifras del periodo en una hoja y
 * todos los movimientos que las sustentan en otra.
 *
 * El detalle es el MISMO de la herramienta `movimientos` (`movimientosQuery`),
 * así que el reporte y el chat nunca se contradicen. Las cifras se cuentan
 * aquí agrupadas por curso —una consulta por cifra, no una por curso— y el
 * total es su suma, con los mismos filtros de contexto (`courseFilters`).
 */

/** Cursos que salen en la tabla por curso: los de más movimiento primero. */
const MAX_CURSOS = 50;

type Cifras = { matriculas: number; entregas: number; examenes: number; aprobados: number; certificados: number };
type PorCurso = Cifras & { id: string; titulo: string };

const CIFRAS_VACIAS: Cifras = { matriculas: 0, entregas: 0, examenes: 0, aprobados: 0, certificados: 0 };

const total = (cursos: PorCurso[], key: keyof Cifras) => cursos.reduce((acc, c) => acc + c[key], 0);

const movimiento = (c: Cifras) => c.matriculas + c.entregas + c.examenes + c.aprobados + c.certificados;

/**
 * Las cifras del periodo agrupadas por curso. Cada cifra es una consulta con
 * COUNT y GROUP BY: un curso solo aparece si tuvo algo.
 */
function cifrasPorCurso(scope: ViewScope, range: DateRange, courseId: string | null): PorCurso[] {
  const filtros = courseFilters(scope, courseId);
  const enRango = (column: AnyColumn) => and(gte(column, range.from), lte(column, range.to))!;
  const mapa = new Map<string, PorCurso>();

  const acumula = (rows: { id: string; titulo: string; n: number }[], key: keyof Cifras) => {
    for (const r of rows) {
      const actual = mapa.get(r.id) ?? { id: r.id, titulo: r.titulo, ...CIFRAS_VACIAS };
      actual[key] = Number(r.n);
      mapa.set(r.id, actual);
    }
  };
  const cuantos = { id: courses.id, titulo: courses.title, n: sql<number>`COUNT(*)` };

  acumula(
    db
      .select(cuantos)
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(and(enRango(enrollments.createdAt), ...filtros))
      .groupBy(courses.id)
      .all(),
    "matriculas"
  );
  acumula(
    db
      .select(cuantos)
      .from(assignmentSubmissions)
      .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
      .innerJoin(courses, eq(courseItems.courseId, courses.id))
      .where(and(enRango(assignmentSubmissions.submittedAt), ...filtros))
      .groupBy(courses.id)
      .all(),
    "entregas"
  );
  acumula(
    db
      .select(cuantos)
      .from(examAttempts)
      .innerJoin(courseItems, eq(examAttempts.examItemId, courseItems.id))
      .innerJoin(courses, eq(courseItems.courseId, courses.id))
      .where(and(enRango(examAttempts.submittedAt), ...filtros))
      .groupBy(courses.id)
      .all(),
    "examenes"
  );
  acumula(
    db
      .select(cuantos)
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(and(enRango(enrollments.completedAt), ...filtros))
      .groupBy(courses.id)
      .all(),
    "aprobados"
  );
  acumula(
    db
      .select(cuantos)
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .where(and(enRango(certificates.issuedAt), eq(certificates.revoked, false), ...filtros))
      .groupBy(courses.id)
      .all(),
    "certificados"
  );

  return [...mapa.values()].sort((a, b) => movimiento(b) - movimiento(a) || a.titulo.localeCompare(b.titulo, "es"));
}

/**
 * Altas de alumnos del periodo. No cuelgan de ningún curso (son cuentas), así
 * que se cuentan sobre los alumnos VISIBLES del contexto, con la misma regla
 * que el resto de la plataforma.
 */
function altasDelPeriodo(scope: ViewScope, range: DateRange): number {
  return Number(
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(users)
      .where(and(studentVisibleCondition(scope), gte(users.createdAt, range.from), lte(users.createdAt, range.to)))
      .get()?.n ?? 0
  );
}

const cifra = (label: string, value: number): Cell[] => [{ text: label }, { text: String(value), number: value }];

/** Hoja «Resumen»: una fila por cifra y, si hay varios cursos, cómo se reparten. */
function hojaResumen(opts: {
  periodo: string;
  donde: string;
  altas: number;
  cursos: PorCurso[];
  porCurso: boolean;
}): SheetSpec {
  const { cursos } = opts;
  const filas: Cell[][] = [
    [{ text: "Periodo" }, { text: opts.periodo }],
    [{ text: "Alcance" }, { text: opts.donde }],
    cifra("Alumnos dados de alta", opts.altas),
    cifra("Matrículas nuevas", total(cursos, "matriculas")),
    cifra("Entregas", total(cursos, "entregas")),
    cifra("Exámenes presentados", total(cursos, "examenes")),
    cifra("Aprobados (curso completado)", total(cursos, "aprobados")),
    cifra("Certificados emitidos", total(cursos, "certificados")),
  ];

  if (opts.porCurso) {
    const cabecera = ["Curso", "Matrículas", "Entregas", "Exámenes", "Aprobados", "Certificados"];
    filas.push([{ text: "" }]);
    filas.push(cabecera.map((text): Cell => ({ text, style: "header" })));
    for (const c of cursos.slice(0, MAX_CURSOS)) {
      filas.push([
        { text: c.titulo },
        { text: String(c.matriculas), number: c.matriculas },
        { text: String(c.entregas), number: c.entregas },
        { text: String(c.examenes), number: c.examenes },
        { text: String(c.aprobados), number: c.aprobados },
        { text: String(c.certificados), number: c.certificados },
      ]);
    }
  }

  // Las columnas de la hoja son las del bloque más ancho; las dos primeras son
  // las que mandan («Dato» y «Valor») y las demás solo dan ancho a la tabla
  const columns = opts.porCurso
    ? [
        { title: "Dato", width: 12 },
        { title: "Valor", width: 6 },
        { title: "", width: 5 },
        { title: "", width: 5 },
        { title: "", width: 5 },
        { title: "", width: 6 },
      ]
    : [
        { title: "Dato", width: 12 },
        { title: "Valor", width: 6 },
      ];
  return { name: "Resumen", columns, rows: filas };
}

/** Hoja «Detalle»: los movimientos tal como los devuelve `movimientosQuery`. */
function hojaDetalle(columns: string[], rows: string[][]): SheetSpec {
  const anchos = [8, 9, 13, 7];
  return {
    name: "Detalle",
    columns: columns.map((title, i) => ({ title, width: anchos[i] ?? 7 })),
    rows: rows.map((row) => row.map((text): Cell => ({ text }))),
  };
}

export const reportePeriodo: AssistantTool = {
  name: "reporte_periodo",
  description:
    "El REPORTE de un periodo en Excel y CSV: alumnos dados de alta, matrículas nuevas, entregas, exámenes presentados, aprobados y certificados emitidos, con el reparto por curso y el detalle de cada movimiento. Sirve para el corte de la semana, del mes o de un tramo de fechas. Si solo quieren ver las cifras en el chat, usa movimientos.",
  parameters: schema({
    desde: str(
      'Inicio del periodo tal como lo dijo la persona: «hoy», «esta semana», «semana pasada», «este mes», «mes pasado», «últimos 30 días» o una fecha «2026-09-01»'
    ),
    hasta: str('Fin del periodo, solo con fechas exactas («» = hoy o el final del periodo)'),
    curso_id: str('Id del curso para reportar solo ese curso, de buscar_curso («» = todos los de tu vista)'),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  async run(params, ctx) {
    const curso = cursoFiltro(params, ctx);
    if ("error" in curso) return { forModel: curso.error };
    // `dateRange` nunca falla: lo que no entiende es «hoy»
    const range = dateRange(param(params, "desde"), param(params, "hasta"));

    const cursos = cifrasPorCurso(ctx.scope, range, curso.id);
    const altas = altasDelPeriodo(ctx.scope, range);
    const movimientos = movimientosQuery(ctx.scope, range, curso.id);

    const matriculas = total(cursos, "matriculas");
    if (altas === 0 && matriculas === 0 && movimientos.total === 0) {
      return {
        forModel: `No hubo ningún movimiento ${range.label}${curso.id ? " en ese curso" : ""}: ni altas, ni matrículas, ni entregas, ni exámenes, ni certificados. No generé ningún archivo.`,
      };
    }

    const titulo = curso.id ? (getOwnedCourse(curso.id, ctx.user)?.title ?? "") : "";
    const donde = titulo ? `«${titulo}»` : "todos los cursos de tu vista";
    const porCurso = !curso.id && cursos.length > 1;

    const blocks: AssistantBlock[] = [
      {
        type: "tiles",
        tiles: [
          { label: "Altas", value: String(altas) },
          { label: "Matrículas", value: String(matriculas) },
          { label: "Entregas", value: String(total(cursos, "entregas")) },
          { label: "Exámenes", value: String(total(cursos, "examenes")) },
          { label: "Aprobados", value: String(total(cursos, "aprobados")) },
          { label: "Certificados", value: String(total(cursos, "certificados")) },
        ],
      },
    ];
    if (movimientos.rows.length > 0) {
      blocks.push({
        type: "table",
        columns: movimientos.columns,
        rows: movimientos.rows,
        more: movimientos.total - movimientos.rows.length,
      });
    }

    const { blocks: descargas, texto } = await reporteDescargas(ctx, {
      nombre: "reporte-periodo",
      sheets: [
        hojaResumen({ periodo: range.label, donde, altas, cursos, porCurso }),
        hojaDetalle(movimientos.columns, movimientos.allRows),
      ],
      // El detalle en CSV es el mismo de `movimientos`: el formato no se duplica
      csv: movimientos.csv,
      cuantas: `${movimientos.total} ${movimientos.total === 1 ? "movimiento" : "movimientos"}`,
    });
    blocks.push(...descargas);

    return {
      forModel: corto(
        `Reporte de ${range.label} en ${donde}: ${altas} alta(s), ${matriculas} matrícula(s), ${total(cursos, "entregas")} entrega(s), ${total(cursos, "examenes")} examen(es), ${total(cursos, "aprobados")} aprobado(s), ${total(cursos, "certificados")} certificado(s); ${movimientos.total} movimiento(s) en el detalle.`,
        texto
      ),
      blocks,
    };
  },
};
