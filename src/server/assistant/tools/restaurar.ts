import "server-only";
import { fullScope } from "@/server/auth/view-scope";
import { audit } from "@/server/services/audit";
import { getOwnedCourse, listDroppedEnrollments, restoreEnrollments } from "@/server/services/courses";
import { isStudentVisible } from "@/server/services/student-scope";
import type { ProposalRow } from "@/lib/assistant-blocks";
import { fmtDate } from "../queries";
import { createProposal } from "../proposal-store";
import { schema, str, strList, param, paramList, type AssistantTool, type ToolCtx } from "../tool-types";

/**
 * Papelera del curso: devolver matrículas dadas de baja. Restaurar no repite
 * la matrícula desde cero: el alumno vuelve con su avance, calificaciones,
 * certificado y estatus tal como los dejó (su ciclo sigue siendo el mismo).
 * Siempre se revisa en una tabla: son varias personas y conviene verlas.
 */

// Todo viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "alumno", label: "Alumno", editable: false },
  { key: "correo", label: "Correo", editable: false },
  { key: "baja", label: "Dado de baja", editable: false },
  { key: "avance", label: "Avance que conserva", editable: false },
];

type Baja = ReturnType<typeof listDroppedEnrollments>[number];

/** Qué recupera el alumno al volver: cómo estaba, su certificado y su ciclo. */
function avanceDe(baja: Baja): string {
  const partes = [baja.droppedFrom === "completed" ? "Aprobado" : "En curso"];
  if (baja.certificateFolio) partes.push(`certificado ${baja.certificateFolio}`);
  if (baja.cycle > 1) partes.push(`ciclo ${baja.cycle}`);
  return partes.join(" · ");
}

/** Una fila por baja; la de un alumno que no es tuyo se bloquea. */
function toRows(bajas: Baja[], ctx: ToolCtx): ProposalRow[] {
  const scope = fullScope(ctx.user);
  return bajas.map((b) => {
    const cells = {
      alumno: b.fullName,
      correo: b.email,
      baja: b.droppedAt ? fmtDate(b.droppedAt) : "sin fecha",
      avance: avanceDe(b),
    };
    if (!isStudentVisible(scope, b.studentId)) {
      return { id: b.enrollmentId, cells, warning: "No es uno de tus alumnos", blocked: true };
    }
    return { id: b.enrollmentId, cells };
  });
}

export const restaurar: AssistantTool = {
  name: "restaurar",
  description:
    "Devuelve al curso a alumnos que se dieron de baja (la papelera del curso): vuelven con su avance, calificaciones, certificado y estatus tal como los dejaron. Siempre se muestra una tabla para revisar.",
  parameters: schema({
    curso_id: str("Id del curso de cuya papelera se sacan las matrículas, de buscar_curso"),
    alumno_ids: strList("Ids de los alumnos a devolver, de buscar_alumno (lista vacía = todos los dados de baja de ese curso)"),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  run(params, ctx) {
    const courseId = param(params, "curso_id");
    if (!courseId) return { forModel: "Falta curso_id: la papelera es de cada curso. Búscalo con buscar_curso." };
    const course = getOwnedCourse(courseId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };

    const bajas = listDroppedEnrollments(course.id);
    if (bajas.length === 0) return { forModel: `${course.title} no tiene bajas en la papelera: no hay nada que restaurar.` };

    const pedidos = new Set(paramList(params, "alumno_ids"));
    const elegidas = pedidos.size > 0 ? bajas.filter((b) => pedidos.has(b.studentId)) : bajas;
    if (elegidas.length === 0) {
      return { forModel: `Ninguno de esos alumnos está en la papelera de ${course.title}, donde hay ${bajas.length} baja(s). Mírala con listado o pídeme restaurarlas todas.` };
    }

    const rows = toRows(elegidas, ctx);
    const proposalId = createProposal("restaurar", ctx, ctx.messageId, {
      title: `Devolver al curso ${course.title}`,
      applyLabel: "Restaurar",
      columns: COLUMNS,
      rows,
      payload: { courseId: course.id, courseTitle: course.title },
    });

    // La IA solo ve cuántas son: los nombres y correos se quedan en la tabla
    const ok = rows.filter((r) => !r.blocked).length;
    const bloqueadas = rows.length - ok;
    const partes = [`Se creó una propuesta con ${rows.length} fila(s): ${ok} lista(s) para volver a ${course.title}`];
    if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (no es tu alumno)`);
    if (pedidos.size > elegidas.length) partes.push(`de los ${pedidos.size} que pediste, ${elegidas.length} están en la papelera`);
    partes.push("vuelven con su avance tal como lo dejaron");
    return { forModel: `${partes.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Aplica las filas ya revisadas. Se revalida contra la papelera de ahora:
   * una baja que alguien ya restauró o borró para siempre se salta.
   */
  apply(rows, payload, ctx) {
    const course = getOwnedCourse(String(payload.courseId ?? ""), ctx.user);
    if (!course) return { text: "El curso ya no está disponible; no se restauró a nadie." };
    const bajas = new Map(listDroppedEnrollments(course.id).map((b) => [b.enrollmentId, b]));
    const scope = fullScope(ctx.user);
    const motivos: string[] = [];
    const ids: string[] = [];
    for (const row of rows) {
      const baja = bajas.get(row.id);
      if (!baja) {
        motivos.push("esa baja ya no está en la papelera");
        continue;
      }
      if (!isStudentVisible(scope, baja.studentId)) {
        motivos.push("no es uno de tus alumnos");
        continue;
      }
      ids.push(row.id);
    }
    const restauradas = ids.length ? restoreEnrollments(ids) : 0;
    for (const id of ids) {
      audit(ctx.user.id, "assistant_restaurar", "enrollment", id, {
        via: "assistant",
        conversationId: ctx.conversationId,
        courseId: course.id,
      });
    }
    let text = `${restauradas} alumno(s) volvieron a ${course.title} con su avance, calificaciones y certificado tal como los dejaron.`;
    if (motivos.length > 0) text += ` ${motivos.length} no se pudieron: ${[...new Set(motivos)].join("; ")}.`;
    return {
      text,
      blocks: [{ type: "links", links: [{ label: "Ver alumnos del curso", href: `/teach/courses/${course.id}/students`, icon: "user" }] }],
    };
  },
};
