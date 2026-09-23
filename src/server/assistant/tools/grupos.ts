import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { enrollments, users } from "@/server/db/schema";
import { fullScope } from "@/server/auth/view-scope";
import { audit } from "@/server/services/audit";
import {
  assignEnrollmentsToCohort,
  canManageCohort,
  cohortOptions,
  cohortStudentIds,
  createCohort,
  deleteCohort,
  findCohortByName,
  findOrCreateCohort,
  getCohort,
  listCohorts,
  renameCohort,
  setCohortStatus,
  type Cohort,
} from "@/server/services/cohorts";
import { getOwnedCourse } from "@/server/services/courses";
import { isStudentVisible } from "@/server/services/student-scope";
import type { AssistantBlock, ProposalRow } from "@/lib/assistant-blocks";
import { createProposal } from "../proposal-store";
import {
  schema,
  str,
  strEnum,
  strList,
  param,
  paramList,
  type AssistantTool,
  type ToolCtx,
  type ToolResult,
} from "../tool-types";

/**
 * Grupos (oleadas) de un curso: listarlos, crear uno, mover alumnos,
 * renombrarlo, cerrarlo, reabrirlo o borrarlo. Los grupos son PROPIOS de cada
 * curso, así que todo empieza por el curso y siempre se comprueba que sea del
 * usuario.
 *
 * Mover a un solo alumno se hace al momento y se puede deshacer (vuelve al
 * grupo donde estaba, que puede ser ninguno); mover a varios pasa por la tabla
 * de revisión. Mover a un grupo que todavía no existe lo crea al vuelo, igual
 * que la pantalla de Grupos, y se dice con todas las letras. Un grupo CERRADO
 * no admite movimientos: meter gente ahí la escondería de las vistas diarias,
 * así que se dice y se ofrece reabrirlo. Borrar es irreversible, así que pasa
 * por revisión y hay que escribir ELIMINAR.
 */

type Curso = { id: string; title: string };

// Todo lo de la tabla viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "alumno", label: "Alumno", editable: false },
  { key: "correo", label: "Correo", editable: false },
  { key: "grupo_actual", label: "Grupo actual", editable: false },
];

// Borrar un grupo no es cosa de alumnos: una fila con el grupo y a cuántos deja sin etiqueta
const COLUMNS_BORRAR = [
  { key: "grupo", label: "Grupo", editable: false },
  { key: "alumnos", label: "Alumnos que se quedan sin grupo", editable: false },
];

const SIN_GRUPO = "Sin grupo";

function enlaces(courseId: string): AssistantBlock {
  return {
    type: "links",
    links: [
      { label: "Ver grupos", href: "/teach/groups", icon: "page" },
      { label: "Ver alumnos del curso", href: `/teach/courses/${courseId}/students`, icon: "user" },
    ],
  };
}

function estadoTexto(status: "open" | "closed"): string {
  return status === "closed" ? "cerrado" : "abierto";
}

type Alumno = { id: string; fullName: string; email: string };

function alumnosPorId(ids: string[]): Map<string, Alumno> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.role, "student")))
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

type Matricula = { enrollmentId: string; status: string; cohortId: string | null };

/** Matrícula vigente (ciclo más reciente) de cada alumno en el curso, en una consulta. */
function matriculasDe(courseId: string, studentIds: string[]): Map<string, Matricula> {
  if (studentIds.length === 0) return new Map();
  const rows = db
    .select({
      id: enrollments.id,
      studentId: enrollments.studentId,
      status: enrollments.status,
      cohortId: enrollments.cohortId,
    })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), inArray(enrollments.studentId, studentIds)))
    .orderBy(desc(enrollments.cycle))
    .all();
  const map = new Map<string, Matricula>();
  // Viene ordenado por ciclo descendente: la primera fila de cada alumno es la vigente
  for (const r of rows) {
    if (!map.has(r.studentId)) map.set(r.studentId, { enrollmentId: r.id, status: r.status, cohortId: r.cohortId });
  }
  return map;
}

/** Matrículas apuntando al grupo, incluidas las bajas (borrarlo las dejaría sin grupo). */
function matriculasEnGrupo(cohortId: string): number {
  return (
    db.select({ n: sql<number>`COUNT(*)` }).from(enrollments).where(eq(enrollments.cohortId, cohortId)).get()?.n ?? 0
  );
}

