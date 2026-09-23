import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { ownerCondition, type ViewScope } from "@/server/auth/view-scope";
import { visibleStudentCountsByOwner } from "@/server/services/student-scope";
import { BOM, csvLine } from "@/server/services/csv-core";
import type { DateRange } from "@/lib/assistant-dates";
import {
  assignmentSubmissions,
  certificates,
  courseItems,
  courses,
  enrollments,
  examAttempts,
  exams,
  users,
} from "@/server/db/schema";

/**
 * Las consultas del asistente: movimientos, pendientes, certificados y
 * panorama. Todas devuelven lo mismo (`QueryResult`) para que la respuesta se
 * arme igual: tiles con cifras, una tabla corta, el CSV entero y UNA línea
 * para la IA.
 *
 * Reglas fijas de aquí:
 * - Lo que se ve depende del contexto (`ownerCondition` sobre `courses`), no
 *   del rol: un maestro nunca ve movimientos de otro.
 * - La IA recibe cifras y como mucho 5 nombres (tope duro de 400 caracteres):
 *   mandarle la lista entera sería tirar la privacidad y el presupuesto.
 * - «Aprobó / reprobó» un examen es lo mismo que ve el alumno: porcentaje
 *   (`final_score / max_score_snapshot`) contra el `pass_score` del examen. Un
 *   examen sin mínimo no reprueba a nadie (el curso lo deciden las reglas).
 */

export type QueryTile = { label: string; value: string };

export type QueryResult = {
  tiles: QueryTile[];
  columns: string[];
  /** Hasta 20 filas para mostrar */
  rows: string[][];
  /** Total real (para «y N más») */
  total: number;
  /** CSV con TODAS las filas (máximo 5 000), con BOM */
  csv: string;
  /** Una línea para la IA: cifras y como mucho 5 nombres */
  forModel: string;
};

const DAY_MS = 86_400_000;
/** Filas que se enseñan en el chat; el resto va en el CSV */
const MAX_SHOWN = 20;
const MAX_CSV_ROWS = 5_000;
/** Tope duro de lo que ve la IA */
const MAX_FOR_MODEL = 400;
/** Nombres que se le pasan a la IA como mucho */
const MAX_NAMES = 5;
/** Sin entrar: días sin acceso para considerarlo pendiente */
const IDLE_DAYS = 14;
/** Certificados por vencer: ventana por defecto y tope */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

const DATE_FMT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** «22 sept 2026»; con la hora si es de hoy (lo de hoy se lee mejor con hora). */
function fmtDate(value: Date | null | undefined): string {
  if (!value) return "";
  const now = new Date();
  const sameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
  return (sameDay ? DATE_TIME_FMT : DATE_FMT).format(value);
}

/** Puntaje legible: entero sin decimales, con uno si hace falta. «—» si no hay. */
function fmtNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function percent(score: number | null, max: number | null): number | null {
  if (score === null || max === null || max <= 0) return null;
  return Math.round((score / max) * 1000) / 10;
}

/** Recorta lo que ve la IA: una línea y nunca más de 400 caracteres. */
function clampForModel(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= MAX_FOR_MODEL ? clean : `${clean.slice(0, MAX_FOR_MODEL - 1)}…`;
}

/** Hasta 5 nombres distintos de una columna: la lista entera no sale de aquí. */
function fewNames(rows: string[][], column = 0): string {
  const unique = [...new Set(rows.map((r) => r[column]).filter((n) => n))];
  if (unique.length === 0) return "";
  const shown = unique.slice(0, MAX_NAMES).join(", ");
  return unique.length > MAX_NAMES ? `${shown} y ${unique.length - MAX_NAMES} más` : shown;
}

function countDistinct(values: string[]): number {
  return new Set(values).size;
}

function tile(label: string, value: number): QueryTile {
  return { label, value: String(value) };
}

/**
 * Forma común: recorta a 20 filas, guarda el total real y arma el CSV con
 * todas (hasta 5 000). El CSV va con BOM y saltos CRLF, como el resto de las
 * descargas: así Excel lo abre con acentos.
 */
function toResult(input: {
  tiles: QueryTile[];
  columns: string[];
  allRows: string[][];
  forModel: string;
}): QueryResult {
  const { tiles, columns, allRows } = input;
  const lines = [csvLine(columns), ...allRows.slice(0, MAX_CSV_ROWS).map((row) => csvLine(row))];
  return {
    tiles,
    columns,
    rows: allRows.slice(0, MAX_SHOWN),
    total: allRows.length,
    csv: BOM + lines.join("\r\n"),
    forModel: clampForModel(input.forModel),
  };
}

