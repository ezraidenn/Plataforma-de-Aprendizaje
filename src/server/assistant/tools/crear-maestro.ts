import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { adminCreateUser, adminSetCanEditBranding } from "@/server/services/admin";
import { BOM, csvLine } from "@/server/services/csv-core";
import { generateTempPassword } from "@/server/auth/passwords";
import { normalizeStudentEmail, normalizeStudentName, studentDraftProblem } from "@/lib/student-draft";
import type { AssistantBlock, ProposalRow } from "@/lib/assistant-blocks";
import { createExport, exportFileName } from "../exports";
import { createProposal } from "../proposal-store";
import { schema, str, strEnum, param, type AssistantTool } from "../tool-types";

/**
 * Dar de alta un maestro, como Administración → Usuarios: cuenta con rol
 * «maestro» y contraseña generada (la misma que genera el alta de alumnos, sin
 * caracteres que se confundan al dictarla). La contraseña no se guarda en
 * claro en ningún sitio: se entrega UNA vez en una descarga de la
 * conversación, que caduca a las 24 horas.
 *
 * El permiso de identidad de la empresa (logo, nombre, portada del acceso) es
 * aparte y solo tiene sentido en maestros: se concede aquí si se pide.
 */

const COLUMNS = [
  { key: "nombre", label: "Nombre" },
  { key: "correo", label: "Correo" },
  { key: "podra", label: "Podrá", editable: false },
];

const SOLO_CURSOS = "Crear y dar sus cursos";
const CON_IDENTIDAD = "Crear y dar sus cursos · editar la identidad de la empresa";

/** La fila de revisión: los mismos datos que pide la pantalla de alta. */
function toRow(nombre: string, correo: string, identidad: boolean): ProposalRow {
  const fullName = normalizeStudentName(nombre);
  const email = normalizeStudentEmail(correo);
  const cells = { nombre: fullName, correo: email, podra: identidad ? CON_IDENTIDAD : SOLO_CURSOS };
  const problem = studentDraftProblem({ fullName, email });
  if (problem) return { id: "f0", cells, warning: problem, blocked: true };
  if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    return { id: "f0", cells, warning: "Ese correo ya tiene cuenta en la plataforma", blocked: true };
  }
  return { id: "f0", cells };
}

export const crearMaestro: AssistantTool = {
  name: "crear_maestro",
  description:
    "Da de alta a un maestro: crea su cuenta con una contraseña generada y la deja para descargar. Solo el administrador. Muestra una tabla con el nombre, el correo y lo que podrá hacer antes de crear nada.",
  parameters: schema({
    nombre: str("Nombre completo del maestro"),
    correo: str("Correo con el que entrará a la plataforma"),
    puede_editar_identidad: strEnum(
      "«si» si además podrá cambiar la identidad de la empresa (logo, nombre, portada del acceso); «» = solo sus cursos",
      ["", "si"]
    ),
  }),
  roles: ["admin"],
  // Crear una cuenta no borra nada, pero se revisa el nombre y el correo antes
  risk: "review",
  run(params, ctx) {
    if (ctx.user.role !== "admin") return { forModel: "Dar de alta maestros solo lo puede hacer el administrador." };

    const nombre = param(params, "nombre");
    const correo = param(params, "correo");
    if (!nombre || !correo) {
      return { forModel: "Falta el nombre completo o el correo del maestro: pregúntaselo al usuario antes de crear la cuenta." };
    }
    const identidad = param(params, "puede_editar_identidad") === "si";

    const row = toRow(nombre, correo, identidad);
    const proposalId = createProposal("crear_maestro", ctx, ctx.messageId, {
      title: "Dar de alta un maestro",
      applyLabel: "Crear la cuenta",
      columns: COLUMNS,
      rows: [row],
      payload: { identidad },
      // El aviso es de datos (nombre corto, correo mal escrito): si el usuario
      // lo corrige en la tabla, `apply` lo vuelve a revisar
      recheckOnApply: true,
    });

    const detalle = row.blocked ? `con aviso: ${row.warning}` : `lista para crearse${identidad ? ", con permiso de identidad" : ""}`;
    return { forModel: `Se creó una propuesta con la cuenta del maestro, ${detalle}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Crea la cuenta con las celdas ya revisadas. Se revalida (el correo pudo
   * darse de alta mientras tanto) y la auditoría la deja `adminCreateUser`.
   */
  async apply(rows, payload, ctx) {
    if (ctx.user.role !== "admin") return { text: "Dar de alta maestros solo lo puede hacer el administrador; no se creó la cuenta." };

    const identidad = payload.identidad === true;
    const fila = rows[0];
    if (!fila) return { text: "No quedó ninguna cuenta que crear." };
    const row = toRow(fila.cells.nombre ?? "", fila.cells.correo ?? "", identidad);
    if (row.blocked) return { text: `No se creó la cuenta: ${row.warning?.toLowerCase()}.` };

    const password = generateTempPassword();
    let id: string;
    try {
      id = await adminCreateUser({
        actorId: ctx.user.id,
        fullName: row.cells.nombre,
        email: row.cells.correo,
        password,
        role: "teacher",
      });
    } catch (err) {
      return { text: `No se creó la cuenta: ${err instanceof Error ? err.message : "falló el alta"}.` };
    }
    if (identidad) adminSetCanEditBranding(ctx.user.id, id, true);

    // La contraseña se genera una vez y no se vuelve a ver: va en una descarga
    // de la conversación, que caduca a las 24 horas
    const csv = `${BOM}${csvLine(["nombre", "correo", "contrasena"])}\r\n${csvLine([row.cells.nombre, row.cells.correo, password])}`;
    const exportId = createExport(ctx.conversationId, exportFileName("maestro"), csv);

    const text =
      `${row.cells.nombre} ya tiene cuenta de maestro (${row.cells.correo})` +
      (identidad ? " y puede editar la identidad de la empresa." : ".") +
      " Sus datos de acceso están en la descarga de aquí abajo: guárdalos, la contraseña no se vuelve a mostrar." +
      " Dile que la cambie en cuanto entre, desde Ajustes → Contraseña.";
    const blocks: AssistantBlock[] = [
      { type: "download", label: "Descargar los datos de acceso", href: `/api/assistant/export/${exportId}`, detail: "Caduca en 24 horas" },
      { type: "links", links: [{ label: "Ver usuarios", href: "/admin/users", icon: "user" }] },
    ];
    return { text, blocks };
  },
};
