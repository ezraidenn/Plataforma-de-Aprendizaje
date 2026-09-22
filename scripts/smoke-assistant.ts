/**
 * Asistente de IA, sin gastar en la API: placeholder por ruta, cliente con
 * herramientas (OpenAI simulada), catálogo por rol, bucle del agente,
 * matrícula instantánea con deshacer, propuesta → editar → aplicar,
 * conversaciones e historial. Datos con prefijo «zasst», borrados al final.
 *
 * Uso: pnpm smoke:assistant
 */
import { placeholderFor } from "../src/lib/assistant-placeholder";
import { requestWithTools, type ChatItem, type ToolDef } from "../src/server/services/ai-client";
import { and, eq, inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/server/db";
import { aiConversations, aiProposals, auditLog, courses as coursesTable, enrollments, users } from "../src/server/db/schema";
import { createCourse, enrollStudents } from "../src/server/services/courses";
import { ownScope, type ViewScope } from "../src/server/auth/view-scope";
import type { SessionUser } from "../src/server/auth/sessions";
import { toolsForRole, toolByName, toolDefsForRole } from "../src/server/assistant/registry";
import type { ToolCtx } from "../src/server/assistant/tool-types";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  patchProposalBlock,
} from "../src/server/services/ai-conversations";
import { applyProposal, cancelProposal, expireProposals, getProposal } from "../src/server/assistant/proposals";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function placeholderChecks() {
  console.log("\n— Texto del campo según la ruta");
  check("Inicio", placeholderFor("/teach/dashboard") === "Habla con la IA o suelta un archivo");
  check("Estudiantes", placeholderFor("/teach/students") === "Habla con la IA o suelta aquí la lista de alumnos");
  check("Cursos", placeholderFor("/teach/courses") === "Habla con la IA o suelta la lista de cursos");
  check("Dentro de un curso", placeholderFor("/teach/courses/abc123/content") === "Habla con la IA sobre este curso");
  check("Perfil de alumno", placeholderFor("/teach/students/xyz") === "Habla con la IA sobre este alumno");
  check("Otra ruta", placeholderFor("/admin/users") === "Habla con la IA o suelta un archivo");
}

/** Respuesta simulada de la Responses API: `output` tal cual. */
function fakeOutput(output: unknown[], status = 200) {
  return async () =>
    new Response(JSON.stringify(status === 200 ? { output } : { error: { message: "fallo" } }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    name: "buscar_curso",
    description: "Busca cursos",
    strict: true,
    parameters: { type: "object", additionalProperties: false, properties: { texto: { type: "string" } }, required: ["texto"] },
  },
];

async function clientChecks() {
  console.log("\n— Cliente con herramientas");
  const input: ChatItem[] = [
    { role: "system", content: "sistema" },
    { role: "user", content: "busca extintores" },
  ];
  const opts = { key: "sk-test", model: "gpt-x" };

  const call = await requestWithTools(input, TOOL_DEFS, {
    ...opts,
    fetchImpl: fakeOutput([{ type: "function_call", call_id: "c1", name: "buscar_curso", arguments: JSON.stringify({ texto: "extintores" }) }]),
  }, 5000);
  check("Devuelve la llamada a herramienta", call.calls.length === 1 && call.calls[0].name === "buscar_curso" && call.calls[0].callId === "c1");
  check("…con los argumentos ya parseados", (call.calls[0].args as { texto: string }).texto === "extintores");
  check("…y sin texto", call.text === null);

  const text = await requestWithTools(input, TOOL_DEFS, {
    ...opts,
    fetchImpl: fakeOutput([{ type: "message", content: [{ type: "output_text", text: "Encontré 2 cursos." }] }]),
  }, 5000);
  check("Devuelve texto cuando no llama herramientas", text.text === "Encontré 2 cursos." && text.calls.length === 0);

  let sent: unknown = null;
  const capture = async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return fakeOutput([{ type: "message", content: [{ type: "output_text", text: "ok" }] }])();
  };
  await requestWithTools(input, TOOL_DEFS, { ...opts, fetchImpl: capture as typeof fetch }, 5000);
  const body = sent as { tools: ToolDef[]; tool_choice: string; input: unknown[] };
  check("Manda las herramientas y deja elegir a la IA", body.tools.length === 1 && body.tool_choice === "auto");
  check("Manda el historial tal cual", body.input.length === 2);

  let sentNoTools: unknown = null;
  const captureNoTools = async (_url: string | URL | Request, init?: RequestInit) => {
    sentNoTools = JSON.parse(String(init?.body));
    return fakeOutput([{ type: "message", content: [{ type: "output_text", text: "ok" }] }])();
  };
  await requestWithTools(input, [], { ...opts, fetchImpl: captureNoTools as typeof fetch }, 5000);
  const bodyNoTools = sentNoTools as { tools?: unknown; tool_choice: string };
  check("Sin herramientas: tool_choice none y sin lista", bodyNoTools.tool_choice === "none" && bodyNoTools.tools === undefined);

  const bad = await requestWithTools(input, TOOL_DEFS, {
    ...opts,
    fetchImpl: fakeOutput([{ type: "function_call", call_id: "c2", name: "buscar_curso", arguments: "{no json" }]),
  }, 5000).catch((e: Error) => e.message);
  check("Argumentos ilegibles: respuesta mal formada", typeof bad === "string" && bad.includes("mal formada"));

  const denied = await requestWithTools(input, TOOL_DEFS, { ...opts, fetchImpl: fakeOutput([], 401) }, 5000).catch((e: Error) => e.message);
  check("Clave inválida: mensaje claro", typeof denied === "string" && denied.includes("rechazó la clave"));
}

