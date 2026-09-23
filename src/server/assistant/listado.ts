import "server-only";
import { and, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { scopeOwnerId, type ViewScope } from "@/server/auth/view-scope";
import { studentVisibleCondition } from "@/server/services/student-scope";
import { latestCycleOnly } from "@/server/services/enrollment-scope";
import { linearOrder } from "@/server/services/tree";
import type { Cell, SheetSpec } from "@/server/services/xlsx";
import { certificates, cohorts, courses, enrollments, itemProgress, users } from "@/server/db/schema";
import {
  MAX_CSV_ROWS,
  courseFilters,
  courseLabel,
  fewNames,
  fmtDate,
  reprobadoKeys,
  sinEntrarCondition,
  tile,
  toResult,
  type QueryResult,
  type QueryTile,
} from "./queries";

/**
 * Listados a la medida: «dame la lista de X con estos filtros». Es la consulta
 * que devuelve FILAS; para cifras y resúmenes están `movimientos`,
 * `pendientes` y `certificados`.
 *
 * Reglas fijas, las mismas que el resto del asistente:
 * - Lo que se ve depende del contexto: `ownerCondition` sobre los cursos
 *   (dentro de `courseFilters`) y `studentVisibleCondition` sobre los alumnos.
 * - «Sin entrar» y «reprobados» NO se reescriben aquí: salen de
 *   `sinEntrarCondition` y `reprobadoKeys`, los mismos trozos que usa
 *   `pendientes`. Si cambia el criterio, cambia en los dos sitios a la vez.
 * - El avance es el de siempre (`courseProgress`): ítems requeridos completados
 *   entre ítems requeridos; en un curso sin requeridos, sobre los visibles.
 *   Aquí se calcula en bloque (una consulta por curso, no una por matrícula)
 *   porque una lista puede traer miles de filas.
 * - La IA recibe cifras, el filtro en palabras y como mucho 5 nombres: nunca
 *   correos ni la lista entera.
 */

export type ListadoDe = "alumnos" | "matriculas" | "certificados";
export type ListadoEstado = "activos" | "completados" | "bajas" | "sin_entrar" | "reprobados" | "todos";
export type ListadoCertificado = "si" | "no" | "da_igual";
export type ListadoOrden = "nombre" | "avance" | "reciente";

export type ListadoFiltros = {
  de: ListadoDe;
  courseId: string | null;
  /** Nombre del grupo; vacío = todos */
  grupo: string;
  estado: ListadoEstado;
  /** 0–100; solo cuentan en «matriculas» y «alumnos» */
  avanceMin: number | null;
  avanceMax: number | null;
  conCertificado: ListadoCertificado;
  /** Alta (alumnos), matrícula (matriculas) o emisión (certificados) */
  desde: Date | null;
  hasta: Date | null;
  orden: ListadoOrden;
};

/** Lo de siempre, más la hoja lista para `buildXlsx`. */
export type ListadoResult = QueryResult & { sheet: SheetSpec };

/** Tope de filas que se sacan de la base antes de filtrar en memoria. */
const MAX_SQL_ROWS = 20_000;

const DE_LABEL: Record<ListadoDe, string> = {
  alumnos: "alumnos",
  matriculas: "matrículas",
  certificados: "certificados",
};

const ESTADO_LABEL: Record<ListadoEstado, string> = {
  activos: "activos",
  completados: "completados",
  bajas: "bajas",
  sin_entrar: "sin entrar",
  reprobados: "reprobados",
  todos: "todos",
};

/** Estados que no dicen nada de un certificado: no filtran y se avisa. */
const SIN_SENTIDO_EN_CERTIFICADOS: ListadoEstado[] = ["completados", "sin_entrar", "reprobados"];

// ─── Avance ──────────────────────────────────────────────────────────────────

/**
 * Avance de cada matrícula con la MISMA fórmula que `courseProgress`, pero en
 * bloque: una consulta por curso. La matrícula que no sale del mapa va a 0 %
 * (ningún ítem terminado).
 */
function percentByEnrollment(courseIds: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const courseId of new Set(courseIds)) {
    const order = linearOrder(courseId).filter((i) => i.visible);
    const required = order.filter((i) => i.requiredForCompletion);
    // Igual que `courseProgress`: un curso 100 % opcional se mide con sus
    // ítems visibles, para que no se quede en 0 % eterno
    const base = required.length > 0 ? required : order;
    if (base.length === 0) continue;
    const ids = base.map((i) => i.id);
    const rows = db
      .select({ enrollmentId: itemProgress.enrollmentId, n: sql<number>`COUNT(*)` })
      .from(itemProgress)
      .innerJoin(enrollments, eq(itemProgress.enrollmentId, enrollments.id))
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(itemProgress.status, "completed"),
          inArray(itemProgress.itemId, ids)
        )
      )
      .groupBy(itemProgress.enrollmentId)
      .all();
    for (const r of rows) out.set(r.enrollmentId, Math.round((r.n / base.length) * 100));
  }
  return out;
}

