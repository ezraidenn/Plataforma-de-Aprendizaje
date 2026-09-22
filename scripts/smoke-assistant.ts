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
import { createCourse, enrollStudents, unenrollStudent } from "../src/server/services/courses";
import { ownScope, type ViewScope } from "../src/server/auth/view-scope";
import type { SessionUser } from "../src/server/auth/sessions";
import { toolsForRole, toolByName, toolDefsForRole } from "../src/server/assistant/registry";
import { runTurn } from "../src/server/assistant/agent";
import { systemPrompt } from "../src/server/assistant/prompt";
import type { ToolCtx } from "../src/server/assistant/tool-types";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  messageUndo,
  patchProposalBlock,
  recentModelText,
} from "../src/server/services/ai-conversations";
import { applyProposal, cancelProposal, expireProposals, getProposal } from "../src/server/assistant/proposals";
import {
  MAX_SUMMARY_CHARS,
  colorFamily,
  suggestionsFor,
  summaryForModel,
  type AttachmentSummary,
} from "../src/lib/attachment-summary";
import { readSheetRows } from "../src/server/services/sheet-colors";
import { summarizeAttachment } from "../src/server/services/attachment-intake";
import { peopleRows, headerIndex } from "../src/server/assistant/rows-from-attachment";
import { resolveUploadMime } from "../src/lib/upload-types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// LibreOffice: el de .env o el de la instalación estándar de Windows
const SOFFICE_DEFAULT = "C:/Program Files/LibreOffice/program/soffice.exe";
if (!process.env.SOFFICE_PATH && existsSync(SOFFICE_DEFAULT)) process.env.SOFFICE_PATH = SOFFICE_DEFAULT;
const HAS_SOFFICE = !!process.env.SOFFICE_PATH && existsSync(process.env.SOFFICE_PATH);

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
const ids = { teacher: nanoid(), admin: nanoid(), s1: nanoid(), s2: nanoid(), s3: nanoid(), s4: nanoid(), course: "" };

function makeUser(id: string, key: string, name: string, role: "teacher" | "admin" | "student", createdBy: string | null) {
  db.insert(users).values({ id, email: `${P}-${key}@test.local`, passwordHash: "x", fullName: `${P} ${name}`, role, createdBy }).run();
}

function setup() {
  cleanup();
  makeUser(ids.teacher, "maestro", "Maestro", "teacher", null);
  makeUser(ids.admin, "admin", "Admin", "admin", null);
  makeUser(ids.s1, "ana", "Ana López", "student", ids.teacher);
  makeUser(ids.s2, "beto", "Beto Ruiz", "student", ids.teacher);
  // Alumno de otro maestro: el asistente no debe poder matricularlo
  makeUser(ids.s3, "carla", "Carla Ajena", "student", ids.admin);
  // Nunca se matricula: sirve para comprobar que una segunda acción en el mismo turno no se ejecuta
  makeUser(ids.s4, "dora", "Dora Sola", "student", ids.teacher);
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
      // Cubre assistant_matricular y assistant_matricular_undo
      db.delete(auditLog).where(and(eq(auditLog.entity, "enrollment"), like(auditLog.entityId, `${id}:%`))).run();
      db.delete(enrollments).where(eq(enrollments.courseId, id)).run();
      db.delete(coursesTable).where(eq(coursesTable.id, id)).run();
    }
    for (const id of userIds) db.delete(users).where(eq(users.id, id)).run();
  });
}

const teacherUser: SessionUser = { id: "", email: "", fullName: `${P} Maestro`, role: "teacher" };
function ctxFor(user: SessionUser, scope: ViewScope, route = "/teach/dashboard"): ToolCtx {
  // Las herramientas de lectura no usan conversationId ni messageId; las de propuesta reciben uno real
  return { user, scope, actingOwnerId: scope.kind === "teacher" ? scope.ownerId : user.id, route, conversationId: "conv-test", messageId: "msg-test", attachments: [] };
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
  const navEvil = await toolByName("ir_a")!.run({ destino: "alumno", id: "../admin?x=1" }, ctx);
  check("ir_a con id raro: inválido y sin navegar", !navEvil.navigate && navEvil.forModel === "Id inválido.");

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
  // Historial para la IA: mensaje vacío (ancla de propuesta) fuera, orden cronológico
  appendMessage(conv.id, "assistant", [], "");
  appendMessage(conv.id, "user", [{ type: "text", text: "otra" }], "otra");
  const recent = recentModelText(conv.id, 3);
  check("recentModelText: últimos 3 → 2 con texto, en orden", recent.map((m) => `${m.role}:${m.text}`).join("|") === "assistant:¿En qué te ayudo?|user:otra", recent);
  check("Borrar: desaparece", deleteConversation(ids.teacher, conv.id) && getConversation(ids.teacher, conv.id) === null);
}

