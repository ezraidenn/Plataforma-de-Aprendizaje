import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { courseItems, courses, enrollments, users } from "@/server/db/schema";
import { fullScope } from "@/server/auth/view-scope";
import { audit } from "@/server/services/audit";
import { cohortStudentIds, findCohortByName } from "@/server/services/cohorts";
import { getOwnedCourse, listCourseStudents } from "@/server/services/courses";
import { notify } from "@/server/services/notifications";
import { isStudentVisible } from "@/server/services/student-scope";
import type { AssistantBlock, ProposalRow } from "@/lib/assistant-blocks";
import { IDLE_DAYS, courseFilters, sinEntrarCondition, sinEntregarCondition } from "../queries";
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
 * Mandar un aviso a los alumnos: les llega a la campana como una notificación
 * («teacher_notice») con el título y el mensaje que escribió el maestro.
 *
 * Es la única herramienta que escribe A PERSONAS, así que SIEMPRE pasa por la
 * tabla de revisión: primero se ve la lista con el motivo de cada uno y una
 * vista previa de cómo lo leerán, y solo al confirmar se manda. No se puede
 * deshacer (ya lo vieron), así que la lista se enseña entera antes.
 *
 * A quién: los matriculados del curso, los de un grupo, los que llevan 14 días
 * sin entrar, los que deben alguna tarea o una lista de ids. Los dos últimos
 * criterios son los MISMOS que usa `pendientes` (condiciones compartidas en
 * queries.ts), para que lo que se ve ahí y a quién le llega coincidan.
 */

/** Tope de gente a la que se le manda de una vez. */
export const MAX_DESTINATARIOS = 500;
export const MAX_TITULO = 80;
export const MAX_MENSAJE = 500;

// Todo viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "alumno", label: "Alumno", editable: false },
  { key: "correo", label: "Correo", editable: false },
  { key: "motivo", label: "Motivo", editable: false },
];

type Destinatario = { studentId: string; motivo: string };
type Curso = { id: string; title: string };

/** Una línea: sin saltos, sin espacios de sobra y con tope duro de caracteres. */
function limpiarTitulo(raw: string): string {
  return recortar(raw.replace(/\s+/g, " ").trim(), MAX_TITULO);
}

/**
 * El mensaje conserva los párrafos (un salto en blanco como mucho) pero pierde
 * los espacios de relleno y los saltos repetidos, y nunca pasa del tope.
 */