// ─── Trozos de SQL comunes ───────────────────────────────────────────────────

/**
 * Certificado VIGENTE de esa matrícula: ni revocado ni vencido (sin fecha de
 * vencimiento = vitalicio, que también es vigente).
 *
 * OJO: en subconsultas correlacionadas la columna externa va calificada a mano
 * («"enrollments"."id"»), como en latestCycleOnly.
 */
function certVigenteDeMatricula(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM certificates c2
     WHERE c2.enrollment_id = "enrollments"."id"
       AND c2.revoked = 0
       AND (c2.expires_at IS NULL OR c2.expires_at >= ${Date.now()})
  )`;
}

/**
 * «Los cursos del contexto» dentro de una subconsulta, sobre el alias `c`. Es
 * la misma regla que `ownerCondition` (de hecho sale del mismo `scopeOwnerId`),
 * escrita a mano porque aquí no hay tabla que aliasar: sacar antes la lista de
 * ids obligaría a meter cientos de parámetros en un `IN`.
 */
function cursosEnSubconsulta(scope: ViewScope, courseId: string | null): SQL {
  const ownerId = scopeOwnerId(scope);
  const owner = ownerId === null ? sql`` : sql` AND c.owner_id = ${ownerId}`;
  return courseId ? sql`${owner} AND c.id = ${courseId}` : owner;
}

/** Certificado vigente del alumno («users») en alguno de los cursos del contexto. */
function certVigenteDeAlumno(scope: ViewScope, courseId: string | null): SQL {
  return sql`EXISTS (
    SELECT 1 FROM certificates ce JOIN courses c ON c.id = ce.course_id
     WHERE ce.student_id = "users"."id"
       AND ce.revoked = 0
       AND (ce.expires_at IS NULL OR ce.expires_at >= ${Date.now()})${cursosEnSubconsulta(scope, courseId)}
  )`;
}

/** Matrícula del alumno («users») en el contexto, con el estado y el grupo que se pidan. */
function matriculaDeAlumno(
  scope: ViewScope,
  f: ListadoFiltros,
  estado: "active" | "completed" | "dropped" | null
): SQL {
  const grupo = f.grupo
    ? sql` AND EXISTS (SELECT 1 FROM cohorts g WHERE g.id = e.cohort_id AND lower(g.name) = lower(${f.grupo}))`
    : sql``;
  const conEstado = estado ? sql` AND e.status = ${estado}` : sql``;
  return sql`EXISTS (
    SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.student_id = "users"."id"${conEstado}${grupo}${cursosEnSubconsulta(scope, f.courseId)}
  )`;
}

// ─── Forma común de una fila ─────────────────────────────────────────────────

type Fila = {
  /** Celdas de la tabla y del CSV */
  cells: string[];
  /** Las mismas celdas para el Excel (fechas y porcentajes de verdad) */
  sheet: Cell[];
  nombre: string;
  avance: number;
  cuando: number;
};

type Bloque = {
  columns: { title: string; width: number }[];
  filas: Fila[];
  tiles: QueryTile[];
  /** Filas del contexto SIN ningún filtro opcional */
  base: number;
};

const estiloDe = (mal: boolean, bien: boolean): Cell["style"] => (mal ? "bad" : bien ? "good" : undefined);

// ─── Matrículas ──────────────────────────────────────────────────────────────

function bloqueMatriculas(scope: ViewScope, f: ListadoFiltros): Bloque {
  const conds: SQL[] = [];
  if (f.grupo) conds.push(sql`lower(${cohorts.name}) = lower(${f.grupo})`);
  if (f.estado === "activos") conds.push(eq(enrollments.status, "active"));
  if (f.estado === "completados") conds.push(eq(enrollments.status, "completed"));
  if (f.estado === "bajas") conds.push(eq(enrollments.status, "dropped"));
  if (f.estado === "sin_entrar") conds.push(eq(enrollments.status, "active"), sinEntrarCondition());
  if (f.desde) conds.push(gte(enrollments.createdAt, f.desde));
  if (f.hasta) conds.push(lte(enrollments.createdAt, f.hasta));
  if (f.conCertificado === "si") conds.push(certVigenteDeMatricula());
  if (f.conCertificado === "no") conds.push(sql`NOT ${certVigenteDeMatricula()}`);

  const rows = db
    .select({
      enrollmentId: enrollments.id,
      studentId: users.id,
      student: users.fullName,
      email: users.email,
      courseId: courses.id,
      course: courses.title,
      grupo: cohorts.name,
      status: enrollments.status,
      enrolledAt: enrollments.createdAt,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .leftJoin(cohorts, eq(enrollments.cohortId, cohorts.id))
    .where(and(latestCycleOnly, studentVisibleCondition(scope), ...courseFilters(scope, f.courseId), ...conds))
    .limit(MAX_SQL_ROWS)
    .all();

  const base =
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .innerJoin(users, eq(enrollments.studentId, users.id))
      .where(and(latestCycleOnly, studentVisibleCondition(scope), ...courseFilters(scope, null)))
      .get()?.n ?? 0;

  const avances = percentByEnrollment(rows.map((r) => r.courseId));
  const reprobados = reprobadoKeys(scope, f.courseId);
  const ESTADO: Record<string, string> = { active: "activo", completed: "completado", dropped: "baja" };

  const filas: Fila[] = [];
  for (const r of rows) {
    const reprobado =
      reprobados.enrollments.has(r.enrollmentId) || reprobados.studentCourse.has(`${r.studentId}:${r.courseId}`);
    if (f.estado === "reprobados" && !reprobado) continue;
    // El avance de una baja es el que alcanzó a llevar: en una lista de bajas
    // poner 0 % a todos escondería justo lo que se quiere mirar
    const avance = avances.get(r.enrollmentId) ?? 0;
    if (f.avanceMin !== null && avance < f.avanceMin) continue;
    if (f.avanceMax !== null && avance > f.avanceMax) continue;

    const grupo = r.grupo ?? "";
    const estado = ESTADO[r.status] ?? r.status;
    const style = estiloDe(r.status === "dropped" || reprobado, r.status === "completed");
    filas.push({
      cells: [r.student, r.email, r.course, grupo, `${avance}%`, estado, fmtDate(r.enrolledAt), fmtDate(r.completedAt)],
      sheet: [
        { text: r.student, style },
        { text: r.email, style },
        { text: r.course, style },
        { text: grupo, style },
        { text: `${avance}%`, percent: avance / 100, style },
        { text: estado, style },
        { text: fmtDate(r.enrolledAt), date: r.enrolledAt, style },
        r.completedAt ? { text: fmtDate(r.completedAt), date: r.completedAt, style } : { text: "", style },
      ],
      nombre: r.student,
      avance,
      cuando: r.enrolledAt.getTime(),
    });
  }

  return {
    columns: [
      { title: "Alumno", width: 6.5 },
      { title: "Correo", width: 7 },
      { title: "Curso", width: 6 },
      { title: "Grupo", width: 4 },
      { title: "Avance", width: 3 },
      { title: "Estado", width: 3.5 },
      { title: "Matriculado", width: 3.5 },
      { title: "Completado", width: 3.5 },
    ],
    filas,
    tiles: [
      tile("Matrículas", filas.length),
      tile("De un total de", base),
      tile("Completadas", filas.filter((x) => x.cells[5] === "completado").length),
      tile("Bajas", filas.filter((x) => x.cells[5] === "baja").length),
    ],
    base,
  };
}

// ─── Alumnos ─────────────────────────────────────────────────────────────────

function bloqueAlumnos(scope: ViewScope, f: ListadoFiltros): Bloque {
  const conds: SQL[] = [];
  if (f.desde) conds.push(gte(users.createdAt, f.desde));
  if (f.hasta) conds.push(lte(users.createdAt, f.hasta));
  if (f.estado === "activos") conds.push(eq(users.active, true));
  if (f.estado === "completados") conds.push(matriculaDeAlumno(scope, f, "completed"));
  if (f.estado === "bajas") conds.push(matriculaDeAlumno(scope, f, "dropped"));
  // Mismo criterio que `pendientes: sin_entrar`: sin acceso reciente Y con
  // alguna matrícula activa (a quien no está en ningún curso no se le espera)
  if (f.estado === "sin_entrar") conds.push(sinEntrarCondition(), matriculaDeAlumno(scope, f, "active"));
  // El curso y el grupo solo hacen falta aparte cuando el estado no trajo ya su
  // propia matrícula: si no, se pediría una matrícula del grupo y OTRA con ese
  // estado, que podrían ser dos distintas
  const estadoTraeMatricula = f.estado === "completados" || f.estado === "bajas" || f.estado === "sin_entrar";
  if (!estadoTraeMatricula && (f.courseId || f.grupo)) conds.push(matriculaDeAlumno(scope, f, null));
  if (f.conCertificado === "si") conds.push(certVigenteDeAlumno(scope, f.courseId));
  if (f.conCertificado === "no") conds.push(sql`NOT ${certVigenteDeAlumno(scope, f.courseId)}`);

  const rows = db
    .select({
      id: users.id,
      name: users.fullName,
      email: users.email,
      active: users.active,
      last: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(studentVisibleCondition(scope), ...conds))
    .limit(MAX_SQL_ROWS)
    .all();

  const base = db.select({ n: sql<number>`COUNT(*)` }).from(users).where(studentVisibleCondition(scope)).get()?.n ?? 0;

  // Matrículas vigentes del contexto: cuántos cursos lleva y su avance medio
  const matriculas = db
    .select({
      enrollmentId: enrollments.id,
      studentId: enrollments.studentId,
      courseId: enrollments.courseId,
      status: enrollments.status,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(and(latestCycleOnly, ne(enrollments.status, "dropped"), ...courseFilters(scope, f.courseId)))
    .all();

  const avances = percentByEnrollment(matriculas.map((m) => m.courseId));
  const porAlumno = new Map<string, { cursos: number; suma: number; completados: number }>();
  for (const m of matriculas) {
    const acc = porAlumno.get(m.studentId) ?? { cursos: 0, suma: 0, completados: 0 };
    acc.cursos++;
    acc.suma += avances.get(m.enrollmentId) ?? 0;
    if (m.status === "completed") acc.completados++;
    porAlumno.set(m.studentId, acc);
  }
  const reprobados = reprobadoKeys(scope, f.courseId);

  const filas: Fila[] = [];
  for (const r of rows) {
    const acc = porAlumno.get(r.id);
    const cursos = acc?.cursos ?? 0;
    // Un decimal: la media de tres cursos redondeada a entero miente demasiado
    const avance = acc && cursos > 0 ? Math.round((acc.suma / cursos) * 10) / 10 : 0;
    const reprobado = reprobados.students.has(r.id);
    if (f.estado === "reprobados" && !reprobado) continue;
    if (f.avanceMin !== null && avance < f.avanceMin) continue;
    if (f.avanceMax !== null && avance > f.avanceMax) continue;

    const estado = r.active ? "activo" : "deshabilitado";
    const acceso = r.last ? fmtDate(r.last) : "nunca";
    const style = estiloDe(!r.active || reprobado, (acc?.completados ?? 0) > 0);
    filas.push({
      cells: [r.name, r.email, String(cursos), `${avance}%`, acceso, estado],
      sheet: [
        { text: r.name, style },
        { text: r.email, style },
        { text: String(cursos), number: cursos, style },
        { text: `${avance}%`, percent: avance / 100, style },
        r.last ? { text: acceso, date: r.last, style } : { text: acceso, style },
        { text: estado, style },
      ],
      nombre: r.name,
      avance,
      cuando: r.createdAt.getTime(),
    });
  }

  return {
    columns: [
      { title: "Nombre", width: 6.5 },
      { title: "Correo", width: 7 },
      { title: "Cursos", width: 2.5 },
      { title: "Avance medio", width: 3.5 },
      { title: "Último acceso", width: 3.5 },
      { title: "Estado", width: 3.5 },
    ],
    filas,
    tiles: [
      tile("Alumnos", filas.length),
      tile("De un total de", base),
      tile("Activos", filas.filter((x) => x.cells[5] === "activo").length),
      tile("Deshabilitados", filas.filter((x) => x.cells[5] === "deshabilitado").length),
    ],
    base,
  };
}

// ─── Certificados ────────────────────────────────────────────────────────────

function bloqueCertificados(scope: ViewScope, f: ListadoFiltros): Bloque {
  const ahora = new Date();
  const conds: SQL[] = [];
  if (f.grupo) conds.push(sql`lower(${cohorts.name}) = lower(${f.grupo})`);
  // Aquí «activos» son los vigentes y «bajas» los revocados; los demás estados
  // no dicen nada de un certificado y no filtran (el texto de la IA lo avisa)
  if (f.estado === "activos") {
    conds.push(eq(certificates.revoked, false));
    conds.push(or(isNull(certificates.expiresAt), gte(certificates.expiresAt, ahora))!);
  }
  if (f.estado === "bajas") conds.push(eq(certificates.revoked, true));
  if (f.desde) conds.push(gte(certificates.issuedAt, f.desde));
  if (f.hasta) conds.push(lte(certificates.issuedAt, f.hasta));

  const rows = db
    .select({
      student: users.fullName,
      course: courses.title,
      folio: certificates.folio,
      issuedAt: certificates.issuedAt,
      expiresAt: certificates.expiresAt,
      revoked: certificates.revoked,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .innerJoin(users, eq(certificates.studentId, users.id))
    .leftJoin(enrollments, eq(certificates.enrollmentId, enrollments.id))
    .leftJoin(cohorts, eq(enrollments.cohortId, cohorts.id))
    .where(and(studentVisibleCondition(scope), ...courseFilters(scope, f.courseId), ...conds))
    .limit(MAX_SQL_ROWS)
    .all();

  const base =
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .where(and(...courseFilters(scope, null)))
      .get()?.n ?? 0;

  const filas = rows.map((r): Fila => {
    const vencido = !!r.expiresAt && r.expiresAt.getTime() < ahora.getTime();
    const estado = r.revoked ? "revocado" : vencido ? "vencido" : "vigente";
    const vence = r.expiresAt ? fmtDate(r.expiresAt) : "no vence";
    const style = estiloDe(r.revoked || vencido, !r.revoked && !vencido);
    return {
      cells: [r.student, r.course, r.folio, fmtDate(r.issuedAt), vence, estado],
      sheet: [
        { text: r.student, style },
        { text: r.course, style },
        { text: r.folio, style },
        { text: fmtDate(r.issuedAt), date: r.issuedAt, style },
        r.expiresAt ? { text: vence, date: r.expiresAt, style } : { text: vence, style },
        { text: estado, style },
      ],
      nombre: r.student,
      avance: 0,
      cuando: r.issuedAt.getTime(),
    };
  });

  return {
    columns: [
      { title: "Alumno", width: 6.5 },
      { title: "Curso", width: 6 },
      { title: "Folio", width: 5 },
      { title: "Emitido", width: 3.5 },
      { title: "Vence", width: 3.5 },
      { title: "Estado", width: 3.5 },
    ],
    filas,
    tiles: [
      tile("Certificados", filas.length),
      tile("De un total de", base),
      tile("Vigentes", filas.filter((x) => x.cells[5] === "vigente").length),
      tile("Vencidos", filas.filter((x) => x.cells[5] === "vencido").length),
    ],
    base,
  };
}

// ─── El filtro en palabras ───────────────────────────────────────────────────

function filtroEnPalabras(f: ListadoFiltros, donde: string): string {
  const partes: string[] = [];
  if (donde) partes.push(donde.trim());
  if (f.grupo) partes.push(`grupo «${f.grupo}»`);
  if (f.estado !== "todos") partes.push(ESTADO_LABEL[f.estado]);
  if (f.avanceMin !== null || f.avanceMax !== null) {
    partes.push(`avance ${f.avanceMin ?? 0}–${f.avanceMax ?? 100} %`);
  }
  if (f.conCertificado === "si") partes.push("con certificado vigente");
  if (f.conCertificado === "no") partes.push("sin certificado vigente");
  if (f.desde) partes.push(`desde ${fmtDate(f.desde)}`);
  if (f.hasta) partes.push(`hasta ${fmtDate(f.hasta)}`);
  return partes.length === 0 ? "sin filtros" : partes.join(", ");
}

// ─── La consulta ─────────────────────────────────────────────────────────────

/**
 * La lista pedida, en tabla + CSV + hoja de Excel. El orden por avance va de
 * MAYOR a menor (quien más lleva, arriba); «reciente» pone lo más nuevo
 * primero, y a igualdad manda el nombre.
 */
export function listadoQuery(scope: ViewScope, f: ListadoFiltros): ListadoResult {
  const bloque =
    f.de === "alumnos"
      ? bloqueAlumnos(scope, f)
      : f.de === "certificados"
        ? bloqueCertificados(scope, f)
        : bloqueMatriculas(scope, f);

  const porNombre = (a: Fila, b: Fila) => a.nombre.localeCompare(b.nombre, "es");
  if (f.orden === "avance") bloque.filas.sort((a, b) => b.avance - a.avance || porNombre(a, b));
  else if (f.orden === "reciente") bloque.filas.sort((a, b) => b.cuando - a.cuando || porNombre(a, b));
  else bloque.filas.sort(porNombre);

  // Tope duro: lo que pase de 5 000 filas no entra ni en el CSV ni en el Excel
  const filas = bloque.filas.slice(0, MAX_CSV_ROWS);
  const allRows = filas.map((x) => x.cells);
  const donde = courseLabel(scope, f.courseId);
  const filtro = filtroEnPalabras(f, donde);
  const nombres = fewNames(allRows);
  const nota =
    f.de === "certificados" && SIN_SENTIDO_EN_CERTIFICADOS.includes(f.estado)
      ? ` El estado «${ESTADO_LABEL[f.estado]}» no aplica a certificados: salen todos.`
      : "";

  const result = toResult({
    tiles: bloque.tiles,
    columns: bloque.columns.map((c) => c.title),
    allRows,
    forModel:
      filas.length === 0
        ? `Listado de ${DE_LABEL[f.de]} (${filtro}): ninguna de las ${bloque.base} filas del contexto pasa el filtro.${nota}`
        : `Listado de ${DE_LABEL[f.de]} (${filtro}): ${filas.length} de ${bloque.base}.${nota}${nombres ? ` ${nombres}.` : ""}`,
  });

  return {
    ...result,
    sheet: {
      name: `Listado de ${DE_LABEL[f.de]}`,
      columns: bloque.columns,
      rows: filas.map((x) => x.sheet),
      notes: [`Filtro: ${filtro}.`, `${filas.length} de ${bloque.base} ${DE_LABEL[f.de]} del contexto.`],
    },
  };
}