async function proposalChecks() {
  console.log("\n— Propuestas y matrícula");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} matrícula`);
  // Ancla real: las propuestas cuelgan del mensaje del asistente del turno
  const anchor = appendMessage(conv.id, "assistant", [], "").id;
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor };

  // 1 alumno: instantánea con deshacer
  const one = await toolByName("matricular")!.run({ alumno_ids: [ids.s2], curso_id: ids.course }, ctx);
  check("1 alumno: se matricula al momento", one.forModel.startsWith("Matrícula hecha:") && one.forModel.includes("Beto Ruiz") && one.undo?.tool === "matricular" && !("__undo" in (one.undo?.params ?? {})), one.forModel);
  const enrolled = db.select().from(enrollments).where(and(eq(enrollments.courseId, ids.course), eq(enrollments.studentId, ids.s2))).get();
  check("…y la matrícula existe", enrolled?.status === "active");
  const undoTool = toolByName(one.undo!.tool)!;
  const undone = await undoTool.undo!(one.undo!.params, ctx);
  check("Deshacer la desmatricula", undone.forModel.includes("Baja hecha") && db.select().from(enrollments).where(eq(enrollments.id, enrolled!.id)).get()?.status === "dropped");
  check("Deshacer deja auditoría", db.select().from(auditLog).where(and(eq(auditLog.action, "assistant_matricular_undo"), eq(auditLog.entityId, `${ids.course}:${ids.s2}`))).get() !== undefined);
  const undoAgain = await Promise.resolve()
    .then(() => undoTool.undo!(one.undo!.params, ctx))
    .then(() => null, (e: Error) => e.message);
  check("Deshacer de nuevo (ya de baja): lanza, no devuelve texto", typeof undoAgain === "string" && undoAgain.startsWith("No se pudo deshacer"), undoAgain);

  // Alumno de otro maestro: fila bloqueada
  const foreign = await toolByName("matricular")!.run({ alumno_ids: [ids.s2, ids.s3], curso_id: ids.course }, ctx);
  const foreignRows = getProposal(foreign.proposalId!)!.rows;
  check("Alumno ajeno: fila bloqueada «No es uno de tus alumnos»", foreignRows.some((r) => r.id === ids.s3 && r.blocked && r.warning === "No es uno de tus alumnos") && foreignRows.some((r) => r.id === ids.s2 && !r.blocked), foreignRows);
  cancelProposal(foreign.proposalId!, ids.teacher);

  // Varios: propuesta
  const many = await toolByName("matricular")!.run({ alumno_ids: [ids.s1, ids.s2, "no-existe"], curso_id: ids.course }, ctx);
  check("Varios: crea una propuesta", typeof many.proposalId === "string" && many.forModel.includes("propuesta"));
  check("La propuesta cuelga del mensaje del contexto, sin mensaje fantasma", getProposal(many.proposalId!)?.messageId === anchor && getConversation(ids.teacher, conv.id)!.messages.length === 1);
  const proposal = getProposal(many.proposalId!);
  check("3 filas: 2 bloqueadas (id inexistente y ya matriculado)", proposal?.rows.length === 3 && proposal.rows.filter((r) => r.blocked).length === 2 && proposal.rows.some((r) => r.warning?.includes("Ya está matriculado")), proposal?.rows);

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
  const otherCtx = { ...ctxFor({ ...teacherUser, id: ids.admin }, ownScope({ ...teacherUser, id: ids.admin })), conversationId: conv.id, messageId: anchor };
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

/** IA de guion: cada llamada devuelve el siguiente `output`. */
function scripted(outputs: unknown[][]) {
  let i = 0;
  const bodies: unknown[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const output = outputs[Math.min(i, outputs.length - 1)];
    i++;
    return new Response(JSON.stringify({ output }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, bodies, calls: () => i };
}

const say = (text: string) => ({ type: "message", content: [{ type: "output_text", text }] });
const call = (id: string, name: string, args: unknown) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });

async function agentChecks() {
  console.log("\n— Bucle del agente");
  const user = { ...teacherUser, id: ids.teacher };
  // Beto quedó matriculado en proposalChecks; la matrícula instantánea de abajo lo necesita fuera
  unenrollStudent(ids.course, ids.s2, ids.teacher);
  const prompt = systemPrompt({ user, scope: ownScope(user), route: "/teach/students", now: new Date("2026-09-22T10:00:00") });
  check("Prompt: rol, ruta y fecha", prompt.includes("maestro") && prompt.includes("/teach/students") && prompt.includes("22"));
  check("Prompt: lista lo que aún no puede", prompt.includes("Aún no puedes"));

  // buscar_alumno → ficha_alumno → texto
  const ai = scripted([
    [call("c1", "buscar_alumno", { texto: "ana" })],
    [call("c2", "ficha_alumno", { alumno_id: ids.s1 })],
    [say("Ana lleva un curso en progreso.")],
  ]);
  const turn = await runTurn({ user, scope: ownScope(user), route: "/teach/students", conversationId: null, text: `${P} ¿cómo va Ana?`, ai: { key: "k", model: "m", fetchImpl: ai.fetchImpl } });
  check("Crea la conversación y devuelve el mensaje", "conversationId" in turn && turn.message.role === "assistant");
  if (!("conversationId" in turn)) return;
  check("Tres vueltas a la IA", ai.calls() === 3);
  const blocks = turn.message.blocks;
  check("Mensaje: tiles de la ficha + texto final", blocks.some((b) => b.type === "tiles") && blocks.some((b) => b.type === "text" && b.text.includes("Ana lleva")));
  const second = ai.bodies[1] as { input: { type?: string; call_id?: string; output?: string }[] };
  check("La segunda llamada lleva la salida de la herramienta", second.input.some((i) => i.type === "function_call_output" && i.call_id === "c1" && (i.output ?? "").includes("Ana López")));
  const saved = getConversation(ids.teacher, turn.conversationId)!;
  check("Se guardan usuario y asistente", saved.messages.length === 2 && saved.messages[0].role === "user");
  check("Título automático", saved.title === `${P} ¿cómo va Ana?`);

  // Navegación
  const nav = scripted([[call("c1", "ir_a", { destino: "alumno", id: ids.s1 })], [say("Te llevo al perfil.")]]);
  const t2 = await runTurn({ user, scope: ownScope(user), route: "/teach/dashboard", conversationId: turn.conversationId, text: "llévame al perfil de Ana", ai: { key: "k", model: "m", fetchImpl: nav.fetchImpl } });
  check("Navegación: bloque navigate con la URL", "message" in t2 && t2.message.blocks.some((b) => b.type === "navigate" && b.href === `/teach/students/${ids.s1}`));
  const third = nav.bodies[0] as { input: { role?: string; content?: string }[] };
  check("El historial anterior viaja como texto", third.input.some((i) => i.role === "assistant" && (i.content ?? "").includes("Ana lleva")));

  // Herramienta desconocida y parámetros con __
  const unknown = scripted([[call("c1", "borrar_todo", {})], [call("c2", "buscar_curso", { texto: "extintores", __undo: true })], [say("No puedo hacer eso.")]]);
  const t3 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "borra todo", ai: { key: "k", model: "m", fetchImpl: unknown.fetchImpl } });
  const u = unknown.bodies[1] as { input: { type?: string; output?: string }[] };
  check("Herramienta desconocida: se le dice a la IA y sigue", "message" in t3 && u.input.some((i) => i.type === "function_call_output" && (i.output ?? "").includes("no existe")));
  check("Termina con el texto final", "message" in t3 && t3.message.blocks.some((b) => b.type === "text" && b.text.includes("No puedo")));

  // Propuesta (conversación nueva): la IA redacta una línea y el turno termina
  const prop = scripted([[call("c1", "matricular", { alumno_ids: [ids.s1, ids.s2], curso_id: ids.course })], [say("Revisa la tabla.")]]);
  const t4 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: null, text: `${P} matricula a Ana y Beto en extintores`, ai: { key: "k", model: "m", fetchImpl: prop.fetchImpl } });
  const proposalBlock = "message" in t4 ? t4.message.blocks.find((b) => b.type === "proposal") : undefined;
  check("Propuesta: bloque proposal pendiente + texto", "message" in t4 && proposalBlock?.type === "proposal" && proposalBlock.status === "pending" && t4.message.blocks.some((b) => b.type === "text"));
  const p = prop.bodies[1] as { tools?: unknown[]; tool_choice?: string };
  check("Tras la propuesta, la IA ya no puede llamar herramientas", p.tool_choice === "none");
  if ("message" in t4 && proposalBlock?.type === "proposal") {
    const convP = getConversation(ids.teacher, t4.conversationId)!;
    check("Turno con propuesta: exactamente usuario + asistente", convP.messages.length === 2 && convP.messages[1].id === t4.message.id && convP.messages[1].blocks.some((b) => b.type === "proposal"));
    check("La propuesta cuelga del mensaje del asistente", getProposal(proposalBlock.proposalId)?.messageId === t4.message.id);
    check("Columnas nombre y correo no editables", proposalBlock.columns.every((c) => c.editable === false));
    // Se aplica con celdas alteradas y una fila inventada: el bloque congelado conserva lo original
    const ctxP = { ...ctxFor(user, ownScope(user)), conversationId: t4.conversationId, messageId: t4.message.id };
    const tampered = [
      ...proposalBlock.rows.filter((r) => r.id === ids.s1).map((r) => ({ ...r, cells: { nombre: "Hackeado", correo: "x@x" }, blocked: false, warning: undefined })),
      { id: "fila-inventada", cells: { nombre: "Nadie", correo: "" } },
    ];
    const appliedP = await applyProposal(proposalBlock.proposalId, tampered, ctxP);
    const frozenP = getConversation(ids.teacher, t4.conversationId)!.messages[1].blocks.find((b) => b.type === "proposal");
    check("Aplicar con nombre alterado: 0 aplicadas (Ana sigue bloqueada)", "text" in appliedP && appliedP.text.startsWith("0 "));
    check("El bloque congelado conserva nombre y correo originales, sin la fila inventada", frozenP?.type === "proposal" && frozenP.rows.length === 1 && frozenP.rows[0].cells.nombre === `${P} Ana López` && frozenP.rows[0].cells.correo === `${P}-ana@test.local` && frozenP.rows[0].blocked === true, frozenP?.type === "proposal" ? frozenP.rows : frozenP);
  }

  // Propuesta y otra llamada en la misma vuelta: la segunda no se ejecuta pero se contesta
  const twoCalls = scripted([[call("c1", "matricular", { alumno_ids: [ids.s1, ids.s2], curso_id: ids.course }), call("c2", "buscar_curso", { texto: "x" })], [say("Revisa.")]]);
  const t4b = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula y busca", ai: { key: "k", model: "m", fetchImpl: twoCalls.fetchImpl } });
  const twoBody = twoCalls.bodies[1] as { input: { type?: string; call_id?: string; output?: string }[] };
  check("Tras la propuesta, la llamada siguiente se contesta como no ejecutada", "message" in t4b && twoBody.input.some((i) => i.type === "function_call_output" && i.call_id === "c2" && (i.output ?? "").includes("no ejecutada")) && !t4b.message.blocks.some((b) => b.type === "text" && b.text.includes("x")));

  // Matrícula instantánea: el mensaje guarda el undo
  const inst = scripted([[call("c1", "matricular", { alumno_ids: [ids.s2], curso_id: ids.course })], [say("Listo.")]]);
  const t5 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto", ai: { key: "k", model: "m", fetchImpl: inst.fetchImpl } });
  check("Instantánea: bloque result deshacible", "message" in t5 && t5.message.blocks.some((b) => b.type === "result" && b.undoable));
  check("…y el undo queda guardado en el mensaje", "message" in t5 && messageUndo(ids.teacher, turn.conversationId, t5.message.id)?.undo.tool === "matricular");

  const activeFor = (studentId: string) =>
    db.select().from(enrollments).where(and(eq(enrollments.courseId, ids.course), eq(enrollments.studentId, studentId))).all().filter((e) => e.status === "active").length;

  // Una sola acción instantánea por turno: tras matricular, la IA ya no recibe herramientas
  unenrollStudent(ids.course, ids.s2, ids.teacher);
  const twice = scripted([[call("c1", "matricular", { alumno_ids: [ids.s2], curso_id: ids.course })], [call("c2", "matricular", { alumno_ids: [ids.s4], curso_id: ids.course })], [say("Listo.")]]);
  const t5c = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto y luego a Dora", ai: { key: "k", model: "m", fetchImpl: twice.fetchImpl } });
  const twiceSecond = twice.bodies[1] as { tool_choice?: string; tools?: unknown };
  check("Tras la instantánea, la vuelta siguiente va sin herramientas", twiceSecond.tool_choice === "none" && twiceSecond.tools === undefined);
  check("Solo una matrícula nueva (Beto sí, Dora no)", activeFor(ids.s2) === 1 && activeFor(ids.s4) === 0);
  check("Un solo bloque deshacible y termina en 2 vueltas", "message" in t5c && t5c.message.blocks.filter((b) => b.type === "result" && b.undoable).length === 1 && twice.calls() === 2);
  check("…y el undo guardado es el de Beto", "message" in t5c && messageUndo(ids.teacher, turn.conversationId, t5c.message.id)?.undo.params.alumno_id === ids.s2);

  // Dos instantáneas en la misma vuelta: la segunda se contesta como no ejecutada
  unenrollStudent(ids.course, ids.s2, ids.teacher);
  const sameRound = scripted([[call("c1", "matricular", { alumno_ids: [ids.s2], curso_id: ids.course }), call("c2", "matricular", { alumno_ids: [ids.s4], curso_id: ids.course })], [say("Listo.")]]);
  const t5d = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto y a Dora", ai: { key: "k", model: "m", fetchImpl: sameRound.fetchImpl } });
  const sameBody = sameRound.bodies[1] as { input: { type?: string; call_id?: string; output?: string }[] };
  check("Misma vuelta: la segunda llamada se contesta «no ejecutada: ya se hizo una acción»", "message" in t5d && sameBody.input.some((i) => i.type === "function_call_output" && i.call_id === "c2" && (i.output ?? "").includes("ya se hizo una acción")));
  check("…y Dora sigue sin matrícula", activeFor(ids.s2) === 1 && activeFor(ids.s4) === 0);

  // Matrícula instantánea y luego la API falla: el deshacer sobrevive al error
  unenrollStudent(ids.course, ids.s2, ids.teacher);
  let n = 0;
  const thenFail = (async () => {
    n++;
    if (n === 1) return new Response(JSON.stringify({ output: [call("c1", "matricular", { alumno_ids: [ids.s2], curso_id: ids.course })] }), { status: 200 });
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  const t5b = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto otra vez", ai: { key: "k", model: "m", fetchImpl: thenFail } });
  check("Instantánea + fallo de API: result deshacible y error reintentable", "message" in t5b && t5b.message.blocks.some((b) => b.type === "result" && b.undoable) && t5b.message.blocks.some((b) => b.type === "error" && b.retryable));
  check("…y el undo se guarda aunque falle la API", "message" in t5b && messageUndo(ids.teacher, turn.conversationId, t5b.message.id)?.undo.tool === "matricular");
  check("…y el historial recuerda la herramienta usada", recentModelText(turn.conversationId, 1)[0]?.text.includes("[usó: matricular]"));

  // Tope de vueltas
  const loop = scripted([[call("c1", "buscar_curso", { texto: "x" })]]);
  const t6 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "bucle", ai: { key: "k", model: "m", fetchImpl: loop.fetchImpl } });
  const lastBody = loop.bodies[loop.bodies.length - 1] as { tool_choice?: string; input: { role?: string; content?: string }[] };
  check("Tope de 6 vueltas: 7 llamadas y termina", "message" in t6 && loop.calls() === 7 && t6.message.blocks.length > 0);
  check("Última vuelta: sin herramientas y aviso como system", lastBody.tool_choice === "none" && lastBody.input.some((i) => i.role === "system" && (i.content ?? "").includes("Ya no puedes")));

  // Argumentos que no son objeto: no revienta y responde a la IA
  const badArgs = scripted([[call("c1", "buscar_curso", "\"texto\"")], [say("Necesito el nombre del curso.")]]);
  const t6b = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "busca", ai: { key: "k", model: "m", fetchImpl: badArgs.fetchImpl } });
  const badBody = badArgs.bodies[1] as { input: { type?: string; call_id?: string }[] };
  check("Args no objeto: se contesta la llamada y termina con texto", "message" in t6b && badBody.input.some((i) => i.type === "function_call_output" && i.call_id === "c1") && t6b.message.blocks.some((b) => b.type === "text"));

  // Rol no admitido: ni toca la base
  const student: SessionUser = { id: ids.s1, email: "", fullName: "Ana", role: "student" };
  const denied = await runTurn({ user: student, scope: ownScope(student), route: "/", conversationId: null, text: `${P} hola`, ai: { key: "k", model: "m", fetchImpl: loop.fetchImpl } });
  check("Alumno: error sin crear conversación", "error" in denied && denied.error.includes("solo para maestros") && listConversations(ids.s1).length === 0 && loop.calls() === 7);

  // Error de la API
  const failing = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  const t7 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "hola", ai: { key: "k", model: "m", fetchImpl: failing } });
  check("Fallo de OpenAI: bloque de error reintentable", "message" in t7 && t7.message.blocks.some((b) => b.type === "error" && b.retryable));

  // Texto vacío
  check("Texto vacío: error", "error" in (await runTurn({ user, scope: ownScope(user), route: "/", conversationId: null, text: "  ", ai: { key: "k", model: "m", fetchImpl: failing } })));
}

function attachmentSummaryChecks() {
  console.log("\n— Resumen de adjunto");
  check("Color: rojo", colorFamily("#FF0000") === "rojo" && colorFamily("#C00000") === "rojo");
  check("Color: verde", colorFamily("#00B050") === "verde");
  check("Color: amarillo", colorFamily("#FFFF00") === "amarillo" && colorFamily("#FFC000") === "amarillo");
  check("Color: blanco o casi, sin color", colorFamily("#FFFFFF") === null && colorFamily("#FAFAFA") === null);
  check("Color: otro tono, sin familia", colorFamily("#7030A0") === "otro");
  check("Color: basura", colorFamily("no-es-color") === null);

  const summary: AttachmentSummary = {
    fileName: "alumnos.xlsx",
    kind: "sheet",
    sheets: [
      {
        name: "Matutino",
        rowCount: 84,
        headers: ["Nombre", "Correo", "Grupo"],
        sample: [["Ana López", "ana@x.com", "A"], ["Beto Ruiz", "beto@x.com", "B"]],
        colors: { rojo: 6, verde: 2 },
      },
      { name: "Vespertino", rowCount: 10, headers: ["Nombre", "Correo"], sample: [["Carla", "c@x.com"]], colors: {} },
    ],
    chars: 4200,
  };

  const text = summaryForModel(summary);
  check("Para la IA: nombre, hojas y filas", text.includes("alumnos.xlsx") && text.includes("Matutino") && text.includes("84"));
  check("Para la IA: encabezados y muestra", text.includes("Nombre") && text.includes("ana@x.com"));
  check("Para la IA: avisa de los colores", text.includes("rojo") && text.includes("6"));
  check("Para la IA: cabe en el tope", text.length <= MAX_SUMMARY_CHARS, text.length);

  const chips = suggestionsFor(summary);
  check("Sugerencias de lista de personas", chips.includes("Da de alta a estos alumnos") && chips.some((c) => c.includes("Matricúlalos")));
  check("Sugerencia de baja por color", chips.some((c) => c.includes("rojo")));
  check("Siempre ofrece solo revisar", chips.some((c) => c.toLowerCase().includes("qué contiene")));

  const cursos: AttachmentSummary = {
    fileName: "cursos.xlsx",
    kind: "sheet",
    sheets: [{ name: "Hoja1", rowCount: 4, headers: ["Título", "Descripción", "Vigencia"], sample: [["Extintores", "NOM-002", "12"]], colors: {} }],
    chars: 200,
  };
  check("Sugerencia de crear cursos", suggestionsFor(cursos).some((c) => c.includes("Crea estos cursos")));
  check("Sin encabezados conocidos: solo revisar", suggestionsFor({ fileName: "x.pdf", kind: "doc", sheets: [], chars: 100 }).length === 1);

  const largo: AttachmentSummary = {
    fileName: "grande.xlsx",
    kind: "sheet",
    sheets: Array.from({ length: 12 }, (_, i) => ({
      name: `Hoja ${i + 1}`,
      rowCount: 500,
      headers: ["Nombre muy largo ".repeat(6), "Correo"],
      sample: [["x".repeat(300), "y".repeat(300)]],
      colors: {},
    })),
    chars: 60_000,
  };
  check("Un archivo enorme no desborda el resumen", summaryForModel(largo).length <= MAX_SUMMARY_CHARS, summaryForModel(largo).length);
}

const FODS = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:automatic-styles>
<style:style style:name="rojo" style:family="table-cell"><style:table-cell-properties fo:background-color="#ff0000"/></style:style>
<style:style style:name="verde" style:family="table-cell"><style:table-cell-properties fo:background-color="#00b050"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet><table:table table:name="Turno A">
<table:table-row><table:table-cell office:value-type="string"><text:p>Nombre</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Correo</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Ana Lopez</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>ana@x.com</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell table:style-name="rojo" office:value-type="string"><text:p>Beto Ruiz</text:p></table:table-cell><table:table-cell table:style-name="rojo" office:value-type="string"><text:p>beto@x.com</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell table:style-name="verde" office:value-type="string"><text:p>Carla &amp; Diaz</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>carla@x.com</text:p></table:table-cell></table:table-row>
</table:table>
<table:table table:name="Turno B">
<table:table-row><table:table-cell office:value-type="string"><text:p>Nombre</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Correo</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Dani Mora</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>dani@x.com</text:p></table:table-cell></table:table-row>
</table:table></office:spreadsheet></office:body></office:document>`;