const P = "zasst";
const ids = { teacher: nanoid(), admin: nanoid(), s1: nanoid(), s2: nanoid(), course: "" };

function makeUser(id: string, key: string, name: string, role: "teacher" | "admin" | "student", createdBy: string | null) {
  db.insert(users).values({ id, email: `${P}-${key}@test.local`, passwordHash: "x", fullName: `${P} ${name}`, role, createdBy }).run();
}

function setup() {
  cleanup();
  makeUser(ids.teacher, "maestro", "Maestro", "teacher", null);
  makeUser(ids.admin, "admin", "Admin", "admin", null);
  makeUser(ids.s1, "ana", "Ana López", "student", ids.teacher);
  makeUser(ids.s2, "beto", "Beto Ruiz", "student", ids.teacher);
  ids.course = createCourse({ ownerId: ids.teacher, title: `${P} Extintores` }).id;
  enrollStudents(ids.course, [ids.s1], ids.teacher);
}

function cleanup() {
  const userIds = db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%`)).all().map((u) => u.id);
  if (userIds.length === 0) return;
  db.transaction(() => {
    // Auditoría que dejó el asistente: propuestas de las conversaciones zasst y matrículas de los cursos zasst
    const convIds = db.select({ id: aiConversations.id }).from(aiConversations).where(like(aiConversations.title, `${P}%`)).all().map((c) => c.id);
    const proposalIds = convIds.length
      ? db.select({ id: aiProposals.id }).from(aiProposals).where(inArray(aiProposals.conversationId, convIds)).all().map((p) => p.id)
      : [];
    if (proposalIds.length) db.delete(auditLog).where(and(eq(auditLog.entity, "ai_proposal"), inArray(auditLog.entityId, proposalIds))).run();
    db.delete(aiConversations).where(like(aiConversations.title, `${P}%`)).run();
    const courseIds = db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P}%`)).all().map((c) => c.id);
    for (const id of courseIds) {
      db.delete(auditLog).where(and(eq(auditLog.entity, "enrollment"), like(auditLog.entityId, `${id}:%`))).run();
      db.delete(enrollments).where(eq(enrollments.courseId, id)).run();
      db.delete(coursesTable).where(eq(coursesTable.id, id)).run();
    }
    for (const id of userIds) db.delete(users).where(eq(users.id, id)).run();
  });
}

const teacherUser: SessionUser = { id: "", email: "", fullName: `${P} Maestro`, role: "teacher" };
function ctxFor(user: SessionUser, scope: ViewScope, route = "/teach/dashboard"): ToolCtx {
  return { user, scope, actingOwnerId: scope.kind === "teacher" ? scope.ownerId : user.id, route, conversationId: "conv-test" };
}

async function catalogChecks() {
  console.log("\n— Catálogo por rol");
  const teacherNames = toolsForRole("teacher").map((t) => t.name);
  check("Maestro: ir_a, buscar_alumno, buscar_curso, ficha_alumno, resumen_curso, matricular", ["ir_a", "buscar_alumno", "buscar_curso", "ficha_alumno", "resumen_curso", "matricular"].every((n) => teacherNames.includes(n)), teacherNames);
  check("Admin tiene las mismas o más", toolsForRole("admin").length >= teacherNames.length);
  check("Nombres únicos", new Set(teacherNames).size === teacherNames.length);
  const defs = toolDefsForRole("teacher");
  check("Definiciones estrictas con esquema de objeto", defs.every((d) => d.strict && (d.parameters as { type: string }).type === "object"));
  check("Toda propiedad es requerida (esquema estricto)", defs.every((d) => {
    const p = d.parameters as { properties: Record<string, unknown>; required: string[] };
    return Object.keys(p.properties).every((k) => p.required.includes(k));
  }));
  check("toolByName desconocida: null", toolByName("nada") === null);
}

