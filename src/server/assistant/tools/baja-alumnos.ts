import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { setStudentActive } from "@/server/services/courses";
import { studentAccountPermissions } from "@/server/services/student-scope";
import { adminDeleteUser, adminDeleteUserImpact } from "@/server/services/admin";
import { audit } from "@/server/services/audit";
import { readPeople } from "./alta-alumnos";
import { createProposal } from "../proposal-store";
import { schema, str, strEnum, strList, param, paramList, type AssistantTool, type ToolCtx } from "../tool-types";
import type { ProposalRow } from "@/lib/assistant-blocks";
import type { RowsResult } from "../rows-from-attachment";

/**
 * Baja de alumnos en lote, con dos modos muy distintos: «deshabilitar» cierra
 * la cuenta sin perder nada (se puede volver) y «borrar» la elimina para
 * siempre (solo el administrador y escribiendo BORRAR). La lista sale de
 * buscar_alumno, del archivo adjunto o de una lista pegada; el servidor busca
 * cada cuenta, arma la tabla de revisión y, al confirmar, revalida fila a fila.
 */

// Nombre y correo vienen de la base: se ven, no se editan
const COLUMNS = [
  { key: "nombre", label: "Nombre", editable: false },
  { key: "correo", label: "Correo", editable: false },
];

type Modo = "deshabilitar" | "borrar";
/** A quién hay que dar de baja: por id (de buscar_alumno) o por correo (del archivo). */
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
function toRows(targets: Target[], modo: Modo, ctx: ToolCtx): ProposalRow[] {
  const { byId, byEmail } = accountsFor(targets);
  return targets.map((t, i) => {
    const account = t.id ? byId.get(t.id) : t.email ? byEmail.get(t.email) : undefined;
    const id = account?.id ?? `f${i}`;
    const cells = { nombre: account?.fullName ?? t.name ?? "", correo: account?.email ?? t.email ?? "" };
    if (!cells.nombre) cells.nombre = "(desconocido)";

    if (!t.id && !t.email) return { id, cells, warning: "Sin correo para identificarla", blocked: true };
    if (!account) return { id, cells, warning: "No hay ninguna cuenta con ese correo", blocked: true };

    const perms = studentAccountPermissions(ctx.user, account.id);
    if (!perms.mine) return { id, cells, warning: "No es uno de tus alumnos", blocked: true };

    if (modo === "deshabilitar") {
      if (!perms.canDeactivate) {
        return { id, cells, warning: "Lo comparte otro maestro: solo el administrador puede deshabilitarlo", blocked: true };
      }
      if (!account.active) return { id, cells, warning: "Ya estaba deshabilitado", blocked: true };
      return { id, cells };
    }

    // Borrar: lo que impide eliminar la cuenta es lo mismo que en Administración
    const blocker = adminDeleteUserImpact(ctx.user.id, account.id).blockers[0];
    if (blocker) return { id, cells, warning: blocker, blocked: true };
    return { id, cells };
  });
}

