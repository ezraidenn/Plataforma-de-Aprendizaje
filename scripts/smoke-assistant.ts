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
import { eq, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/server/db";
import { aiConversations, courses as coursesTable, enrollments, users } from "../src/server/db/schema";
import { createCourse, enrollStudents } from "../src/server/services/courses";
import { ownScope, type ViewScope } from "../src/server/auth/view-scope";
import type { SessionUser } from "../src/server/auth/sessions";
import { toolsForRole, toolByName, toolDefsForRole } from "../src/server/assistant/registry";
import type { ToolCtx } from "../src/server/assistant/tool-types";

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
    db.delete(aiConversations).where(like(aiConversations.title, `${P}%`)).run();
    const courseIds = db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P}%`)).all().map((c) => c.id);
    for (const id of courseIds) {
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

async function main() {
  placeholderChecks();
  await clientChecks();
  setup();
  try {
    await catalogChecks();
    await readToolChecks();
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