/** Filtros de «los cursos del contexto», con el curso concreto si lo pidieron. */
function courseFilters(scope: ViewScope, courseId: string | null): SQL[] {
  const conds: SQL[] = [];
  const owner = ownerCondition(scope, courses.ownerId);
  if (owner) conds.push(owner);
  if (courseId) conds.push(eq(courses.id, courseId));
  return conds;
}

/** « en «Extintores»» para la línea de la IA (vacío si no filtraron por curso). */
function courseLabel(scope: ViewScope, courseId: string | null): string {
  if (!courseId) return "";
  const row = db
    .select({ title: courses.title })
    .from(courses)
    .where(and(eq(courses.id, courseId), ownerCondition(scope, courses.ownerId)))
    .get();
  return row ? ` en «${row.title}»` : " en un curso que no está en tu vista";
}

// ─── Movimientos ─────────────────────────────────────────────────────────────

type Movement = { at: Date; student: string; course: string; what: string };

/**
 * Lo que pasó en un tramo de días: entregas, exámenes enviados, cursos
 * completados y certificados emitidos, todo junto y de lo más nuevo a lo más
 * viejo.
 */
export function movimientosQuery(scope: ViewScope, range: DateRange, courseId: string | null): QueryResult {
  const filters = courseFilters(scope, courseId);
  const inRange = (column: AnyColumn) => and(gte(column, range.from), lte(column, range.to))!;

  const entregas = db
    .select({
      at: assignmentSubmissions.submittedAt,
      student: users.fullName,
      course: courses.title,
      item: courseItems.title,
    })
    .from(assignmentSubmissions)
    .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(assignmentSubmissions.studentId, users.id))
    .where(and(inRange(assignmentSubmissions.submittedAt), ...filters))
    .all();

  const examenes = db
    .select({
      at: examAttempts.submittedAt,
      student: users.fullName,
      course: courses.title,
      item: courseItems.title,
      score: examAttempts.finalScore,
      max: examAttempts.maxScoreSnapshot,
    })
    .from(examAttempts)
    .innerJoin(courseItems, eq(examAttempts.examItemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(examAttempts.studentId, users.id))
    .where(and(inRange(examAttempts.submittedAt), ...filters))
    .all();

  const aprobados = db
    .select({ at: enrollments.completedAt, student: users.fullName, course: courses.title })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(and(inRange(enrollments.completedAt), ...filters))
    .all();

  const emitidos = db
    .select({
      at: certificates.issuedAt,
      student: users.fullName,
      course: courses.title,
      folio: certificates.folio,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .innerJoin(users, eq(certificates.studentId, users.id))
    .where(and(inRange(certificates.issuedAt), eq(certificates.revoked, false), ...filters))
    .all();

  const movimientos: Movement[] = [
    ...entregas.map((r) => ({ at: r.at, student: r.student, course: r.course, what: `Entregó ${r.item}` })),
    ...examenes.map((r) => ({
      at: r.at!,
      student: r.student,
      course: r.course,
      what: `Examen ${r.item}: ${fmtNumber(r.score)} / ${fmtNumber(r.max)}`,
    })),
    ...aprobados.map((r) => ({ at: r.at!, student: r.student, course: r.course, what: "Completó el curso" })),
    ...emitidos.map((r) => ({
      at: r.at,
      student: r.student,
      course: r.course,
      what: `Certificado ${r.folio}`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const allRows = movimientos.map((m) => [m.student, m.course, m.what, fmtDate(m.at)]);
  const donde = courseLabel(scope, courseId);
  const total = movimientos.length;
  const nombres = fewNames(allRows);

  return toResult({
    tiles: [
      tile("Entregas", entregas.length),
      tile("Exámenes", examenes.length),
      tile("Aprobados", aprobados.length),
      tile("Certificados", emitidos.length),
    ],
    columns: ["Alumno", "Curso", "Qué pasó", "Cuándo"],
    allRows,
    forModel:
      total === 0
        ? `Sin movimientos ${range.label}${donde}.`
        : `Movimientos ${range.label}${donde}: ${total} en total — ${entregas.length} entregas, ${examenes.length} exámenes, ${aprobados.length} aprobados, ${emitidos.length} certificados.${nombres ? ` Alumnos: ${nombres}.` : ""}`,
  });
}

// ─── Pendientes ──────────────────────────────────────────────────────────────

export type PendienteTipo = "sin_entrar" | "sin_entregar" | "reprobados";

/**
 * Lo que falta. La IA manda texto, así que un tipo que no conocemos se trata
 * como «sin entrar» en vez de reventar.
 */
export function pendientesQuery(scope: ViewScope, tipo: PendienteTipo, courseId: string | null): QueryResult {
  if (tipo === "sin_entregar") return sinEntregar(scope, courseId);
  if (tipo === "reprobados") return reprobados(scope, courseId);
  return sinEntrar(scope, courseId);
}

/** Matriculados activos que no entran desde hace 14 días (o que nunca entraron). */
function sinEntrar(scope: ViewScope, courseId: string | null): QueryResult {
  const limit = new Date(Date.now() - IDLE_DAYS * DAY_MS);
  const rows = db
    .select({
      studentId: users.id,
      student: users.fullName,
      course: courses.title,
      last: users.lastLoginAt,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(
      and(
        eq(enrollments.status, "active"),
        or(isNull(users.lastLoginAt), lt(users.lastLoginAt, limit)),
        ...courseFilters(scope, courseId)
      )
    )
    // SQLite ordena los NULL primero: los que nunca entraron encabezan la lista
    .orderBy(asc(users.lastLoginAt), asc(users.fullName))
    .all();

  const allRows = rows.map((r) => [r.student, r.course, r.last ? fmtDate(r.last) : "nunca"]);
  const alumnos = countDistinct(rows.map((r) => r.studentId));
  const donde = courseLabel(scope, courseId);
  const nombres = fewNames(allRows);

  return toResult({
    tiles: [tile("Alumnos", alumnos), tile("Matrículas", rows.length)],
    columns: ["Alumno", "Curso", "Último acceso"],
    allRows,
    forModel:
      rows.length === 0
        ? `Nadie lleva ${IDLE_DAYS} días sin entrar${donde}.`
        : `Sin entrar en ${IDLE_DAYS} días${donde}: ${alumnos} alumnos (${rows.length} matrículas).${nombres ? ` ${nombres}.` : ""}`,
  });
}

/** Pares alumno/tarea sin entrega, con la matrícula activa. */
function sinEntregar(scope: ViewScope, courseId: string | null): QueryResult {
  const rows = db
    .select({
      studentId: users.id,
      student: users.fullName,
      course: courses.title,
      task: courseItems.title,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(courseItems, and(eq(courseItems.courseId, courses.id), eq(courseItems.kind, "assignment")))
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(
      and(
        eq(enrollments.status, "active"),
        sql`NOT EXISTS (
          SELECT 1 FROM assignment_submissions s
           WHERE s.item_id = ${courseItems.id} AND s.student_id = ${enrollments.studentId}
        )`,
        ...courseFilters(scope, courseId)
      )
    )
    .orderBy(asc(users.fullName), asc(courses.title), asc(courseItems.position))
    .all();

  const allRows = rows.map((r) => [r.student, r.course, r.task]);
  const alumnos = countDistinct(rows.map((r) => r.studentId));
  const donde = courseLabel(scope, courseId);
  const nombres = fewNames(allRows);

  return toResult({
    tiles: [tile("Pendientes", rows.length), tile("Alumnos", alumnos)],
    columns: ["Alumno", "Curso", "Tarea"],
    allRows,
    forModel:
      rows.length === 0
        ? `No hay tareas sin entregar${donde}.`
        : `Sin entregar${donde}: ${rows.length} tareas de ${alumnos} alumnos.${nombres ? ` ${nombres}.` : ""}`,
  });
}

/**
 * El intento calificado MÁS RECIENTE de cada alumno en cada examen: si luego
 * lo repitió y pasó, ya no está reprobado.
 *
 * OJO: en subconsultas correlacionadas la columna externa va calificada a mano
 * («"exam_attempts"."student_id"»), como en latestCycleOnly.
 */
const latestGradedAttempt = sql`NOT EXISTS (
  SELECT 1 FROM exam_attempts a2
   WHERE a2.student_id = "exam_attempts"."student_id"
     AND a2.exam_item_id = "exam_attempts"."exam_item_id"
     AND a2.status = 'graded'
     AND (
       IFNULL(a2.submitted_at, 0) > IFNULL("exam_attempts"."submitted_at", 0)
       OR (IFNULL(a2.submitted_at, 0) = IFNULL("exam_attempts"."submitted_at", 0)
           AND a2.id > "exam_attempts"."id")
     )
)`;

/** Quien no llegó al mínimo del examen. Un examen sin mínimo no cuenta. */
function reprobados(scope: ViewScope, courseId: string | null): QueryResult {
  const rows = db
    .select({
      studentId: users.id,
      student: users.fullName,
      course: courses.title,
      exam: courseItems.title,
      score: examAttempts.finalScore,
      max: examAttempts.maxScoreSnapshot,
      pass: exams.passScore,
    })
    .from(examAttempts)
    .innerJoin(exams, eq(examAttempts.examItemId, exams.itemId))
    .innerJoin(courseItems, eq(exams.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(examAttempts.studentId, users.id))
    .where(
      and(
        eq(examAttempts.status, "graded"),
        isNotNull(exams.passScore),
        isNotNull(examAttempts.finalScore),
        sql`${examAttempts.maxScoreSnapshot} > 0`,
        sql`(${examAttempts.finalScore} * 100.0 / ${examAttempts.maxScoreSnapshot}) < ${exams.passScore}`,
        latestGradedAttempt,
        ...courseFilters(scope, courseId)
      )
    )
    .orderBy(asc(users.fullName), asc(courses.title), asc(courseItems.title))
    .all();

  const allRows = rows.map((r) => [
    r.student,
    r.course,
    r.exam,
    `${fmtNumber(percent(r.score, r.max))}% (mínimo ${fmtNumber(r.pass)}%)`,
  ]);
  const alumnos = countDistinct(rows.map((r) => r.studentId));
  const donde = courseLabel(scope, courseId);
  const nombres = fewNames(allRows);

  return toResult({
    tiles: [tile("Reprobados", rows.length), tile("Alumnos", alumnos)],
    columns: ["Alumno", "Curso", "Examen", "Puntaje"],
    allRows,
    forModel:
      rows.length === 0
        ? `Nadie quedó por debajo del mínimo${donde}.`
        : `Reprobados${donde}: ${rows.length} exámenes de ${alumnos} alumnos.${nombres ? ` ${nombres}.` : ""}`,
  });
}

// ─── Certificados ────────────────────────────────────────────────────────────

export type CertificadoEstado = "emitidos" | "por_vencer" | "vencidos";

/** Ventana de «por vencer»: 30 días por defecto, 365 como mucho. */
function clampDays(dias: number): number {
  if (!Number.isFinite(dias) || dias <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.round(dias));
}

/**
 * Certificados del contexto. No incluye los revocados: un certificado anulado
 * ni está emitido ni hay que renovarlo.
 *
 * No usa `listRenewals`: ese es el panel de vencimientos (solo el ciclo
 * vigente, solo lo que sigue «pendiente» y con una ventana fija). Aquí la
 * persona pregunta por los certificados tal cual, con los días que ella diga.
 */
export function certificadosQuery(
  scope: ViewScope,
  estado: CertificadoEstado,
  courseId: string | null,
  dias: number
): QueryResult {
  const days = clampDays(dias);
  const now = new Date();
  const horizon = new Date(now.getTime() + days * DAY_MS);
  const filters = [...courseFilters(scope, courseId), eq(certificates.revoked, false)];

  // NULL en expires_at = vitalicio: no entra ni en «por vencer» ni en «vencidos»
  const porVencerCond = and(gte(certificates.expiresAt, now), lte(certificates.expiresAt, horizon))!;
  const vencidosCond = lt(certificates.expiresAt, now);
  const estadoCond = estado === "por_vencer" ? porVencerCond : estado === "vencidos" ? vencidosCond : undefined;

  const count = (cond?: SQL) =>
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .where(and(...filters, cond))
      .get()?.n ?? 0;

  const order =
    estado === "por_vencer"
      ? [asc(certificates.expiresAt)]
      : estado === "vencidos"
        ? [desc(certificates.expiresAt)]
        : [desc(certificates.issuedAt)];

  const rows = db
    .select({
      student: users.fullName,
      course: courses.title,
      folio: certificates.folio,
      issuedAt: certificates.issuedAt,
      expiresAt: certificates.expiresAt,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .innerJoin(users, eq(certificates.studentId, users.id))
    .where(and(...filters, estadoCond))
    .orderBy(...order, asc(users.fullName))
    .all();

  const allRows = rows.map((r) => [
    r.student,
    r.course,
    r.folio,
    fmtDate(r.issuedAt),
    r.expiresAt ? fmtDate(r.expiresAt) : "no vence",
  ]);
  const donde = courseLabel(scope, courseId);
  const nombres = fewNames(allRows);
  const emitidos = count();
  const porVencer = count(porVencerCond);
  const vencidos = count(vencidosCond);
  const titulo =
    estado === "por_vencer"
      ? `Certificados por vencer en los próximos ${days} días`
      : estado === "vencidos"
        ? "Certificados vencidos"
        : "Certificados emitidos";

  return toResult({
    tiles: [tile("Emitidos", emitidos), tile(`Vencen en ${days} días`, porVencer), tile("Vencidos", vencidos)],
    columns: ["Alumno", "Curso", "Folio", "Emitido", "Vence"],
    allRows,
    forModel: `${titulo}${donde}: ${rows.length}. En total ${emitidos} emitidos, ${porVencer} por vencer en ${days} días y ${vencidos} vencidos.${nombres ? ` Alumnos: ${nombres}.` : ""}`,
  });
}

// ─── Panorama ────────────────────────────────────────────────────────────────

/**
 * Una fila por maestro activo: cursos, alumnos visibles, certificados y cuándo
 * entró por última vez. Es la vista del administrador, así que no lleva
 * contexto: siempre son todos.
 *
 * «Alumnos» es la suma de la columna, con la MISMA regla que las listas
 * (`visibleStudentCountsByOwner`): un alumno que toma cursos con dos maestros
 * cuenta en los dos, porque a los dos les aparece.
 */
export function panoramaQuery(): QueryResult {
  const teachers = db
    .select({ id: users.id, name: users.fullName, last: users.lastLoginAt })
    .from(users)
    .where(and(eq(users.role, "teacher"), eq(users.active, true)))
    .all();

  const courseCounts = new Map(
    db
      .select({ ownerId: courses.ownerId, n: sql<number>`COUNT(*)` })
      .from(courses)
      .groupBy(courses.ownerId)
      .all()
      .map((r) => [r.ownerId, r.n] as const)
  );

  const certCounts = new Map(
    db
      .select({ ownerId: courses.ownerId, n: sql<number>`COUNT(*)` })
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .where(eq(certificates.revoked, false))
      .groupBy(courses.ownerId)
      .all()
      .map((r) => [r.ownerId, r.n] as const)
  );

  const studentCounts = visibleStudentCountsByOwner();

  const filas = teachers
    .map((t) => ({
      name: t.name,
      last: t.last,
      cursos: courseCounts.get(t.id) ?? 0,
      alumnos: studentCounts.get(t.id) ?? 0,
      certificados: certCounts.get(t.id) ?? 0,
    }))
    // Los más cargados arriba: es lo que el administrador mira primero
    .sort((a, b) => b.alumnos - a.alumnos || b.cursos - a.cursos || a.name.localeCompare(b.name, "es"));

  const allRows = filas.map((f) => [
    f.name,
    String(f.cursos),
    String(f.alumnos),
    String(f.certificados),
    f.last ? fmtDate(f.last) : "nunca",
  ]);
  const totalCursos = filas.reduce((s, f) => s + f.cursos, 0);
  const totalAlumnos = filas.reduce((s, f) => s + f.alumnos, 0);
  const totalCerts = filas.reduce((s, f) => s + f.certificados, 0);
  const nombres = fewNames(allRows);

  return toResult({
    tiles: [
      tile("Maestros", filas.length),
      tile("Cursos", totalCursos),
      tile("Alumnos", totalAlumnos),
      tile("Certificados", totalCerts),
    ],
    columns: ["Maestro", "Cursos", "Alumnos", "Certificados", "Último acceso"],
    allRows,
    forModel:
      filas.length === 0
        ? "No hay maestros activos."
        : `Panorama: ${filas.length} maestros, ${totalCursos} cursos, ${totalAlumnos} alumnos y ${totalCerts} certificados.${nombres ? ` Con más alumnos: ${nombres}.` : ""}`,
  });
}