async function readToolChecks() {
  console.log("\n— Herramientas de lectura y navegación");
  const user = { ...teacherUser, id: ids.teacher };
  const ctx = ctxFor(user, ownScope(user));

  const nav = await toolByName("ir_a")!.run({ destino: "alumno", id: ids.s1 }, ctx);
  check("ir_a alumno → URL del perfil", nav.navigate === `/teach/students/${ids.s1}`);
  const navCourse = await toolByName("ir_a")!.run({ destino: "contenido", id: ids.course }, ctx);
  check("ir_a contenido → URL del curso", navCourse.navigate === `/teach/courses/${ids.course}/content`);
  const navBad = await toolByName("ir_a")!.run({ destino: "alumno", id: "" }, ctx);
  check("ir_a alumno sin id: lo dice", !navBad.navigate && navBad.forModel.includes("id"));

  const found = await toolByName("buscar_alumno")!.run({ texto: "ana lópez" }, ctx);
  check("buscar_alumno encuentra a Ana", found.forModel.includes("Ana López") && found.forModel.includes(ids.s1));
  const none = await toolByName("buscar_alumno")!.run({ texto: "nadie-asi" }, ctx);
  check("buscar_alumno sin resultados lo dice", none.forModel.includes("No hay alumnos"));

  // Id de admin pero rol maestro a propósito: un maestro distinto no ve a los alumnos de otro
  const other: SessionUser = { id: ids.admin, email: "", fullName: "x", role: "teacher" };
  const invisible = await toolByName("buscar_alumno")!.run({ texto: "ana" }, ctxFor(other, ownScope(other)));
  check("Otro maestro no ve a Ana", !invisible.forModel.includes(ids.s1));

  const course = await toolByName("buscar_curso")!.run({ texto: "extintores" }, ctx);
  check("buscar_curso encuentra el curso", course.forModel.includes(ids.course));

  const ficha = await toolByName("ficha_alumno")!.run({ alumno_id: ids.s1 }, ctx);
  check("ficha_alumno: cursos y tiles", ficha.forModel.includes("Extintores") && (ficha.blocks ?? []).some((b) => b.type === "tiles"));
  check("ficha_alumno: enlace al perfil", (ficha.blocks ?? []).some((b) => b.type === "links" && b.links[0].href === `/teach/students/${ids.s1}`));
  const fichaAjena = await toolByName("ficha_alumno")!.run({ alumno_id: ids.s1 }, ctxFor(other, ownScope(other)));
  check("ficha_alumno ajena: denegada", fichaAjena.forModel.includes("No encontramos"));

  const resumen = await toolByName("resumen_curso")!.run({ curso_id: ids.course }, ctx);
  check("resumen_curso: 1 matriculado", resumen.forModel.includes("1 matriculado"));
}

async function conversationChecks() {
  console.log("\n— Conversaciones");
  const conv = createConversation(ids.teacher, `${P} primera`);
  const m1 = appendMessage(conv.id, "user", [{ type: "text", text: "hola" }], "hola");
  const m2 = appendMessage(conv.id, "assistant", [{ type: "text", text: "¿En qué te ayudo?" }], "¿En qué te ayudo?");
  const loaded = getConversation(ids.teacher, conv.id);
  check("Se guardan y se leen en orden", loaded?.messages.map((m) => m.id).join() === `${m1.id},${m2.id}`);
  check("Otro usuario no la ve", getConversation(ids.admin, conv.id) === null);
  check("Aparece en el historial con su título", listConversations(ids.teacher).some((c) => c.id === conv.id && c.title === `${P} primera`));
  check("Historial filtra por texto", listConversations(ids.teacher, "primera").length >= 1 && listConversations(ids.teacher, "zzz-nada").length === 0);
  check("Borrar: desaparece", deleteConversation(ids.teacher, conv.id) && getConversation(ids.teacher, conv.id) === null);
}