/** Hoja de prueba con filas pintadas: se arma con LibreOffice, sin binarios en el repo. */
async function makeColoredXlsx(): Promise<Buffer | null> {
  if (!HAS_SOFFICE) return null;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zasst-hoja-"));
  try {
    const fods = path.join(dir, "prueba.fods");
    await fsp.writeFile(fods, FODS, "utf8");
    await execFileAsync(process.env.SOFFICE_PATH!, ["--headless", "--convert-to", "xlsx", "--outdir", dir, fods], { timeout: 120_000 });
    return await fsp.readFile(path.join(dir, "prueba.xlsx"));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function sheetColorChecks() {
  console.log("\n— Filas y colores de la hoja");
  const bytes = await makeColoredXlsx();
  if (!bytes) {
    console.log("  (sin LibreOffice: se omite)");
    return;
  }
  const sheets = await readSheetRows(bytes, "prueba.xlsx");
  check("Dos hojas con sus nombres", sheets.length === 2 && sheets[0].name === "Turno A" && sheets[1].name === "Turno B", sheets.map((s) => s.name));
  const rows = sheets[0]?.rows ?? [];
  check("Cuatro filas (con encabezado)", rows.length === 4, rows.length);
  check("Texto de las celdas", rows[1]?.cells.join("|") === "Ana Lopez|ana@x.com", rows[1]?.cells);
  check("Entidades HTML decodificadas", rows[3]?.cells[0] === "Carla & Diaz", rows[3]?.cells[0]);
  check("Fila sin pintar: sin color", rows[1]?.color === null);
  check("Fila roja", rows[2]?.color === "rojo");
  check("Fila verde (basta una celda pintada)", rows[3]?.color === "verde");
  check("El encabezado no se pinta", rows[0]?.color === null);
  const otra = sheets[1]?.rows ?? [];
  check("La segunda hoja trae sus propias filas", otra.length === 2 && otra[1]?.cells.join("|") === "Dani Mora|dani@x.com", otra.map((r) => r.cells));
}

async function intakeChecks() {
  console.log("\n— Recepción del adjunto");
  check("Subida: xlsx permitido", resolveUploadMime("assistant_attachment", "lista.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").ok);
  check("Subida: xlsx sin tipo declarado, por extensión", resolveUploadMime("assistant_attachment", "lista.xlsx", "application/octet-stream").ok);
  check("Subida: PDF permitido", resolveUploadMime("assistant_attachment", "lista.pdf", "application/pdf").ok);
  check("Subida: foto permitida", resolveUploadMime("assistant_attachment", "foto.jpg", "image/jpeg").ok);
  check("Subida: CSV permitido", resolveUploadMime("assistant_attachment", "lista.csv", "text/csv").ok);
  check("Subida: ejecutable rechazado", !resolveUploadMime("assistant_attachment", "virus.exe", "application/octet-stream").ok);
  check("Subida: vídeo rechazado", !resolveUploadMime("assistant_attachment", "clip.mp4", "video/mp4").ok);

  const bytes = await makeColoredXlsx();
  if (!bytes) {
    console.log("  (sin LibreOffice: se omite el resumen real)");
    return;
  }
  const summary = await summarizeAttachment(bytes, "prueba.xlsx");
  check("Resumen: dos hojas", summary.sheets.length === 2, summary.sheets.map((s) => s.name));
  check("Resumen: encabezados", summary.sheets[0].headers.join("|") === "Nombre|Correo", summary.sheets[0].headers);
  check("Resumen: no cuenta el encabezado como fila", summary.sheets[0].rowCount === 3, summary.sheets[0].rowCount);
  check("Resumen: muestra sin encabezado", summary.sheets[0].sample[0][0] === "Ana Lopez", summary.sheets[0].sample[0]);
  check("Resumen: colores contados", summary.sheets[0].colors.rojo === 1 && summary.sheets[0].colors.verde === 1, summary.sheets[0].colors);
  check("Resumen: tipo hoja", summary.kind === "sheet" && summary.fileName === "prueba.xlsx");

  const doc = await summarizeAttachment(Buffer.from("Lista de asistentes\nAna Lopez ana@x.com\nBeto Ruiz beto@x.com\n", "utf8"), "lista.txt");
  check("Documento de texto: sin hojas y con caracteres", doc.sheets.length === 0 && doc.chars > 20 && doc.kind === "doc");
  const img = await summarizeAttachment(Buffer.from("no importa"), "foto.jpg");
  check("Imagen: se admite sin leer texto", img.kind === "image" && img.sheets.length === 0);

  const csv = await summarizeAttachment(Buffer.from("Nombre,Correo\nAna Lopez,ana@x.com\nBeto Ruiz,beto@x.com\n", "utf8"), "lista.csv");
  check("CSV: se resume como hoja", csv.kind === "sheet" && csv.sheets.length === 1, csv.kind);
  check("CSV: encabezados", csv.sheets[0]?.headers.join("|") === "Nombre|Correo", csv.sheets[0]?.headers);
  check("CSV: no cuenta el encabezado como fila", csv.sheets[0]?.rowCount === 2, csv.sheets[0]?.rowCount);
  check("CSV: sugiere dar de alta", suggestionsFor(csv).includes("Da de alta a estos alumnos"), suggestionsFor(csv));
}

async function rowsFromAttachmentChecks() {
  console.log("\n— Filas del adjunto");
  check("Encabezados: nombre y correo", JSON.stringify(headerIndex(["Nombre completo", "Correo electrónico", "Grupo"])) === JSON.stringify({ name: 0, email: 1, group: 2 }));
  check("Encabezados: en otro orden y sin acentos", JSON.stringify(headerIndex(["e-mail", "alumno"])) === JSON.stringify({ name: 1, email: 0, group: -1 }));
  check("Encabezados: sin columnas útiles", headerIndex(["a", "b"]) === null);

  const sinIa = await peopleRows({ text: "Gina Soto gina@x.com" }, {}).catch((e: Error) => e.message);
  check("Texto sin clave de IA: lo dice", typeof sinIa === "string" && sinIa.includes("necesita la IA"), sinIa);

  // La IA no se llama de verdad: se le responde con el JSON que espera «Importar con IA»
  const respuesta = fakeOutput([
    say(
      JSON.stringify({
        students: [
          { fullName: "Gina   Soto", email: " GINA@X.COM ", group: "Matutino", issues: [] },
          { fullName: "Hugo Vela", email: "hugo@x.com", group: "", issues: [] },
        ],
      })
    ),
  ]);
  const deTexto = await peopleRows(
    { text: "Gina Soto gina@x.com\nHugo Vela hugo@x.com" },
    { ai: { key: "k", model: "m", fetchImpl: respuesta }, color: "rojo" }
  );
  check("Texto pegado: lo lee la IA", deTexto.rows.length === 2 && deTexto.rows[0].fullName === "Gina Soto", deTexto.rows);
  check("Texto pegado: correo y grupo normalizados", deTexto.rows[0].email === "gina@x.com" && deTexto.rows[0].group === "Matutino", deTexto.rows[0]);
  check("Texto pegado: el color no aplica y lo avisa", deTexto.note.includes("hojas de cálculo"), deTexto.note);

  const bytes = await makeColoredXlsx();
  if (!bytes) {
    console.log("  (sin LibreOffice: se omite)");
    return;
  }
  const all = await peopleRows({ bytes, fileName: "prueba.xlsx" }, {});
  check("Todas las personas de la hoja", all.rows.length === 3 && all.rows[0].fullName === "Ana Lopez", all.rows);
  check("Correo normalizado", all.rows[1].email === "beto@x.com");
  check("Varias hojas: avisa de cuál usó", all.note.includes("Turno A"), all.note);
  const rojas = await peopleRows({ bytes, fileName: "prueba.xlsx" }, { color: "rojo" });
  check("Filtro por color: solo las rojas", rojas.rows.length === 1 && rojas.rows[0].fullName === "Beto Ruiz", rojas.rows);
  const sinColor = await peopleRows({ bytes, fileName: "prueba.xlsx" }, { color: "azul" });
  check("Color sin filas: lo dice", sinColor.rows.length === 0 && sinColor.note.includes("azul"), sinColor.note);
  const hoja = await peopleRows({ bytes, fileName: "prueba.xlsx" }, { sheet: "Turno B" });
  check("Hoja por nombre", hoja.rows.length === 1 && hoja.rows[0].fullName === "Dani Mora", hoja.rows);
  const hojaMala = await peopleRows({ bytes, fileName: "prueba.xlsx" }, { sheet: "No existe" });
  check("Hoja inexistente: lo dice y usa la primera", hojaMala.note.includes("No existe") && hojaMala.rows.length === 3);

  const csv = Buffer.from("Nombre,Correo,Grupo\nEva Ruiz,eva@x.com,Matutino\nFabian Paz,FABIAN@X.COM,Vespertino\n", "utf8");
  const deCsv = await peopleRows({ bytes: csv, fileName: "lista.csv" }, {});
  check("CSV: dos personas con su grupo", deCsv.rows.length === 2 && deCsv.rows[0].group === "Matutino", deCsv.rows);
  check("CSV: correo en minúsculas", deCsv.rows[1].email === "fabian@x.com");
}

async function main() {
  placeholderChecks();
  await clientChecks();
  attachmentSummaryChecks();
  await sheetColorChecks();
  await intakeChecks();
  await rowsFromAttachmentChecks();
  setup();
  try {
    await catalogChecks();
    await readToolChecks();
    await conversationChecks();
    await proposalChecks();
    await agentChecks();
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
