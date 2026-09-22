import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { enrollments, users } from "@/server/db/schema";
import { enrollStudents, getOwnedCourse, unenrollStudent } from "@/server/services/courses";
import { isStudentVisible } from "@/server/services/student-scope";
import { fullScope } from "@/server/auth/view-scope";
import { audit } from "@/server/services/audit";
import type { ProposalRow } from "@/lib/assistant-blocks";
import { createProposal } from "../proposal-store";
import { appendMessage } from "@/server/services/ai-conversations";
import { schema, str, strList, param, paramList, type AssistantTool, type ToolCtx } from "../tool-types";

/**
 * Matricular: con un alumno se hace al momento (deshacer = desmatricular);
 * con varios se propone una tabla para revisar. Desmatricular siempre se
 * revisa, salvo cuando es el «deshacer» de una matrícula.
 */

type Named = { id: string; fullName: string; email: string };

function studentsByIds(ids: string[]): Map<string, Named> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.role, "student")))
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

/** Matrícula vigente (ciclo más reciente que no sea baja). */
function isEnrolled(courseId: string, studentId: string): boolean {
  const row = db
    .select({ status: enrollments.status })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
    .orderBy(desc(enrollments.cycle))
    .limit(1)
    .get();
  return !!row && row.status !== "dropped";
}

const COLUMNS = [
  { key: "nombre", label: "Nombre" },
  { key: "correo", label: "Correo" },
];

/** Filas de revisión para una lista de alumnos en un curso. */
function rowsFor(studentIds: string[], courseId: string, ctx: ToolCtx, action: "enroll" | "unenroll"): ProposalRow[] {
  const found = studentsByIds(studentIds);
  const scope = fullScope(ctx.user);
  return studentIds.map((id) => {
    const s = found.get(id);
    if (!s) return { id, cells: { nombre: "(desconocido)", correo: id }, warning: "No existe ese alumno", blocked: true };
    const cells = { nombre: s.fullName, correo: s.email };
    if (!isStudentVisible(scope, id)) return { id, cells, warning: "No es uno de tus alumnos", blocked: true };
    const enrolled = isEnrolled(courseId, id);
    if (action === "enroll" && enrolled) return { id, cells, warning: "Ya está matriculado", blocked: true };
    if (action === "unenroll" && !enrolled) return { id, cells, warning: "No está matriculado", blocked: true };
    return { id, cells };
  });
}

/** Mensaje vacío que ancla la propuesta (FK); el bucle del agente pone el bloque en el mensaje final del turno. */
function proposalAnchor(ctx: ToolCtx): string {
  return appendMessage(ctx.conversationId, "assistant", [], "").id;
}

export const matricular: AssistantTool = {
  name: "matricular",
  description: "Matricula uno o varios alumnos en un curso. Con un alumno se aplica al momento; con varios se muestra una tabla para revisar.",
  parameters: schema({
    alumno_ids: strList("Ids de los alumnos (de buscar_alumno)"),
    curso_id: str("Id del curso (de buscar_curso)"),
  }),
  roles: ["admin", "teacher"],
  risk: "instant",
  async run(params, ctx) {
    const studentIds = [...new Set(paramList(params, "alumno_ids"))];
    const courseId = param(params, "curso_id");
    if (studentIds.length === 0 || !courseId) return { forModel: "Faltan alumno_ids o curso_id." };
    const course = getOwnedCourse(courseId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };

    const rows = rowsFor(studentIds, course.id, ctx, "enroll");

    if (rows.length === 1) {
      const row = rows[0];
      if (row.blocked) return { forModel: `No se pudo matricular: ${row.warning}.` };
      enrollStudents(course.id, [row.id], ctx.user.id);
      audit(ctx.user.id, "assistant_matricular", "enrollment", `${course.id}:${row.id}`, { via: "assistant", conversationId: ctx.conversationId });
      const text = `${row.cells.nombre} quedó matriculado en ${course.title}.`;
      return {
        forModel: text,
        blocks: [
          { type: "result", text, undoable: true },
          { type: "links", links: [{ label: "Ver alumnos del curso", href: `/teach/courses/${course.id}/students`, icon: "user" }] },
        ],
        // __undo no está en el esquema estricto: solo el servidor puede mandarlo
        undo: { tool: "desmatricular", params: { alumno_ids: [row.id], curso_id: course.id, __undo: true } },
      };
    }

    const proposalId = createProposal("matricular", ctx, proposalAnchor(ctx), {
      title: `Matricular en ${course.title}`,
      applyLabel: "Matricular",
      columns: COLUMNS,
      rows,
      payload: { courseId: course.id, courseTitle: course.title },
    });
    const ok = rows.filter((r) => !r.blocked).length;
    return { forModel: `Se creó una propuesta con ${rows.length} fila(s), ${ok} listas para matricular en ${course.title}. El usuario la revisará.`, proposalId };
  },
  apply(rows, payload, ctx) {
    const courseId = String(payload.courseId);
    const courseTitle = String(payload.courseTitle);
    const ids = rows.map((r) => r.id);
    const count = ids.length ? enrollStudents(courseId, ids, ctx.user.id) : 0;
    return { text: `${count} alumno(s) matriculado(s) en ${courseTitle}.` };
  },
};

export const desmatricular: AssistantTool = {
  name: "desmatricular",
  description: "Da de baja alumnos de un curso (siguen en la plataforma). Siempre se revisa antes de aplicar.",
  parameters: schema({
    alumno_ids: strList("Ids de los alumnos"),
    curso_id: str("Id del curso"),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  async run(params, ctx) {
    const studentIds = [...new Set(paramList(params, "alumno_ids"))];
    const courseId = param(params, "curso_id");
    if (studentIds.length === 0 || !courseId) return { forModel: "Faltan alumno_ids o curso_id." };
    const course = getOwnedCourse(courseId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };
    const rows = rowsFor(studentIds, course.id, ctx, "unenroll");

    // «Deshacer» de una matrícula instantánea: se aplica sin revisión. La IA no
    // puede mandar __undo (el esquema estricto no lo admite); solo el servidor.
    if (params.__undo === true && rows.length === 1 && !rows[0].blocked) {
      unenrollStudent(course.id, rows[0].id, ctx.user.id);
      return { forModel: `${rows[0].cells.nombre} quedó dado de baja de ${course.title}.` };
    }

    const proposalId = createProposal("desmatricular", ctx, proposalAnchor(ctx), {
      title: `Dar de baja de ${course.title}`,
      applyLabel: "Dar de baja",
      columns: COLUMNS,
      rows,
      payload: { courseId: course.id, courseTitle: course.title },
    });
    return { forModel: `Se creó una propuesta para dar de baja ${rows.filter((r) => !r.blocked).length} alumno(s) de ${course.title}. El usuario la revisará.`, proposalId };
  },
  apply(rows, payload, ctx) {
    const courseId = String(payload.courseId);
    let count = 0;
    for (const r of rows) if (unenrollStudent(courseId, r.id, ctx.user.id)) count++;
    return { text: `${count} alumno(s) dado(s) de baja de ${String(payload.courseTitle)}.` };
  },
};