async function proposalChecks() {
  console.log("\n— Propuestas y matrícula");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} matrícula`);
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id };

  // 1 alumno: instantánea con deshacer
  const one = await toolByName("matricular")!.run({ alumno_ids: [ids.s2], curso_id: ids.course }, ctx);
  check("1 alumno: se matricula al momento", one.forModel.includes("Beto Ruiz") && one.undo?.tool === "desmatricular");
  const enrolled = db.select().from(enrollments).where(and(eq(enrollments.courseId, ids.course), eq(enrollments.studentId, ids.s2))).get();
  check("…y la matrícula existe", enrolled?.status === "active");
  const undone = await toolByName(one.undo!.tool)!.run(one.undo!.params, ctx);
  check("Deshacer la desmatricula", undone.forModel.includes("baja") && db.select().from(enrollments).where(eq(enrollments.id, enrolled!.id)).get()?.status === "dropped");

  // Varios: propuesta
  const many = await toolByName("matricular")!.run({ alumno_ids: [ids.s1, ids.s2, "no-existe"], curso_id: ids.course }, ctx);
  check("Varios: crea una propuesta", typeof many.proposalId === "string" && many.forModel.includes("propuesta"));
  const proposal = getProposal(many.proposalId!);
  check("3 filas: 1 bloqueada (id inexistente) y 1 con aviso (ya matriculado)", proposal?.rows.length === 3 && proposal.rows.filter((r) => r.blocked).length === 2 && proposal.rows.some((r) => r.warning?.includes("Ya está matriculado")), proposal?.rows);

  // Se quita una fila y se aplica
  const kept = proposal!.rows.filter((r) => r.cells.nombre.includes("Beto"));
  const applied = await applyProposal(many.proposalId!, kept, ctx);
  check("Aplicar matricula solo a Beto", "text" in applied && applied.text.startsWith("1 ") && db.select().from(enrollments).where(and(eq(enrollments.courseId, ids.course), eq(enrollments.studentId, ids.s2))).get()?.status === "active");
  check("Queda como aplicada", getProposal(many.proposalId!)?.status === "applied");
  const again = await applyProposal(many.proposalId!, kept, ctx);
  check("No se aplica dos veces", "error" in again);
  check("Auditoría via assistant", db.select().from(auditLog).where(and(eq(auditLog.entity, "ai_proposal"), eq(auditLog.entityId, many.proposalId!))).get() !== undefined);

  // Una fila bloqueada mandada por el cliente no se aplica
  const p2 = await toolByName("matricular")!.run({ alumno_ids: ["tampoco-existe", "ni-este"], curso_id: ids.course }, ctx);
  const forced = await applyProposal(p2.proposalId!, getProposal(p2.proposalId!)!.rows.map((r) => ({ ...r, blocked: false, warning: undefined })), ctx);
  check("Fila bloqueada forzada: 0 aplicadas", "text" in forced && forced.text.startsWith("0 "));

  // Otro usuario no puede aplicar
  const p3 = await toolByName("matricular")!.run({ alumno_ids: [ids.s1, ids.s2], curso_id: ids.course }, ctx);
  const otherCtx = { ...ctxFor({ ...teacherUser, id: ids.admin }, ownScope({ ...teacherUser, id: ids.admin })), conversationId: conv.id };
  check("Otro usuario no aplica ni cancela", "error" in (await applyProposal(p3.proposalId!, [], otherCtx)) && !cancelProposal(p3.proposalId!, ids.admin));
  check("Cancelar", cancelProposal(p3.proposalId!, ids.teacher) && getProposal(p3.proposalId!)?.status === "cancelled");

  // Caducar
  const p4 = await toolByName("matricular")!.run({ alumno_ids: [ids.s1, ids.s2], curso_id: ids.course }, ctx);
  db.update(aiProposals).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiProposals.id, p4.proposalId!)).run();
  expireProposals();
  check("Caducar", getProposal(p4.proposalId!)?.status === "expired");
  const late = await applyProposal(p4.proposalId!, [], ctx);
  check("Aplicar caducada: error claro", "error" in late && late.error.includes("caducó"));

  // El bloque de la propuesta se congela en el mensaje
  const withBlock = appendMessage(conv.id, "assistant", [{ type: "proposal", proposalId: p3.proposalId!, title: "t", applyLabel: "Aplicar", columns: [], rows: [], status: "pending" }], "");
  patchProposalBlock(conv.id, p3.proposalId!, { status: "cancelled" });
  const frozen = getConversation(ids.teacher, conv.id)!.messages.find((m) => m.id === withBlock.id)!.blocks[0];
  check("patchProposalBlock cambia el estado en el mensaje", frozen.type === "proposal" && frozen.status === "cancelled");

  // desmatricular normal: propuesta
  const un = await toolByName("desmatricular")!.run({ alumno_ids: [ids.s1, ids.s2], curso_id: ids.course }, ctx);
  check("desmatricular varios: propuesta", typeof un.proposalId === "string");
}

async function main() {
  placeholderChecks();
  await clientChecks();
  setup();
  try {
    await catalogChecks();
    await readToolChecks();
    await conversationChecks();
    await proposalChecks();
  } finally {
    cleanup();
  }
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
