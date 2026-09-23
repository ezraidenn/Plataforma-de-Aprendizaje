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
 * renombrarlo, cerrarlo o reabrirlo. Los grupos son PROPIOS de cada curso, así
 * que todo empieza por el curso y siempre se comprueba que sea del usuario.
 *
 * Mover a un solo alumno se hace al momento y se puede deshacer (vuelve al
 * grupo donde estaba, que puede ser ninguno); mover a varios pasa por la tabla
 * de revisión. Un grupo CERRADO no admite movimientos: meter gente ahí la
 * escondería de las vistas diarias, así que se dice y se ofrece reabrirlo.
 */

type Curso = { id: string; title: string };

// Todo lo de la tabla viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "alumno", label: "Alumno", editable: false },
  { key: "correo", label: "Correo", editable: false },
  { key: "grupo_actual", label: "Grupo actual", editable: false },
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

function filasMover(studentIds: string[], courseId: string, cohortId: string, ctx: ToolCtx): Fila[] {
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
    if (matricula.cohortId === cohortId) return { ...base, row: { id, cells, warning: "Ya está en ese grupo", blocked: true } };
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

function mover(
  course: Curso,
  cohort: Grupo,
  studentIds: string[],
  ctx: ToolCtx
): ToolResult {
  if (studentIds.length === 0) return { forModel: "No me diste a quién mover: pásame los alumno_ids (de buscar_alumno)." };
  if (cohort.status === "closed") {
    return {
      forModel: `El grupo «${cohort.name}» de ${course.title} está cerrado y no admite movimientos: quien entre ahí desaparece de las vistas diarias. Pregúntale al usuario si quiere que lo reabra (acción «reabrir») y no muevas a nadie hasta que lo diga.`,
    };
  }
  const filas = filasMover(studentIds, course.id, cohort.id, ctx);

  // Uno solo: no hay nada que revisar y volver atrás es un clic
  if (filas.length === 1) {
    const [fila] = filas;
    if (fila.row.blocked) return { forModel: `No se pudo mover: ${fila.row.warning}.` };
    assignEnrollmentsToCohort([fila.enrollmentId], cohort.id);
    registrar(ctx, "mover", cohort.id, { courseId: course.id, nombre: cohort.name, alumnos: 1 });
    const anterior = fila.row.cells.grupo_actual === SIN_GRUPO ? "sin grupo" : `«${fila.row.cells.grupo_actual}»`;
    const text = `${fila.row.cells.alumno} pasó de ${anterior} al grupo «${cohort.name}» de ${course.title}.`;
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
        },
      },
    };
  }

  const rows = filas.map((f) => f.row);
  const proposalId = createProposal("grupos", ctx, ctx.messageId, {
    title: `Mover al grupo «${cohort.name}» de ${course.title}`,
    applyLabel: "Mover",
    columns: COLUMNS,
    rows,
    payload: { courseId: course.id, courseTitle: course.title, cohortId: cohort.id, cohortName: cohort.name },
  });
  // La IA solo ve cuántas son: los nombres y correos se quedan en la tabla
  const ok = rows.filter((r) => !r.blocked).length;
  const bloqueadas = rows.length - ok;
  const partes = [`Se creó una propuesta con ${rows.length} fila(s): ${ok} lista(s) para pasar al grupo «${cohort.name}»`];
  if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (no es tu alumno, no está matriculado o ya está en ese grupo)`);
  return { forModel: `${partes.join("; ")}. El usuario revisará la tabla.`, proposalId };
}

export const grupos: AssistantTool = {
  name: "grupos",
  description:
    "Grupos (oleadas) de un curso: listarlos con sus alumnos, crear uno, mover alumnos a él, renombrarlo, cerrarlo o reabrirlo. Los grupos son de cada curso, así que siempre hace falta el curso. Mover a un alumno se aplica al momento; mover a varios muestra una tabla para revisar.",
  parameters: schema({
    accion: strEnum(
      "Qué hacer: «listar» los grupos del curso, «crear» uno nuevo, «mover» alumnos a un grupo, «renombrar», «cerrar» (sale de las vistas diarias) o «reabrir»",
      ["crear", "mover", "renombrar", "cerrar", "reabrir", "listar"]
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
    if (accion !== "crear" && accion !== "mover" && accion !== "renombrar" && accion !== "cerrar" && accion !== "reabrir") {
      return { forModel: "No entendí la acción: usa listar, crear, mover, renombrar, cerrar o reabrir." };
    }

    const nombre = param(params, "grupo");
    if (!nombre) return { forModel: "Falta el nombre del grupo. Puedes verlos con la acción «listar»." };
    if (accion === "crear") return crear(course, nombre, ctx);

    // Las demás acciones trabajan sobre un grupo que ya existe
    const encontrado = buscarGrupo(course.id, nombre);
    if ("error" in encontrado) return { forModel: encontrado.error };
    if (!encontrado.grupo) {
      return { forModel: `No hay ningún grupo «${nombre}» en ${course.title}. Puedes verlos con «listar» o crearlo con «crear».` };
    }
    const cohort = encontrado.grupo;
    // El curso ya se comprobó; esto vuelve a atar el grupo a un curso del usuario
    if (!canManageCohort(ctx.user, cohort.id)) return { forModel: "Ese grupo no es de tus cursos." };

    if (accion === "mover") return mover(course, cohort, [...new Set(paramList(params, "alumno_ids"))], ctx);
    if (accion === "renombrar") {
      const nuevo = param(params, "nombre_nuevo");
      if (!nuevo) return { forModel: "Falta nombre_nuevo: cómo se llamará el grupo." };
      return renombrar(course, cohort, nuevo, ctx);
    }
    return cambiarEstado(course, cohort, accion, ctx);
  },
  /**
   * Aplica la propuesta de mover (la única que crea esta herramienta).
   * Revalida: el curso sigue siendo del usuario, el grupo sigue abierto y cada
   * fila se recalcula; lo que hoy esté bloqueado no se mueve.
   */
  apply(rows, payload, ctx) {
    const course = getOwnedCourse(String(payload.courseId ?? ""), ctx.user);
    if (!course) return { text: "El curso ya no está disponible; no se movió a nadie." };
    const cohortId = String(payload.cohortId ?? "");
    const cohort = cohortId ? canManageCohort(ctx.user, cohortId) : null;
    if (!cohort) return { text: "Ese grupo ya no existe o no es de tus cursos; no se movió a nadie." };
    if (cohort.status === "closed") {
      return { text: `El grupo «${cohort.name}» se cerró mientras tanto; no se movió a nadie. Reábrelo y vuelve a intentarlo.` };
    }
    const filas = filasMover(rows.map((r) => r.id), course.id, cohort.id, ctx);
    const ids = filas.filter((f) => !f.row.blocked).map((f) => f.enrollmentId);
    const movidos = ids.length ? assignEnrollmentsToCohort(ids, cohort.id) : 0;
    if (movidos > 0) registrar(ctx, "mover", cohort.id, { courseId: course.id, nombre: cohort.name, alumnos: movidos });
    let text = `${movidos} alumno(s) movido(s) al grupo «${cohort.name}» de ${course.title}.`;
    const motivos = filas.filter((f) => f.row.blocked).map((f) => f.row.warning ?? "ya no se puede");
    if (motivos.length > 0) text += ` ${motivos.length} no se movieron: ${[...new Set(motivos)].join("; ")}.`;
    return { text, blocks: [enlaces(course.id)] };
  },
  /**
   * Deshacer lo instantáneo: el grupo recién creado se borra (solo si sigue
   * vacío), el nombre y el estado vuelven al anterior y el alumno movido
   * regresa a donde estaba (que puede ser ningún grupo). Si no se puede, lanza:
   * así el mensaje no se marca como deshecho.
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
      // Volver a «sin grupo» no tiene grupo al que colgar la huella: va en la matrícula
      audit(ctx.user.id, "assistant_grupos_undo", "enrollment", `${course.id}:${studentId}`, {
        accion: "mover",
        via: "assistant",
        conversationId: ctx.conversationId,
        grupo: anterior?.id ?? null,
      });
      const nombre = alumnosPorId([studentId]).get(studentId)?.fullName ?? "El alumno";
      const text = anterior
        ? `${nombre} volvió al grupo «${anterior.name}» de ${course.title}.`
        : `${nombre} quedó otra vez sin grupo en ${course.title}.`;
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
