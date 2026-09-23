import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { setStudentActive } from "@/server/services/courses";
import { studentAccountPermissions } from "@/server/services/student-scope";
import { audit } from "@/server/services/audit";
import { readPeople } from "./alta-alumnos";
import { createProposal } from "../proposal-store";
import { schema, str, strEnum, strList, param, paramList, type AssistantTool, type ToolCtx } from "../tool-types";
import type { ProposalRow } from "@/lib/assistant-blocks";
import type { RowsResult } from "../rows-from-attachment";

/**
 * Vuelve a abrir cuentas deshabilitadas: lo contrario de baja_alumnos en su
 * modo «deshabilitar». Reactivar nunca perjudica a nadie (a un alumno
 * compartido lo reactiva cualquiera de sus maestros), así que el único
 * requisito es que sea uno de tus alumnos. Con uno solo se hace al momento y
 * se puede deshacer; con varios se revisa antes en una tabla.
 */

// Nombre y correo vienen de la base: se ven, no se editan
const COLUMNS = [
  { key: "nombre", label: "Nombre", editable: false },
  { key: "correo", label: "Correo", editable: false },
];

/** A quién hay que reactivar: por id (de buscar_alumno) o por correo (del archivo). */
type Target = { id: string; email: string; name: string };
type Account = { id: string; fullName: string; email: string; active: boolean };

/** Las cuentas de alumno de toda la lista, en dos consultas (no una por fila). */
function accountsFor(targets: Target[]): { byId: Map<string, Account>; byEmail: Map<string, Account> } {
  const ids = targets.map((t) => t.id).filter(Boolean);
  const emails = targets.map((t) => t.email).filter(Boolean);
  const cols = { id: users.id, fullName: users.fullName, email: users.email, active: users.active };
  const found: Account[] = [
    ...(ids.length ? db.select(cols).from(users).where(and(inArray(users.id, ids), eq(users.role, "student"))).all() : []),
    ...(emails.length ? db.select(cols).from(users).where(and(inArray(users.email, emails), eq(users.role, "student"))).all() : []),
  ];
  return { byId: new Map(found.map((a) => [a.id, a])), byEmail: new Map(found.map((a) => [a.email, a])) };
}

/** Una fila por persona, con el aviso de por qué no se puede cuando toca. */
function toRows(targets: Target[], ctx: ToolCtx): ProposalRow[] {
  const { byId, byEmail } = accountsFor(targets);
  return targets.map((t, i) => {
    const account = t.id ? byId.get(t.id) : t.email ? byEmail.get(t.email) : undefined;
    const id = account?.id ?? `f${i}`;
    const cells = { nombre: account?.fullName ?? t.name ?? "", correo: account?.email ?? t.email ?? "" };
    if (!cells.nombre) cells.nombre = "(desconocido)";

    if (!account) return { id, cells, warning: "No hay ninguna cuenta con ese correo", blocked: true };
    if (!studentAccountPermissions(ctx.user, account.id).mine) {
      return { id, cells, warning: "No es uno de tus alumnos", blocked: true };
    }
    if (account.active) return { id, cells, warning: "Ya estaba activo", blocked: true };
    return { id, cells };
  });
}