export const bajaAlumnos: AssistantTool = {
  name: "baja_alumnos",
  description:
    "Da de baja alumnos en lote (de buscar_alumno, del archivo adjunto o de una lista pegada): deshabilitar cierra la cuenta y se puede volver; borrar la elimina para siempre y solo lo hace el administrador. Siempre se muestra una tabla para revisar.",
  parameters: schema({
    modo: strEnum(
      "«deshabilitar» = la cuenta se cierra pero se puede volver a activar; «borrar» = se pierde todo para siempre y solo lo puede hacer el administrador. «» si el usuario aún no lo ha dicho: no lo supongas, pregúntaselo",
      ["", "deshabilitar", "borrar"]
    ),
    alumno_ids: strList("Ids de los alumnos, de buscar_alumno (solo con origen «ids»)"),
    origen: strEnum("De dónde salen los alumnos: «ids» (los alumno_ids), «adjunto» (el archivo de este mensaje) o «texto» (una lista pegada en el chat)", ["ids", "adjunto", "texto"]),
    texto: str("Solo con origen «texto»: la lista tal como la escribió el usuario («» en los demás casos)"),
    hoja: str("Nombre de la hoja del archivo cuando hay varias («» = la primera)"),
    filtro_color: strEnum("Tomar solo las filas pintadas de ese color en la hoja («» = todas)", ["", "rojo", "verde", "amarillo", "azul"]),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  async run(params, ctx) {
    const modo = param(params, "modo");
    if (modo !== "deshabilitar" && modo !== "borrar") {
      return {
        forModel:
          "Falta decidir: ¿deshabilitar (pueden volver) o borrar definitivamente (se pierde todo)? Pregúntaselo al usuario con esas dos opciones.",
      };
    }
    if (modo === "borrar" && ctx.user.role !== "admin") {
      return { forModel: "Borrar cuentas definitivamente solo lo puede hacer el administrador. Puedo deshabilitarlos, que es reversible." };
    }

    const origen = param(params, "origen") || "ids";
    let targets: Target[];
    let note = "";
    if (origen === "ids") {
      const studentIds = [...new Set(paramList(params, "alumno_ids"))];
      if (studentIds.length === 0) return { forModel: "No me diste a quién dar de baja: pásame los alumno_ids o de dónde sacar la lista." };
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

    const rows = toRows(targets, modo, ctx);
    const proposalId = createProposal("baja_alumnos", ctx, ctx.messageId, {
      title: modo === "borrar" ? "Borrar cuentas definitivamente" : "Deshabilitar alumnos",
      applyLabel: modo === "borrar" ? "Borrar" : "Deshabilitar",
      columns: COLUMNS,
      rows,
      payload: { modo },
      confirmWord: modo === "borrar" ? "BORRAR" : undefined,
    });

    // La IA solo ve cuántas son: los nombres y correos se quedan en la tabla
    const ok = rows.filter((r) => !r.blocked).length;
    const blocked = rows.length - ok;
    const parts = [
      `Se creó una propuesta con ${rows.length} fila(s): ${ok} lista(s) para ${modo === "borrar" ? "borrar definitivamente" : "deshabilitar"}`,
    ];
    if (blocked > 0) parts.push(`${blocked} con aviso (sin cuenta, de otro maestro o ya deshabilitadas)`);
    if (modo === "borrar") parts.push("para aplicarla habrá que escribir BORRAR");
    if (note) parts.push(note);
    return { forModel: `${parts.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Aplica las filas ya revisadas. Se revalida cada una (los permisos pudieron
   * cambiar desde que se propuso): lo que hoy no se puede, se salta y se cuenta
   * aparte con su motivo.
   */
  async apply(rows, payload, ctx, confirm) {
    const modo = String(payload.modo ?? "");
    if (modo !== "deshabilitar" && modo !== "borrar") return { text: "No se hizo nada: falta saber si deshabilitar o borrar." };
    if (modo === "borrar") {
      if (ctx.user.role !== "admin") return { text: "Borrar cuentas definitivamente solo lo puede hacer el administrador; no se borró ninguna." };
      if (confirm.trim().toLowerCase() !== "borrar") return { text: "No se borró ninguna cuenta: falta escribir BORRAR." };
    }

    const revalidated = toRows(rows.map((r) => ({ id: r.id, email: "", name: r.cells.nombre ?? "" })), modo, ctx);
    const reasons: string[] = [];
    let done = 0;
    for (const row of revalidated) {
      if (row.blocked) {
        reasons.push(row.warning ?? "ya no se puede");
        continue;
      }
      if (modo === "deshabilitar") {
        setStudentActive(row.id, false);
        audit(ctx.user.id, "assistant_baja_alumnos", "user", row.id, { via: "assistant", modo: "deshabilitar" });
        done++;
        continue;
      }
      // El correo de la segunda confirmación es el de la cuenta, leído de la base
      const email = db.select({ email: users.email }).from(users).where(eq(users.id, row.id)).get()?.email;
      if (!email) {
        reasons.push("esa cuenta ya no existe");
        continue;
      }
      try {
        adminDeleteUser(ctx.user.id, row.id, email);
        audit(ctx.user.id, "assistant_baja_alumnos", "user", row.id, { via: "assistant", modo: "borrar" });
        done++;
      } catch (err) {
        reasons.push(err instanceof Error ? err.message : "no se pudo borrar");
      }
    }

    let text = modo === "borrar" ? `${done} cuenta(s) borrada(s) definitivamente.` : `${done} alumno(s) deshabilitado(s).`;
    if (reasons.length > 0) text += ` ${reasons.length} no se pudieron: ${[...new Set(reasons)].join("; ")}.`;
    return { text, blocks: [{ type: "links", links: [{ label: "Ver estudiantes", href: "/teach/students", icon: "user" }] }] };
  },
};