function limpiarMensaje(raw: string): string {
  const clean = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((linea) => linea.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return recortar(clean, MAX_MENSAJE);
}

function recortar(texto: string, tope: number): string {
  return texto.length <= tope ? texto : `${texto.slice(0, tope - 1).trimEnd()}…`;
}

/** Vista previa en una línea para la tabla de revisión y para el chat. */
function vistaPrevia(titulo: string, mensaje: string): AssistantBlock {
  return { type: "text", text: `Así lo verán: **${titulo}** — ${mensaje.replace(/\n+/g, " ")}` };
}

function enlaces(courseId: string): AssistantBlock {
  return {
    type: "links",
    links: [
      {
        label: "Ver alumnos del curso",
        href: courseId ? `/teach/courses/${courseId}/students` : "/teach/students",
        icon: "user",
      },
    ],
  };
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

/**
 * Matriculados del curso (sin bajas), incluidos los de grupos cerrados. Los
 * que ya terminaron el curso también reciben el aviso, así que el motivo lo
 * dice con todas las letras: el maestro puede quitar esas filas en la tabla si
 * no quiere molestarlos.
 */
function delCurso(courseId: string): Destinatario[] {
  return listCourseStudents(courseId, { cohort: { kind: "all" } }).map((s) => ({
    studentId: s.studentId,
    motivo: s.status === "completed" ? "ya completó el curso" : "matriculado",
  }));
}

/** Los del grupo del curso con ese nombre. */
function delGrupo(course: Curso, nombre: string): Destinatario[] | { error: string } {
  let encontrado: { id: string; name: string } | null;
  try {
    encontrado = findCohortByName(course.id, nombre);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Ese nombre de grupo no es válido." };
  }
  if (!encontrado) {
    return { error: `No hay ningún grupo «${nombre}» en ${course.title}. Míralos con la herramienta grupos («listar»).` };
  }
  const cohort = encontrado;
  return cohortStudentIds(cohort.id).map((studentId) => ({ studentId, motivo: `grupo «${cohort.name}»` }));
}

/** Los que llevan 14 días sin entrar: MISMA condición que `pendientes`. */
function sinEntrar(ctx: ToolCtx, courseId: string): Destinatario[] {
  return db
    .selectDistinct({ studentId: users.id, last: users.lastLoginAt })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(and(eq(enrollments.status, "active"), sinEntrarCondition(), ...courseFilters(ctx.scope, courseId)))
    .all()
    .map((r) => ({
      studentId: r.studentId,
      motivo: r.last ? `no ha entrado en ${IDLE_DAYS} días` : "nunca ha entrado",
    }));
}

/** Los que deben alguna tarea: MISMA condición que `pendientes`. */
function sinEntregar(ctx: ToolCtx, courseId: string): Destinatario[] {
  const rows = db
    .select({ studentId: users.id, tarea: courseItems.title })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(courseItems, and(eq(courseItems.courseId, courses.id), eq(courseItems.kind, "assignment")))
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(and(eq(enrollments.status, "active"), sinEntregarCondition(), ...courseFilters(ctx.scope, courseId)))
    .orderBy(asc(courseItems.position))
    .all();

  // Una fila por alumno: la primera tarea que debe y cuántas más
  const porAlumno = new Map<string, string[]>();
  for (const r of rows) {
    const tareas = porAlumno.get(r.studentId) ?? [];
    tareas.push(r.tarea);
    porAlumno.set(r.studentId, tareas);
  }
  return [...porAlumno].map(([studentId, tareas]) => ({
    studentId,
    motivo: tareas.length === 1 ? `no entregó ${tareas[0]}` : `no entregó ${tareas[0]} y ${tareas.length - 1} tarea(s) más`,
  }));
}

/** Una fila por destinatario; la de quien no es tuyo se bloquea y no recibe nada. */
function toRows(destinatarios: Destinatario[], ctx: ToolCtx): ProposalRow[] {
  const alumnos = alumnosPorId(destinatarios.map((d) => d.studentId));
  const scope = fullScope(ctx.user);
  return destinatarios.map((d) => {
    const alumno = alumnos.get(d.studentId);
    const cells = { alumno: alumno?.fullName ?? "(desconocido)", correo: alumno?.email ?? d.studentId, motivo: d.motivo };
    if (!alumno) return { id: d.studentId, cells, warning: "No existe ese alumno", blocked: true };
    if (!isStudentVisible(scope, d.studentId)) {
      return { id: d.studentId, cells, warning: "No es uno de tus alumnos", blocked: true };
    }
    return { id: d.studentId, cells };
  });
}

/** Quita repetidos conservando el primer motivo (el más concreto llega antes). */
function unicos(destinatarios: Destinatario[]): Destinatario[] {
  const vistos = new Map<string, Destinatario>();
  for (const d of destinatarios) if (!vistos.has(d.studentId)) vistos.set(d.studentId, d);
  return [...vistos.values()];
}

export const avisar: AssistantTool = {
  name: "avisar",
  description:
    "Manda un aviso a los alumnos: les llega a su campana con el título y el mensaje que escriba el usuario. Se puede mandar a todo el curso, a un grupo, a los que llevan días sin entrar, a los que deben tareas o a una lista de alumnos. Siempre se muestra una tabla con los destinatarios para revisar antes de mandarlo.",
  parameters: schema({
    titulo: str("Título del aviso, corto y claro (máximo 80 caracteres). El alumno lo lee tal cual, así que escríbelo como el usuario lo diría"),
    mensaje: str("El aviso, tal como lo leerá el alumno (máximo 500 caracteres)"),
    curso_id: str("Id del curso del que se habla, de buscar_curso (obligatorio salvo cuando mandas a unos alumno_ids sueltos)"),
    a_quien: strEnum(
      "A quién le llega: «curso» (todos los matriculados), «grupo» (los de un grupo del curso), «sin_entrar» (los que llevan 14 días sin entrar), «sin_entregar» (los que deben alguna tarea) o «ids» (los alumno_ids)",
      ["ids", "curso", "grupo", "sin_entrar", "sin_entregar"]
    ),
    alumno_ids: strList("Solo con «ids»: ids de los alumnos, de buscar_alumno (lista vacía en los demás casos)"),
    grupo: str("Solo con «grupo»: nombre del grupo del curso («» en los demás casos)"),
  }),
  roles: ["admin", "teacher"],
  // Escribe a personas y no se puede deshacer: SIEMPRE por tabla de revisión
  risk: "review",
  run(params, ctx): ToolResult {
    const titulo = limpiarTitulo(param(params, "titulo"));
    if (!titulo) return { forModel: "Falta el título del aviso: pregúntale al usuario con qué título quiere que les llegue." };
    const mensaje = limpiarMensaje(param(params, "mensaje"));
    if (!mensaje) return { forModel: "Falta el mensaje del aviso: pregúntale al usuario qué quiere decirles." };

    const aQuien = param(params, "a_quien") || "curso";
    const courseId = param(params, "curso_id");
    if (!courseId && aQuien !== "ids") {
      return { forModel: "Falta curso_id: el aviso habla de un curso. Búscalo con buscar_curso." };
    }
    const course = courseId ? getOwnedCourse(courseId, ctx.user) : null;
    if (courseId && !course) return { forModel: "No encontramos ese curso o no te pertenece; no mandé nada." };

    let destinatarios: Destinatario[];
    if (aQuien === "ids") {
      const ids = [...new Set(paramList(params, "alumno_ids"))];
      if (ids.length === 0) return { forModel: "No me diste a quién avisar: pásame los alumno_ids (de buscar_alumno) o di a quién (curso, grupo, sin_entrar, sin_entregar)." };
      destinatarios = ids.map((studentId) => ({ studentId, motivo: "de la lista que me diste" }));
    } else if (aQuien === "grupo") {
      const nombre = param(params, "grupo");
      if (!nombre) return { forModel: "Falta el nombre del grupo. Puedes verlos con la herramienta grupos («listar»)." };
      const delGrupoRes = delGrupo(course!, nombre);
      if ("error" in delGrupoRes) return { forModel: delGrupoRes.error };
      destinatarios = delGrupoRes;
    } else if (aQuien === "sin_entrar") {
      destinatarios = sinEntrar(ctx, course!.id);
    } else if (aQuien === "sin_entregar") {
      destinatarios = sinEntregar(ctx, course!.id);
    } else {
      destinatarios = delCurso(course!.id);
    }
    destinatarios = unicos(destinatarios);

    const donde = course ? ` en ${course.title}` : "";
    if (destinatarios.length === 0) {
      return { forModel: `No hay a quién mandarle ese aviso${donde}: nadie cumple ese criterio. No mandé nada.` };
    }
    if (destinatarios.length > MAX_DESTINATARIOS) {
      return {
        forModel: `Son ${destinatarios.length} destinatarios${donde} y de una vez no mando a más de ${MAX_DESTINATARIOS}. No propuse nada: dile al usuario que acote (por grupo, por curso o con una lista) y vuelve a pedírmelo.`,
      };
    }

    const rows = toRows(destinatarios, ctx);
    const proposalId = createProposal("avisar", ctx, ctx.messageId, {
      // La cabecera dice lo que se va a hacer; el título del aviso ya se lee en la vista previa
      title: `Mandar un aviso a ${rows.length} ${rows.length === 1 ? "alumno" : "alumnos"}`,
      applyLabel: "Mandar aviso",
      columns: COLUMNS,
      rows,
      payload: {
        courseId: course?.id ?? "",
        courseTitle: course?.title ?? "",
        titulo,
        mensaje,
      },
    });

    // La IA solo ve cuántos son y por qué: los nombres y correos se quedan en la tabla
    const ok = rows.filter((r) => !r.blocked).length;
    const bloqueadas = rows.length - ok;
    const partes = [`Se creó una propuesta con ${rows.length} destinatario(s): a ${ok} les llegaría el aviso${donde}`];
    if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (no es tu alumno o ya no existe)`);
    partes.push("el usuario verá la vista previa y la tabla antes de mandarlo; no se puede deshacer");
    return {
      forModel: `${partes.join("; ")}.`,
      blocks: [vistaPrevia(titulo, mensaje)],
      proposalId,
    };
  },
  /**
   * Manda el aviso a las filas ya revisadas. Se revalida quién es visible (los
   * permisos pudieron cambiar) y todo se escribe en una transacción: o le llega
   * a los de la lista o no le llega a nadie.
   */
  apply(rows, payload, ctx) {
    const titulo = limpiarTitulo(String(payload.titulo ?? ""));
    const mensaje = limpiarMensaje(String(payload.mensaje ?? ""));
    if (!titulo || !mensaje) return { text: "No se mandó el aviso: se perdió el título o el mensaje." };

    const courseId = String(payload.courseId ?? "");
    const course = courseId ? getOwnedCourse(courseId, ctx.user) : null;
    if (courseId && !course) return { text: "El curso ya no está disponible; no se mandó el aviso." };

    const scope = fullScope(ctx.user);
    const alumnos = alumnosPorId(rows.map((r) => r.id));
    const motivos: string[] = [];
    const destinos: string[] = [];
    for (const row of rows) {
      if (!alumnos.has(row.id)) {
        motivos.push("esa cuenta ya no existe");
        continue;
      }
      if (!isStudentVisible(scope, row.id)) {
        motivos.push("no es uno de tus alumnos");
        continue;
      }
      destinos.push(row.id);
    }

    if (destinos.length > 0) {
      db.transaction(() => {
        for (const studentId of destinos) {
          notify(studentId, "teacher_notice", {
            title: titulo,
            body: mensaje,
            from: ctx.user.fullName,
            courseId: course?.id ?? null,
            courseTitle: course?.title ?? null,
          });
        }
      });
      audit(ctx.user.id, "assistant_avisar", "courses", course?.id, {
        via: "assistant",
        conversationId: ctx.conversationId,
        alumnos: destinos.length,
        titulo,
      });
    }

    let text = `El aviso le llegó a ${destinos.length} alumno(s)${course ? ` de ${course.title}` : ""}.`;
    if (motivos.length > 0) text += ` ${motivos.length} no lo recibieron: ${[...new Set(motivos)].join("; ")}.`;
    return { text, blocks: [enlaces(course?.id ?? "")] };
  },
};