export const reactivarAlumnos: AssistantTool = {
  name: "reactivar_alumnos",
  description:
    "Vuelve a activar cuentas de alumno deshabilitadas (de buscar_alumno, del archivo adjunto o de una lista pegada). Con un solo alumno se hace al momento y se puede deshacer; con varios se muestra una tabla para revisar.",
  parameters: schema({
    alumno_ids: strList("Ids de los alumnos, de buscar_alumno (solo con origen «ids»)"),
    origen: strEnum("De dónde salen los alumnos: «ids» (los alumno_ids), «adjunto» (el archivo de este mensaje) o «texto» (una lista pegada en el chat)", ["ids", "adjunto", "texto"]),
    texto: str("Solo con origen «texto»: la lista tal como la escribió el usuario («» en los demás casos)"),
    hoja: str("Nombre de la hoja del archivo cuando hay varias («» = la primera)"),
    filtro_color: strEnum("Tomar solo las filas pintadas de ese color en la hoja («» = todas)", ["", "rojo", "verde", "amarillo", "azul"]),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  async run(params, ctx) {
    const origen = param(params, "origen") || "ids";
    let targets: Target[];
    let note = "";
    if (origen === "ids") {
      const studentIds = [...new Set(paramList(params, "alumno_ids"))];
      if (studentIds.length === 0) return { forModel: "No me diste a quién reactivar: pásame los alumno_ids o de dónde sacar la lista." };
      targets = studentIds.map((id) => ({ id, email: "", name: "" }));
    } else {
      let people: RowsResult;
      try {
        const read = await readPeople(params, ctx);
        if ("error" in read) return { forModel: read.error };
        people = read;
      } catch (err) {
        return { forModel: err instanceof Error ? err.message : "No pude leer la lista de alumnos." };
      }
      if (people.rows.length === 0) return { forModel: `No encontré personas en esa lista. ${people.note}`.trim() };
      targets = people.rows.map((p) => ({ id: "", email: p.email, name: p.fullName }));
      note = people.note;
    }

    const rows = toRows(targets, ctx);

    // Uno solo: no hay nada que revisar y volver atrás es un clic
    if (rows.length === 1) {
      const row = rows[0];
      if (row.blocked) return { forModel: `No se pudo reactivar: ${row.warning}.` };
      setStudentActive(row.id, true);
      audit(ctx.user.id, "assistant_reactivar_alumnos", "user", row.id, { via: "assistant" });
      const text = `Cuenta reactivada: ${row.cells.nombre}.`;
      return {
        forModel: text,
        blocks: [
          { type: "result", text, undoable: true },
          { type: "links", links: [{ label: "Ver estudiantes", href: "/teach/students", icon: "user" }] },
        ],
        undo: { tool: "reactivar_alumnos", params: { alumno_id: row.id } },
      };
    }

    const proposalId = createProposal("reactivar_alumnos", ctx, ctx.messageId, {
      title: "Reactivar alumnos",
      applyLabel: "Reactivar",
      columns: COLUMNS,
      rows,
      payload: {},
    });

    // La IA solo ve cuántas son: los nombres y correos se quedan en la tabla
    const ok = rows.filter((r) => !r.blocked).length;
    const blocked = rows.length - ok;
    const parts = [`Se creó una propuesta con ${rows.length} fila(s): ${ok} lista(s) para reactivar`];
    if (blocked > 0) parts.push(`${blocked} con aviso (sin cuenta, de otro maestro o ya activas)`);
    if (note) parts.push(note);
    return { forModel: `${parts.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Aplica las filas ya revisadas. Se revalida cada una (alguien pudo
   * reactivarlas o dejar de compartirlas desde que se propuso): lo que hoy no
   * se puede, se salta y se cuenta aparte con su motivo.
   */
  apply(rows, payload, ctx) {
    const revalidated = toRows(rows.map((r) => ({ id: r.id, email: "", name: r.cells.nombre ?? "" })), ctx);
    const reasons: string[] = [];
    let done = 0;
    for (const row of revalidated) {
      if (row.blocked) {
        reasons.push(row.warning ?? "ya no se puede");
        continue;
      }
      setStudentActive(row.id, true);
      audit(ctx.user.id, "assistant_reactivar_alumnos", "user", row.id, { via: "assistant" });
      done++;
    }

    let text = `${done} alumno(s) reactivado(s).`;
    if (reasons.length > 0) text += ` ${reasons.length} no se pudieron: ${[...new Set(reasons)].join("; ")}.`;
    return { text, blocks: [{ type: "links", links: [{ label: "Ver estudiantes", href: "/teach/students", icon: "user" }] }] };
  },
  /**
   * Deshacer la reactivación instantánea: vuelve a deshabilitar la cuenta. Si
   * ya no procede, lanza: así el mensaje no se marca como deshecho.
   */
  undo(params, ctx) {
    const studentId = param(params, "alumno_id");
    if (!studentId) throw new Error("No se pudo deshacer: falta el alumno.");
    const account = accountsFor([{ id: studentId, email: "", name: "" }]).byId.get(studentId);
    if (!account) throw new Error("No se pudo deshacer: esa cuenta ya no existe.");
    const perms = studentAccountPermissions(ctx.user, studentId);
    if (!perms.mine) throw new Error("No se pudo deshacer: no es uno de tus alumnos.");
    if (!perms.canDeactivate) throw new Error("No se pudo deshacer: lo comparte otro maestro y solo el administrador puede deshabilitarlo.");
    if (!account.active) throw new Error("No se pudo deshacer: la cuenta ya estaba deshabilitada.");
    setStudentActive(studentId, false);
    audit(ctx.user.id, "assistant_reactivar_alumnos_undo", "user", studentId, { via: "assistant", conversationId: ctx.conversationId });
    const text = `Cuenta deshabilitada otra vez: ${account.fullName}.`;
    return { forModel: text, blocks: [{ type: "result", text }] };
  },
};