/** Una fila de revisión por alumno, con la matrícula que habría que mover. */
type Fila = { row: ProposalRow; enrollmentId: string; cohortAnterior: string | null };

/** `cohortId` en null = el grupo todavía no existe: nadie puede estar ya dentro. */
function filasMover(studentIds: string[], courseId: string, cohortId: string | null, ctx: ToolCtx): Fila[] {
  const alumnos = alumnosPorId(studentIds);
  const matriculas = matriculasDe(courseId, studentIds);
  const nombres = new Map(cohortOptions(courseId, { includeClosed: true }).map((c) => [c.id, c.name]));
  const scope = fullScope(ctx.user);
  return studentIds.map((id) => {
    const alumno = alumnos.get(id);
    const matricula = matriculas.get(id);
    const base = { enrollmentId: matricula?.enrollmentId ?? "", cohortAnterior: matricula?.cohortId ?? null };
    const grupoActual = matricula?.cohortId ? (nombres.get(matricula.cohortId) ?? "Otro grupo") : SIN_GRUPO;
    if (!alumno) {
      return { ...base, row: { id, cells: { alumno: "(desconocido)", correo: id, grupo_actual: "" }, warning: "No existe ese alumno", blocked: true } };
    }
    const cells = { alumno: alumno.fullName, correo: alumno.email, grupo_actual: grupoActual };
    if (!isStudentVisible(scope, id)) return { ...base, row: { id, cells, warning: "No es uno de tus alumnos", blocked: true } };
    if (!matricula || matricula.status === "dropped") {
      return { ...base, row: { id, cells: { ...cells, grupo_actual: SIN_GRUPO }, warning: "No está matriculado en este curso", blocked: true } };
    }
    // Ojo: sin grupo de destino (todavía no existe) nadie puede estar ya dentro, aunque los dos sean null
    if (cohortId !== null && matricula.cohortId === cohortId) {
      return { ...base, row: { id, cells, warning: "Ya está en ese grupo", blocked: true } };
    }
    return { ...base, row: { id, cells } };
  });
}

type Grupo = { id: string; name: string; status: "open" | "closed" };

/** Grupo del curso con ese nombre. El nombre inválido lo rechaza el servicio. */
function buscarGrupo(courseId: string, nombre: string): { grupo: Grupo | null } | { error: string } {
  try {
    return { grupo: findCohortByName(courseId, nombre) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Ese nombre de grupo no es válido." };
  }
}

function registrar(ctx: ToolCtx, accion: string, cohortId: string, detalle: Record<string, unknown> = {}) {
  audit(ctx.user.id, "assistant_grupos", "cohorts", cohortId, {
    accion,
    via: "assistant",
    conversationId: ctx.conversationId,
    ...detalle,
  });
}

function listar(course: Curso, ctx: ToolCtx): ToolResult {
  const grupos = listCohorts(fullScope(ctx.user), { courseId: course.id, status: "all" });
  if (grupos.length === 0) {
    return {
      forModel: `${course.title} no tiene ningún grupo todavía. Se puede crear uno con la acción «crear».`,
      blocks: [enlaces(course.id)],
    };
  }
  const resumen = grupos.map((g) => `«${g.name}» ${g.enrollmentCount} alumno(s), ${estadoTexto(g.status)}`).join("; ");
  return {
    forModel: `${course.title}: ${grupos.length} grupo(s). ${resumen}.`,
    blocks: [
      {
        type: "table",
        columns: ["Grupo", "Alumnos", "Estado"],
        rows: grupos.map((g) => [g.name, String(g.enrollmentCount), estadoTexto(g.status)]),
      },
      enlaces(course.id),
    ],
  };
}

function crear(course: Curso, nombre: string, ctx: ToolCtx): ToolResult {
  const encontrado = buscarGrupo(course.id, nombre);
  if ("error" in encontrado) return { forModel: encontrado.error };
  if (encontrado.grupo) {
    return {
      forModel: `Ya existe el grupo «${encontrado.grupo.name}» en ${course.title} (${estadoTexto(encontrado.grupo.status)}); no creé ninguno.`,
    };
  }
  let cohort: Cohort;
  try {
    cohort = createCohort(course.id, nombre, ctx.user.id);
  } catch (err) {
    return { forModel: err instanceof Error ? err.message : "No se pudo crear el grupo." };
  }
  registrar(ctx, "crear", cohort.id, { courseId: course.id, nombre: cohort.name });
  const text = `Grupo creado: «${cohort.name}» en ${course.title}. Está vacío: aún no tiene alumnos.`;
  return {
    forModel: text,
    blocks: [{ type: "result", text, undoable: true }, enlaces(course.id)],
    undo: { tool: "grupos", params: { accion: "crear", grupo_id: cohort.id } },
  };
}

function renombrar(course: Curso, cohort: Grupo, nuevo: string, ctx: ToolCtx): ToolResult {
  const anterior = cohort.name;
  try {
    renameCohort(cohort.id, nuevo, ctx.user.id);
  } catch (err) {
    return { forModel: err instanceof Error ? err.message : "No se pudo renombrar el grupo." };
  }
  const ahora = getCohort(cohort.id)?.name ?? nuevo;
  registrar(ctx, "renombrar", cohort.id, { courseId: course.id, anterior, nombre: ahora });
  const text = `El grupo «${anterior}» de ${course.title} ahora se llama «${ahora}».`;
  return {
    forModel: text,
    blocks: [{ type: "result", text, undoable: true }, enlaces(course.id)],
    undo: { tool: "grupos", params: { accion: "renombrar", grupo_id: cohort.id, nombre_anterior: anterior } },
  };
}

function cambiarEstado(
  course: Curso,
  cohort: Grupo,
  accion: "cerrar" | "reabrir",
  ctx: ToolCtx
): ToolResult {
  const destino = accion === "cerrar" ? "closed" : "open";
  if (cohort.status === destino) {
    return { forModel: `El grupo «${cohort.name}» de ${course.title} ya estaba ${estadoTexto(cohort.status)}; no cambié nada.` };
  }
  setCohortStatus(cohort.id, destino, ctx.user.id);
  registrar(ctx, accion, cohort.id, { courseId: course.id, nombre: cohort.name, anterior: cohort.status });
  const alumnos = cohortStudentIds(cohort.id).length;
  const text =
    accion === "cerrar"
      ? `Grupo «${cohort.name}» cerrado (${alumnos} alumno(s)). Sale de las vistas diarias; no se borró nada.`
      : `Grupo «${cohort.name}» reabierto (${alumnos} alumno(s)). Vuelve a las vistas diarias.`;
  return {
    forModel: text,
    blocks: [{ type: "result", text, undoable: true }, enlaces(course.id)],
    undo: { tool: "grupos", params: { accion, grupo_id: cohort.id, estado_anterior: cohort.status } },
  };
}

/**
 * Mueve alumnos al grupo. `cohort` en null = el nombre todavía no existe en el
 * curso: se crea al vuelo (como en la pantalla de Grupos), pero solo cuando de
 * verdad hay a quién mover, para no dejar grupos vacíos por el camino.
 */
function mover(
  course: Curso,
  cohort: Grupo | null,
  nombre: string,
  studentIds: string[],
  ctx: ToolCtx
): ToolResult {
  if (studentIds.length === 0) return { forModel: "No me diste a quién mover: pásame los alumno_ids (de buscar_alumno)." };
  if (cohort?.status === "closed") {
    return {
      forModel: `El grupo «${cohort.name}» de ${course.title} está cerrado y no admite movimientos: quien entre ahí desaparece de las vistas diarias. Pregúntale al usuario si quiere que lo reabra (acción «reabrir») y no muevas a nadie hasta que lo diga.`,
    };
  }
  const destino = cohort?.name ?? nombre;
  const filas = filasMover(studentIds, course.id, cohort?.id ?? null, ctx);

  // Uno solo: no hay nada que revisar y volver atrás es un clic
  if (filas.length === 1) {
    const [fila] = filas;
    if (fila.row.blocked) return { forModel: `No se pudo mover: ${fila.row.warning}.` };
    let cohortId = cohort?.id ?? "";
    if (!cohort) {
      try {
        cohortId = findOrCreateCohort(course.id, nombre, ctx.user.id);
      } catch (err) {
        return { forModel: err instanceof Error ? err.message : "No se pudo crear el grupo; no moví a nadie." };
      }
    }
    // El nombre bueno es el del grupo, no el que escribió la IA (mayúsculas, espacios)
    const real = getCohort(cohortId)?.name ?? destino;
    assignEnrollmentsToCohort([fila.enrollmentId], cohortId);
    registrar(ctx, "mover", cohortId, { courseId: course.id, nombre: real, alumnos: 1, grupoCreado: !cohort });
    const anterior = fila.row.cells.grupo_actual === SIN_GRUPO ? "sin grupo" : `«${fila.row.cells.grupo_actual}»`;
    const text = cohort
      ? `${fila.row.cells.alumno} pasó de ${anterior} al grupo «${real}» de ${course.title}.`
      : `Creé el grupo «${real}» y moví a 1 alumno en ${course.title}: ${fila.row.cells.alumno} (antes ${anterior}).`;
    return {
      forModel: text,
      blocks: [{ type: "result", text, undoable: true }, enlaces(course.id)],
      undo: {
        tool: "grupos",
        params: {
          accion: "mover",
          curso_id: course.id,
          alumno_id: fila.row.id,
          grupo_anterior_id: fila.cohortAnterior ?? "",
          // Si el grupo nació con este movimiento, deshacer también lo borra
          grupo_creado_id: cohort ? "" : cohortId,
        },
      },
    };
  }

  const rows = filas.map((f) => f.row);
  const proposalId = createProposal("grupos", ctx, ctx.messageId, {
    title: `Mover al grupo «${destino}» de ${course.title}`,
    applyLabel: "Mover",
    columns: COLUMNS,
    rows,
    payload: {
      accion: "mover",
      courseId: course.id,
      courseTitle: course.title,
      // Sin id: el grupo se crea al aplicar, no al proponer (cancelar no deja grupos vacíos)
      cohortId: cohort?.id ?? "",
      cohortName: destino,
    },
  });
  // La IA solo ve cuántas son: los nombres y correos se quedan en la tabla
  const ok = rows.filter((r) => !r.blocked).length;
  const bloqueadas = rows.length - ok;
  const partes = [`Se creó una propuesta con ${rows.length} fila(s): ${ok} lista(s) para pasar al grupo «${destino}»`];
  if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (no es tu alumno, no está matriculado o ya está en ese grupo)`);
  if (!cohort) partes.push(`el grupo «${destino}» todavía no existe en ${course.title}: lo crearé al aplicar`);
  return { forModel: `${partes.join("; ")}. El usuario revisará la tabla.`, proposalId };
}

/**
 * Borrar el grupo es irreversible (las matrículas se quedan sin etiqueta, no
 * se dan de baja), así que va por revisión y hay que escribir ELIMINAR, igual
 * que en la pantalla de Grupos.
 */
function borrar(course: Curso, cohort: Grupo, ctx: ToolCtx): ToolResult {
  const alumnos = cohortStudentIds(cohort.id).length;
  const proposalId = createProposal("grupos", ctx, ctx.messageId, {
    title: `Borrar el grupo «${cohort.name}» de ${course.title}`,
    applyLabel: "Borrar grupo",
    columns: COLUMNS_BORRAR,
    rows: [{ id: cohort.id, cells: { grupo: cohort.name, alumnos: String(alumnos) } }],
    payload: {
      accion: "borrar",
      courseId: course.id,
      courseTitle: course.title,
      cohortId: cohort.id,
      cohortName: cohort.name,
    },
    confirmWord: "ELIMINAR",
  });
  return {
    forModel: `Se creó una propuesta para borrar el grupo «${cohort.name}» de ${course.title}: ${alumnos} alumno(s) se quedarían sin grupo (siguen matriculados, solo pierden la etiqueta). No tiene vuelta atrás: para aplicarla habrá que escribir ELIMINAR. El usuario revisará la tabla.`,
    proposalId,
  };
}

export const grupos: AssistantTool = {
  name: "grupos",
  description:
    "Grupos (oleadas) de un curso: listarlos con sus alumnos, crear uno, mover alumnos a él, renombrarlo, cerrarlo, reabrirlo o borrarlo. Los grupos son de cada curso, así que siempre hace falta el curso. Mover a un grupo que no existe lo crea al vuelo. Mover a un alumno se aplica al momento; mover a varios muestra una tabla para revisar. Borrar el grupo es irreversible y pide escribir ELIMINAR.",
  parameters: schema({
    accion: strEnum(
      "Qué hacer: «listar» los grupos del curso, «crear» uno nuevo, «mover» alumnos a un grupo (si no existe, lo creo), «renombrar», «cerrar» (sale de las vistas diarias), «reabrir» o «borrar» el grupo (irreversible; los alumnos se quedan sin grupo, no se dan de baja)",
      ["crear", "mover", "renombrar", "cerrar", "reabrir", "borrar", "listar"]
    ),
    curso_id: str("Id del curso al que pertenece el grupo, de buscar_curso"),
    grupo: str("Nombre del grupo; con «crear», el nombre nuevo («» solo con «listar»)"),
    nombre_nuevo: str("Solo con «renombrar»: el nombre que tendrá el grupo («» en los demás casos)"),
    alumno_ids: strList("Solo con «mover»: ids de los alumnos, de buscar_alumno (lista vacía en los demás casos)"),
  }),
  roles: ["admin", "teacher"],
  // Como matricular: lo de uno en uno es instantáneo con deshacer; mover a varios crea propuesta
  risk: "instant",
  run(params, ctx) {
    const accion = param(params, "accion");
    const courseId = param(params, "curso_id");
    if (!courseId) return { forModel: "Falta curso_id: los grupos son de cada curso. Búscalo con buscar_curso." };
    const course = getOwnedCourse(courseId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };

    if (accion === "listar") return listar(course, ctx);
    if (
      accion !== "crear" &&
      accion !== "mover" &&
      accion !== "renombrar" &&
      accion !== "cerrar" &&
      accion !== "reabrir" &&
      accion !== "borrar"
    ) {
      return { forModel: "No entendí la acción: usa listar, crear, mover, renombrar, cerrar, reabrir o borrar." };
    }

    const nombre = param(params, "grupo");
    if (!nombre) return { forModel: "Falta el nombre del grupo. Puedes verlos con la acción «listar»." };
    if (accion === "crear") return crear(course, nombre, ctx);

    const encontrado = buscarGrupo(course.id, nombre);
    if ("error" in encontrado) return { forModel: encontrado.error };
    if (!encontrado.grupo) {
      // Mover es la única que no necesita un grupo que ya exista: lo crea al vuelo
      if (accion === "mover") return mover(course, null, nombre, [...new Set(paramList(params, "alumno_ids"))], ctx);
      return { forModel: `No hay ningún grupo «${nombre}» en ${course.title}. Puedes verlos con «listar» o crearlo con «crear».` };
    }
    const cohort = encontrado.grupo;
    // El curso ya se comprobó; esto vuelve a atar el grupo a un curso del usuario
    if (!canManageCohort(ctx.user, cohort.id)) return { forModel: "Ese grupo no es de tus cursos." };

    if (accion === "mover") return mover(course, cohort, nombre, [...new Set(paramList(params, "alumno_ids"))], ctx);
    if (accion === "borrar") return borrar(course, cohort, ctx);
    if (accion === "renombrar") {
      const nuevo = param(params, "nombre_nuevo");
      if (!nuevo) return { forModel: "Falta nombre_nuevo: cómo se llamará el grupo." };
      return renombrar(course, cohort, nuevo, ctx);
    }
    return cambiarEstado(course, cohort, accion, ctx);
  },
  /**
   * Aplica la propuesta de mover o la de borrar. Revalida: el curso sigue
   * siendo del usuario, el grupo sigue abierto y cada fila se recalcula; lo que
   * hoy esté bloqueado no se mueve.
   */
  apply(rows, payload, ctx, confirm) {
    const course = getOwnedCourse(String(payload.courseId ?? ""), ctx.user);
    const cohortId = String(payload.cohortId ?? "");
    const cohortName = String(payload.cohortName ?? "");

    if (String(payload.accion ?? "mover") === "borrar") {
      if (!course) return { text: "El curso ya no está disponible; no se borró ningún grupo." };
      if (confirm.trim().toLowerCase() !== "eliminar") return { text: "No se borró ningún grupo: falta escribir ELIMINAR." };
      const cohort = cohortId ? canManageCohort(ctx.user, cohortId) : null;
      if (!cohort) return { text: `El grupo «${cohortName}» ya no existe o no es de tus cursos; no se borró nada.` };
      const alumnos = cohortStudentIds(cohort.id).length;
      deleteCohort(cohort.id, ctx.user.id);
      registrar(ctx, "borrar", cohort.id, { courseId: course.id, nombre: cohort.name, alumnos });
      return {
        text: `Grupo «${cohort.name}» borrado de ${course.title}. ${alumnos} alumno(s) se quedaron sin grupo: siguen matriculados, solo perdieron la etiqueta.`,
        blocks: [enlaces(course.id)],
      };
    }

    if (!course) return { text: "El curso ya no está disponible; no se movió a nadie." };
    // Sin id en la propuesta, el grupo nace aquí: primero se mira si hay a quién mover
    let cohort = cohortId ? canManageCohort(ctx.user, cohortId) : null;
    if (cohortId && !cohort) return { text: "Ese grupo ya no existe o no es de tus cursos; no se movió a nadie." };
    if (cohort?.status === "closed") {
      return { text: `El grupo «${cohort.name}» se cerró mientras tanto; no se movió a nadie. Reábrelo y vuelve a intentarlo.` };
    }

    const filas = filasMover(rows.map((r) => r.id), course.id, cohort?.id ?? null, ctx);
    const ids = filas.filter((f) => !f.row.blocked).map((f) => f.enrollmentId);
    const motivos = filas.filter((f) => f.row.blocked).map((f) => f.row.warning ?? "ya no se puede");
    const destino = cohort?.name ?? cohortName;
    if (ids.length === 0) {
      let vacio = `No se movió a nadie al grupo «${destino}» de ${course.title}.`;
      if (motivos.length > 0) vacio += ` ${motivos.length} no se pudieron: ${[...new Set(motivos)].join("; ")}.`;
      return { text: vacio, blocks: [enlaces(course.id)] };
    }

    let creado = false;
    if (!cohort) {
      try {
        creado = findCohortByName(course.id, cohortName) === null;
        cohort = getCohort(findOrCreateCohort(course.id, cohortName, ctx.user.id));
      } catch (err) {
        return { text: err instanceof Error ? err.message : "No se pudo crear el grupo; no se movió a nadie." };
      }
      if (!cohort) return { text: "No se pudo crear el grupo; no se movió a nadie." };
    }

    const movidos = assignEnrollmentsToCohort(ids, cohort.id);
    if (movidos > 0) {
      registrar(ctx, "mover", cohort.id, { courseId: course.id, nombre: cohort.name, alumnos: movidos, grupoCreado: creado });
    }
    let text = creado
      ? `Creé el grupo «${cohort.name}» y moví a ${movidos} alumno(s) en ${course.title}.`
      : `${movidos} alumno(s) movido(s) al grupo «${cohort.name}» de ${course.title}.`;
    if (motivos.length > 0) text += ` ${motivos.length} no se movieron: ${[...new Set(motivos)].join("; ")}.`;
    return { text, blocks: [enlaces(course.id)] };
  },
  /**
   * Deshacer lo instantáneo: el grupo recién creado se borra (solo si sigue
   * vacío), el nombre y el estado vuelven al anterior y el alumno movido
   * regresa a donde estaba (que puede ser ningún grupo); si ese movimiento
   * creó el grupo al vuelo, también se borra. Si no se puede, lanza: así el
   * mensaje no se marca como deshecho.
   */
  undo(params, ctx) {
    const accion = param(params, "accion");

    if (accion === "mover") {
      const course = getOwnedCourse(param(params, "curso_id"), ctx.user);
      if (!course) throw new Error("No se pudo deshacer: el curso ya no está disponible.");
      const studentId = param(params, "alumno_id");
      const matricula = matriculasDe(course.id, [studentId]).get(studentId);
      if (!matricula || matricula.status === "dropped") {
        throw new Error("No se pudo deshacer: ese alumno ya no está matriculado en el curso.");
      }
      const anteriorId = param(params, "grupo_anterior_id");
      const anterior = anteriorId ? getCohort(anteriorId) : null;
      if (anteriorId && !anterior) throw new Error("No se pudo deshacer: el grupo en el que estaba ya no existe.");
      assignEnrollmentsToCohort([matricula.enrollmentId], anterior?.id ?? null);
      // Si el grupo nació con ese movimiento, deshacer también lo quita (solo si quedó vacío)
      const creadoId = param(params, "grupo_creado_id");
      const creado = creadoId ? getCohort(creadoId) : null;
      let borrado: string | null = null;
      if (creado && matriculasEnGrupo(creado.id) === 0) {
        deleteCohort(creado.id, ctx.user.id);
        borrado = creado.name;
      }
      // Volver a «sin grupo» no tiene grupo al que colgar la huella: va en la matrícula
      audit(ctx.user.id, "assistant_grupos_undo", "enrollment", `${course.id}:${studentId}`, {
        accion: "mover",
        via: "assistant",
        conversationId: ctx.conversationId,
        grupo: anterior?.id ?? null,
        grupoBorrado: borrado ? creadoId : null,
      });
      const nombre = alumnosPorId([studentId]).get(studentId)?.fullName ?? "El alumno";
      let text = anterior
        ? `${nombre} volvió al grupo «${anterior.name}» de ${course.title}.`
        : `${nombre} quedó otra vez sin grupo en ${course.title}.`;
      if (borrado) text += ` Borré el grupo «${borrado}», que quedó vacío.`;
      return { forModel: text, blocks: [{ type: "result", text }] };
    }

    const cohortId = param(params, "grupo_id");
    const cohort = cohortId ? canManageCohort(ctx.user, cohortId) : null;
    if (!cohort) throw new Error("No se pudo deshacer: ese grupo ya no existe o no es de tus cursos.");

    if (accion === "crear") {
      // Solo si sigue vacío: borrarlo con gente dentro la dejaría sin grupo
      if (matriculasEnGrupo(cohort.id) > 0) {
        throw new Error(`No se pudo deshacer: el grupo «${cohort.name}» ya tiene alumnos. Bórralo desde Grupos si aún lo quieres quitar.`);
      }
      deleteCohort(cohort.id, ctx.user.id);
      audit(ctx.user.id, "assistant_grupos_undo", "cohorts", cohort.id, {
        accion: "crear",
        via: "assistant",
        conversationId: ctx.conversationId,
      });
      const text = `Grupo «${cohort.name}» borrado: estaba vacío.`;
      return { forModel: text, blocks: [{ type: "result", text }] };
    }

    if (accion === "renombrar") {
      const anterior = param(params, "nombre_anterior");
      if (!anterior) throw new Error("No se pudo deshacer: no sé cómo se llamaba antes.");
      try {
        renameCohort(cohort.id, anterior, ctx.user.id);
      } catch (err) {
        throw new Error(`No se pudo deshacer: ${err instanceof Error ? err.message.toLowerCase() : "no se pudo renombrar"}.`);
      }
      audit(ctx.user.id, "assistant_grupos_undo", "cohorts", cohort.id, {
        accion: "renombrar",
        via: "assistant",
        conversationId: ctx.conversationId,
      });
      const text = `El grupo vuelve a llamarse «${anterior}».`;
      return { forModel: text, blocks: [{ type: "result", text }] };
    }

    if (accion === "cerrar" || accion === "reabrir") {
      const anterior = param(params, "estado_anterior") === "closed" ? "closed" : "open";
      setCohortStatus(cohort.id, anterior, ctx.user.id);
      audit(ctx.user.id, "assistant_grupos_undo", "cohorts", cohort.id, {
        accion,
        via: "assistant",
        conversationId: ctx.conversationId,
      });
      const text = `El grupo «${cohort.name}» vuelve a estar ${estadoTexto(anterior)}.`;
      return { forModel: text, blocks: [{ type: "result", text }] };
    }

    throw new Error("No se pudo deshacer: acción desconocida.");
  },
};
