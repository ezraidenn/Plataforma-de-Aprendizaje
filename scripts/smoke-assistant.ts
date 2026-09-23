/**
 * Asistente de IA, sin gastar en la API: placeholder por ruta, cliente con
 * herramientas (OpenAI simulada), catálogo por rol, bucle del agente,
 * matrícula instantánea con deshacer, propuesta → editar → aplicar,
 * conversaciones e historial. Datos con prefijo «zasst», borrados al final.
 *
 * Uso: pnpm smoke:assistant
 */
import { placeholderFor } from "../src/lib/assistant-placeholder";
import { dateRange } from "../src/lib/assistant-dates";
import type { AssistantBlock } from "../src/lib/assistant-blocks";
import { requestWithTools, type ChatItem, type ToolDef } from "../src/server/services/ai-client";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/server/db";
import {
  aiConversations,
  aiExports,
  aiProposals,
  assignmentSubmissions,
  auditLog,
  certificates,
  courseItems,
  courses as coursesTable,
  enrollments,
  examAttempts,
  exams,
  files,
  itemAssignments,
  itemProgress,
  notifications,
  users,
} from "../src/server/db/schema";
import { createCourse, enrollStudents, setStudentActive, unenrollStudent } from "../src/server/services/courses";
import { createItem, getItem } from "../src/server/services/tree";
import { listQuestions } from "../src/server/services/exams";
import { detectFormat } from "../src/lib/excel-formats";
import { assignEnrollmentsToCohort, cohortOptions, createCohort, findCohortByName, getCohort } from "../src/server/services/cohorts";
import { unreadCount } from "../src/server/services/notifications";
import { MAX_DESTINATARIOS, MAX_MENSAJE, MAX_TITULO } from "../src/server/assistant/tools/avisar";
import { ownScope, type ViewScope } from "../src/server/auth/view-scope";
import type { SessionUser } from "../src/server/auth/sessions";
import { NOT_YET, toolsForRole, toolByName, toolDefsForRole } from "../src/server/assistant/registry";
import { courseMatrix } from "../src/server/services/reports";
import { hojaAvance, hojaResumen } from "../src/server/assistant/tools/reporte-avance";
import { certificadosQuery, movimientosQuery, panoramaQuery, pendientesQuery, sinEntrarCount } from "../src/server/assistant/queries";
import { listadoQuery, type ListadoFiltros, type ListadoResult } from "../src/server/assistant/listado";
import { runTurn } from "../src/server/assistant/agent";
import { maybeSummarize } from "../src/server/assistant/summarize";
import { chatModelOf, getAiSettings, saveAiSettings } from "../src/server/services/ai-settings";
import { platformSuggestions } from "../src/server/assistant/suggestions";
import { rateLimitHit } from "../src/server/assistant/rate-limit";
import { systemPrompt } from "../src/server/assistant/prompt";
import type { ToolCtx } from "../src/server/assistant/tool-types";
import {
  ATTACHMENT_TITLE,
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getSummary,
  listConversations,
  messageUndo,
  patchProposalBlock,
  recentModelText,
} from "../src/server/services/ai-conversations";
import { applyProposal, cancelProposal, createProposal, expireProposals, getProposal } from "../src/server/assistant/proposals";
import {
  XLSX_MIME,
  createExport,
  createFileExport,
  purgeExports,
  readExport,
  readExportBytes,
} from "../src/server/assistant/exports";
import { buildXlsx, type SheetSpec } from "../src/server/services/xlsx";
import {
  MAX_SUMMARY_CHARS,
  attachmentDetail,
  colorFamily,
  suggestionsFor,
  summaryForModel,
  type AttachmentSummary,
} from "../src/lib/attachment-summary";
import { readSheetRows, type SheetData } from "../src/server/services/sheet-colors";
import { attachToConversation, summarizeAttachment, type StoredAttachment } from "../src/server/services/attachment-intake";
import { absolutePathFor, deleteFile, getFileRecord, saveStream } from "../src/server/services/storage";
import { peopleRows, headerIndex } from "../src/server/assistant/rows-from-attachment";
import { toCourseDrafts } from "../src/server/services/ai-course-import";
import { resolveUploadMime } from "../src/lib/upload-types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";

// Ninguna prueba debe llamar a OpenAI de verdad: las que usan IA la simulan con
// `fetchImpl`. Si alguna se escapara, apunta a un puerto muerto y falla rápido
// en vez de gastar la clave real. `openaiBase()` lee esta variable en cada
// llamada, así que basta con fijarla antes de la primera.
process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";

// Red de verdad hacia OpenAI: se cuenta para comprobarlo al final
let openaiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("api.openai.com")) openaiCalls++;
  return realFetch(input, init);
}) as typeof fetch;

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

/** Mensaje del error que lanza `fn`, o «» si no lanzó. */
async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
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

function dateRangeChecks() {
  console.log("\n— Rangos de fecha");
  const now = new Date("2026-09-23T15:30:00");
  const hoy = dateRange("hoy", "", now);
  check("Hoy: de 00:00 a 23:59", hoy.from.getDate() === 23 && hoy.from.getHours() === 0 && hoy.to.getHours() === 23, [hoy.from.toISOString(), hoy.to.toISOString()]);
  check("Hoy: etiqueta", hoy.label === "hoy");
  check("Ayer", dateRange("ayer", "", now).from.getDate() === 22);
  const semana = dateRange("esta semana", "", now);
  check("Esta semana: empieza el lunes", semana.from.getDay() === 1 && semana.from.getDate() === 21, semana.from.toISOString());
  check("Últimos 7 días", dateRange("últimos 7 días", "", now).from.getDate() === 17, dateRange("últimos 7 días", "", now).from.toISOString());
  const mes = dateRange("este mes", "", now);
  check("Este mes: del 1 al 30", mes.from.getDate() === 1 && mes.to.getDate() === 30, [mes.from.toISOString(), mes.to.toISOString()]);
  const iso = dateRange("2026-09-01", "2026-09-15", now);
  check("Fechas exactas", iso.from.getDate() === 1 && iso.to.getDate() === 15 && iso.label.includes("1"), iso.label);
  check("Vacío: hoy", dateRange("", "", now).label === "hoy");
  check("Texto raro: hoy", dateRange("cuando sea", "", now).label === "hoy");
  check("Al revés se ordena", dateRange("2026-09-15", "2026-09-01", now).from.getDate() === 1);
  check("Sin acentos ni mayúsculas", dateRange("ULTIMOS 3 DIAS", "", now).from.getDate() === 21);
  check("Siempre: desde muy atrás", dateRange("siempre", "", now).from.getFullYear() <= 2020);
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
const ids = {
  teacher: nanoid(),
  admin: nanoid(),
  // Dos administradores más, solo para el panorama: uno con curso propio y otro sin nada
  adminConCurso: nanoid(),
  adminSinCursos: nanoid(),
  s1: nanoid(),
  s2: nanoid(),
  s3: nanoid(),
  s4: nanoid(),
  // Alumnos y curso de la sección de grupos: se crean ahí para no mover las demás
  g1: nanoid(),
  g2: nanoid(),
  g3: nanoid(),
  // Lo mismo para los avisos: tres matriculados solo para esa sección
  a1: nanoid(),
  a2: nanoid(),
  a3: nanoid(),
  course: "",
  grupoCourse: "",
  avisoCourse: "",
};

function makeUser(id: string, key: string, name: string, role: "teacher" | "admin" | "student", createdBy: string | null) {
  db.insert(users).values({ id, email: `${P}-${key}@test.local`, passwordHash: "x", fullName: `${P} ${name}`, role, createdBy }).run();
}

/** Archivos que guardaron las pruebas: `cleanup()` los borra (disco y fila). */
const testFileIds: string[] = [];

/** Guarda una hoja de prueba en el almacenamiento real y devuelve su id. */
async function saveTestFile(bytes: Buffer, name: string, userId: string): Promise<string> {
  const { id } = await saveStream({
    stream: Readable.from(bytes),
    originalName: name,
    mimeType: XLSX_MIME,
    kind: "assistant_attachment",
    uploadedBy: userId,
  });
  testFileIds.push(id);
  return id;
}

async function setup() {
  await cleanup();
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

async function cleanup() {
  // Archivos de prueba: los de esta corrida y los que dejara una que se cortó.
  // Van antes que los usuarios: la fila de `files` apunta a quien la subió (y
  // esa FK no borra en cascada). Por nombre no basta: el Excel de un listado se
  // llama «listado-2026-09-23.xlsx», así que también van los que subió una
  // cuenta zasst.
  const userIds = db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%`)).all().map((u) => u.id);
  const leftovers = db
    .select({ id: files.id })
    .from(files)
    .where(or(like(files.originalName, `${P}%`), userIds.length ? inArray(files.uploadedBy, userIds) : undefined))
    .all()
    .map((f) => f.id);
  for (const id of new Set([...testFileIds, ...leftovers])) await deleteFile(id);
  testFileIds.length = 0;

  if (userIds.length === 0) return;
  db.transaction(() => {
    // Auditoría que dejó el asistente: propuestas de las conversaciones zasst y matrículas de los cursos zasst
    const convIds = db.select({ id: aiConversations.id }).from(aiConversations).where(like(aiConversations.title, `${P}%`)).all().map((c) => c.id);
    const proposalIds = convIds.length
      ? db.select({ id: aiProposals.id }).from(aiProposals).where(inArray(aiProposals.conversationId, convIds)).all().map((p) => p.id)
      : [];
    if (proposalIds.length) db.delete(auditLog).where(and(eq(auditLog.entity, "ai_proposal"), inArray(auditLog.entityId, proposalIds))).run();
    // Todo lo que registraron las cuentas zasst (altas en lote, propuestas, matrículas…)
    db.delete(auditLog).where(inArray(auditLog.userId, userIds)).run();
    db.delete(aiConversations).where(like(aiConversations.title, `${P}%`)).run();
    const courseIds = db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P}%`)).all().map((c) => c.id);
    for (const id of courseIds) {
      // Cubre assistant_matricular y assistant_matricular_undo
      db.delete(auditLog).where(and(eq(auditLog.entity, "enrollment"), like(auditLog.entityId, `${id}:%`))).run();
      // Lo que dejó queryChecks. Los certificados NO cuelgan del curso (su FK
      // no borra en cascada, ni la de la matrícula ni la del alumno): van
      // primero o el borrado del curso falla. Lo de abajo sí caería en cascada
      // con el curso, pero se borra a mano para no depender de ella.
      db.delete(certificates).where(eq(certificates.courseId, id)).run();
      const itemIds = db.select({ id: courseItems.id }).from(courseItems).where(eq(courseItems.courseId, id)).all().map((i) => i.id);
      if (itemIds.length) {
        db.delete(examAttempts).where(inArray(examAttempts.examItemId, itemIds)).run();
        db.delete(assignmentSubmissions).where(inArray(assignmentSubmissions.itemId, itemIds)).run();
        db.delete(exams).where(inArray(exams.itemId, itemIds)).run();
        db.delete(itemAssignments).where(inArray(itemAssignments.itemId, itemIds)).run();
        db.delete(courseItems).where(inArray(courseItems.id, itemIds)).run();
      }
      db.delete(enrollments).where(eq(enrollments.courseId, id)).run();
      db.delete(coursesTable).where(eq(coursesTable.id, id)).run();
    }
    // Por si alguna prueba dejó un certificado de una cuenta zasst en otro curso
    db.delete(certificates).where(inArray(certificates.studentId, userIds)).run();
    // Los avisos que mandaron las pruebas (la campana de los alumnos zasst)
    db.delete(notifications).where(inArray(notifications.userId, userIds)).run();
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

async function exportChecks() {
  console.log("\n— Descargas guardadas");
  const conv = createConversation(ids.teacher, `${P} descargas`);
  const id = createExport(conv.id, "movimientos.csv", "nombre,correo\nAna,ana@x.com\n");
  const mine = readExport(ids.teacher, id);
  check("El dueño la lee", mine?.fileName === "movimientos.csv" && (mine.content ?? "").includes("Ana"));
  check("El texto se sirve como CSV", mine?.mime === "text/csv" && mine.fileId === undefined, mine);
  const csvBytes = await readExportBytes(ids.teacher, id);
  check("Los bytes del texto son el propio CSV", csvBytes?.bytes.toString("utf8") === "nombre,correo\nAna,ana@x.com\n", csvBytes?.bytes.length);
  check("Otro usuario no", readExport(ids.admin, id) === null);
  check("Id inventado: null", readExport(ids.teacher, "no-existe") === null);
  db.update(aiExports).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiExports.id, id)).run();
  check("Caducada: no se lee", readExport(ids.teacher, id) === null);
  check("Purga: se borra", (await purgeExports()) >= 1 && db.select().from(aiExports).where(eq(aiExports.id, id)).get() === undefined);
  check("Al borrar la conversación se va la descarga", (() => {
    const c2 = createConversation(ids.teacher, `${P} descargas 2`);
    const e2 = createExport(c2.id, "x.csv", "a,b\n");
    deleteConversation(ids.teacher, c2.id);
    return db.select().from(aiExports).where(eq(aiExports.id, e2)).get() === undefined;
  })());

  // ── Descargas que son un archivo (Excel) ────────────────────────────────
  // Sin LibreOffice no hay Excel de verdad, pero la fila, el almacenamiento y
  // la caducidad se prueban igual con unos bytes cualquiera
  const excel = HAS_SOFFICE
    ? await buildXlsx([{ name: "Avance", columns: [{ title: "Alumno" }], rows: [[{ text: "Ana" }]] }])
    : Buffer.from("PK\u0003\u0004 no es un xlsx", "utf8");
  const fileId = await createFileExport(conv.id, `${P}-avance.xlsx`, excel, XLSX_MIME, ids.teacher);
  const info = readExport(ids.teacher, fileId);
  check("La descarga de archivo guarda su tipo y apunta al archivo", info?.mime === XLSX_MIME && !!info.fileId && info.content === undefined, info);
  if (info?.fileId) testFileIds.push(info.fileId);
  const rec = info?.fileId ? getFileRecord(info.fileId) : null;
  const abs = rec ? absolutePathFor(rec.storedPath) : "";
  check("El archivo quedó en el almacenamiento", rec?.kind === "assistant_export" && rec.uploadedBy === ids.teacher && existsSync(abs), rec?.storedPath);
  const bajada = await readExportBytes(ids.teacher, fileId);
  check("El dueño se baja los mismos bytes", bajada?.fileName === `${P}-avance.xlsx` && bajada.mime === XLSX_MIME && bajada.bytes.equals(excel), bajada?.bytes.length);
  check("Otro usuario no se la baja", (await readExportBytes(ids.admin, fileId)) === null);
  db.update(aiExports).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiExports.id, fileId)).run();
  check("Caducada: tampoco se bajan los bytes", (await readExportBytes(ids.teacher, fileId)) === null);
  await purgeExports();
  check(
    "Purga: se van la fila, la fila del archivo y el archivo del disco",
    db.select().from(aiExports).where(eq(aiExports.id, fileId)).get() === undefined &&
      getFileRecord(info!.fileId!) === null &&
      !existsSync(abs),
    { fila: db.select().from(aiExports).where(eq(aiExports.id, fileId)).get(), abs }
  );
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

async function confirmWordChecks() {
  console.log("\n— Confirmación por palabra");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} confirmar`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };
  const proposalId = createProposal("matricular", ctx, anchor.id, {
    title: "Prueba",
    applyLabel: "Aplicar",
    columns: [{ key: "nombre", label: "Nombre", editable: false }],
    rows: [{ id: ids.s1, cells: { nombre: `${P} Ana López` } }],
    payload: { courseId: ids.course, courseTitle: `${P} Extintores` },
    confirmWord: "BORRAR",
  });
  check("La propuesta guarda la palabra", getProposal(proposalId)?.draft.confirmWord === "BORRAR");
  const sin = await applyProposal(proposalId, getProposal(proposalId)!.rows, ctx, "");
  check("Sin la palabra no se aplica", "error" in sin && sin.error.includes("BORRAR"), sin);
  const mal = await applyProposal(proposalId, getProposal(proposalId)!.rows, ctx, "borra");
  check("Palabra distinta no se aplica", "error" in mal);
  check("Sigue pendiente tras los intentos fallidos", getProposal(proposalId)?.status === "pending");
  const bien = await applyProposal(proposalId, getProposal(proposalId)!.rows, ctx, " borrar ");
  check("Con la palabra (sin importar espacios ni mayúsculas) sí se aplica", "text" in bien, bien);
  check("Queda aplicada", getProposal(proposalId)?.status === "applied");

  // Una propuesta normal no pide nada
  const normal = createProposal("matricular", ctx, anchor.id, {
    title: "Prueba 2",
    applyLabel: "Aplicar",
    columns: [{ key: "nombre", label: "Nombre", editable: false }],
    rows: [{ id: ids.s2, cells: { nombre: `${P} Beto Ruiz` } }],
    payload: { courseId: ids.course, courseTitle: `${P} Extintores` },
  });
  check("Sin palabra configurada: se aplica sin confirmar", "text" in (await applyProposal(normal, getProposal(normal)!.rows, ctx, "")));
}

async function altaAlumnosChecks() {
  console.log("\n— Alta de alumnos en lote");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} altas`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };

  const texto = [
    "Nombre,Correo,Grupo",
    `${P} Nueva Uno,${P}-nueva1@test.local,Matutino`,
    `${P} Nueva Dos,${P}-nueva2@test.local,Matutino`,
    `${P} Repetida,${P}-nueva1@test.local,Matutino`,
    "Sin Correo,,",
    `${P} Maestro,${P}-maestro@test.local,`,
  ].join("\n");

  const result = await toolByName("alta_alumnos")!.run(
    { origen: "texto", texto, hoja: "", filtro_color: "", curso_id: "", grupo: "" },
    ctx
  );
  check("Crea la propuesta", typeof result.proposalId === "string", result.forModel);
  const proposal = getProposal(result.proposalId!)!;
  check("Cinco filas", proposal.rows.length === 5, proposal.rows.length);
  check("Columnas editables (nombre, correo y grupo)", proposal.draft.columns.length === 3 && proposal.draft.columns.every((c) => c.editable !== false));
  check("Repetida en el archivo: bloqueada", proposal.rows[2].blocked === true && (proposal.rows[2].warning ?? "").toLowerCase().includes("repetid"), proposal.rows[2]);
  check("Sin correo: bloqueada", proposal.rows[3].blocked === true && (proposal.rows[3].warning ?? "").toLowerCase().includes("correo"), proposal.rows[3]);
  check("Correo que ya tiene cuenta: bloqueada", proposal.rows[4].blocked === true, proposal.rows[4]);
  check("Las buenas no llevan aviso", !proposal.rows[0].blocked && !proposal.rows[1].blocked);
  check("La IA solo recibe el conteo, no los correos", result.forModel.includes("2") && !result.forModel.includes("@test.local"), result.forModel);

  const applied = await applyProposal(result.proposalId!, proposal.rows, ctx, "");
  check("Crea las dos cuentas", "text" in applied && applied.text.includes("2"), applied);
  const creados = db.select({ id: users.id, createdBy: users.createdBy }).from(users).where(like(users.email, `${P}-nueva%`)).all();
  check("Quedan a nombre del maestro", creados.length === 2 && creados.every((u) => u.createdBy === ids.teacher), creados);
  check("Auditoría del alta", db.select().from(auditLog).where(eq(auditLog.action, "assistant_alta_alumnos")).get() !== undefined);
  check("Dice que las contraseñas están en la descarga", "text" in applied && applied.text.toLowerCase().includes("contraseñ") && applied.text.toLowerCase().includes("descarga"), applied);
  const altaDl = "blocks" in applied ? downloadOf(applied.blocks) : undefined;
  check("Las contraseñas salen en un bloque de descarga", altaDl?.label === "Descargar las contraseñas" && (altaDl.detail ?? "").includes("24 horas"), altaDl);
  const altaCsv = readExport(ids.teacher, altaDl ? (altaDl.href.split("/").pop() ?? "") : "");
  check("La descarga trae la columna de contraseña", (altaCsv?.content ?? "").includes("contrasena"), altaCsv?.content?.split("\r\n")[0]);
  check("…y una línea por cada cuenta creada", (altaCsv?.content ?? "").split("\r\n").length >= 3, altaCsv?.content?.split("\r\n").length);

  // Con curso: alta + matrícula en el mismo paso
  const conv2 = createConversation(ids.teacher, `${P} altas2`);
  const anchor2 = appendMessage(conv2.id, "assistant", [], "");
  const ctx2 = { ...ctxFor(user, ownScope(user)), conversationId: conv2.id, messageId: anchor2.id };
  const conCurso = await toolByName("alta_alumnos")!.run(
    { origen: "texto", texto: `Nombre,Correo\n${P} Nueva Tres,${P}-nueva3@test.local`, hoja: "", filtro_color: "", curso_id: ids.course, grupo: "" },
    ctx2
  );
  const p2 = getProposal(conCurso.proposalId!)!;
  check("Dice en qué curso quedarán", p2.draft.title.includes("Extintores"), p2.draft.title);
  await applyProposal(conCurso.proposalId!, p2.rows, ctx2, "");
  const nueva3 = db.select({ id: users.id }).from(users).where(eq(users.email, `${P}-nueva3@test.local`)).get();
  check("Se matricula al crearla", !!nueva3 && db.select().from(enrollments).where(and(eq(enrollments.courseId, ids.course), eq(enrollments.studentId, nueva3!.id))).get() !== undefined);

  // Lista mixta con curso: quien ya tiene cuenta no se bloquea, solo se matricula
  const cursoMixto = createCourse({ ownerId: ids.teacher, title: `${P} Mixto` }).id;
  const conv4 = createConversation(ids.teacher, `${P} altas4`);
  const anchor4 = appendMessage(conv4.id, "assistant", [], "");
  const ctx4 = { ...ctxFor(user, ownScope(user)), conversationId: conv4.id, messageId: anchor4.id };
  const mixta = await toolByName("alta_alumnos")!.run(
    {
      origen: "texto",
      texto: `Nombre,Correo\n${P} Ana López,${P}-ana@test.local\n${P} Nueva Cuatro,${P}-nueva4@test.local`,
      hoja: "",
      filtro_color: "",
      curso_id: cursoMixto,
      grupo: "",
    },
    ctx4
  );
  const pMixta = getProposal(mixta.proposalId!)!;
  check("Con curso, quien ya tiene cuenta no se bloquea", !pMixta.rows[0].blocked && (pMixta.rows[0].warning ?? "").toLowerCase().includes("solo se matricul"), pMixta.rows[0]);
  check("La IA distingue nuevas de las que ya existen", mixta.forModel.includes("1 nueva") && mixta.forModel.includes("1 que ya"), mixta.forModel);
  await applyProposal(mixta.proposalId!, pMixta.rows, ctx4, "");
  check(
    "Ana queda matriculada y no se creó otra cuenta con su correo",
    db.select().from(enrollments).where(and(eq(enrollments.courseId, cursoMixto), eq(enrollments.studentId, ids.s1))).get()?.status === "active" &&
      db.select().from(users).where(eq(users.email, `${P}-ana@test.local`)).all().length === 1
  );

  // Fila con problema de datos: el usuario la corrige en la tabla y sí se aplica
  const conv5 = createConversation(ids.teacher, `${P} altas5`);
  const anchor5 = appendMessage(conv5.id, "assistant", [], "");
  const ctx5 = { ...ctxFor(user, ownScope(user)), conversationId: conv5.id, messageId: anchor5.id };
  const corregible = await toolByName("alta_alumnos")!.run(
    { origen: "texto", texto: `Nombre,Correo\n${P} Nueva Cinco,`, hoja: "", filtro_color: "", curso_id: "", grupo: "" },
    ctx5
  );
  const pCorregible = getProposal(corregible.proposalId!)!;
  check("El alta se vuelve a revisar al aplicar", pCorregible.draft.recheckOnApply === true, pCorregible.draft);
  check("Falta el correo: bloqueada con su aviso", pCorregible.rows[0].blocked === true && (pCorregible.rows[0].warning ?? "").toLowerCase().includes("correo"), pCorregible.rows[0]);
  const corregida = await applyProposal(
    corregible.proposalId!,
    pCorregible.rows.map((r) => ({ ...r, cells: { ...r.cells, correo: `${P}-nueva5@test.local` } })),
    ctx5,
    ""
  );
  check(
    "Corregir el correo en la tabla sí crea la cuenta",
    "text" in corregida &&
      corregida.text.includes("1 alumno") &&
      db.select({ id: users.id }).from(users).where(eq(users.email, `${P}-nueva5@test.local`)).get() !== undefined,
    corregida
  );

  // Curso ajeno
  const ajeno = await toolByName("alta_alumnos")!.run(
    { origen: "texto", texto: `Nombre,Correo\nX,x@test.local`, hoja: "", filtro_color: "", curso_id: "no-existe", grupo: "" },
    ctx
  );
  check("Curso que no es tuyo: no crea propuesta", !ajeno.proposalId && ajeno.forModel.toLowerCase().includes("curso"), ajeno.forModel);

  // Sin adjunto
  const sinAdjunto = await toolByName("alta_alumnos")!.run({ origen: "adjunto", texto: "", hoja: "", filtro_color: "", curso_id: "", grupo: "" }, ctx);
  check("Origen adjunto sin archivo: lo dice", !sinAdjunto.proposalId && sinAdjunto.forModel.toLowerCase().includes("adjunto"));

  // Desde una hoja de cálculo real, con color
  const bytes = await makeColoredXlsx();
  if (bytes) {
    const conv3 = createConversation(ids.teacher, `${P} altas3`);
    const anchor3 = appendMessage(conv3.id, "assistant", [], "");
    const attachment = { id: "adj-test", fileId: null, summary: { fileName: "prueba.xlsx", kind: "sheet" as const, sheets: [], chars: 0 } };
    const ctx3 = { ...ctxFor(user, ownScope(user)), conversationId: conv3.id, messageId: anchor3.id, attachments: [attachment] };
    const fallo = await toolByName("alta_alumnos")!.run({ origen: "adjunto", texto: "", hoja: "", filtro_color: "", curso_id: "", grupo: "" }, ctx3);
    check("Adjunto sin archivo guardado: error claro, sin reventar", !fallo.proposalId && fallo.forModel.length > 0, fallo.forModel);
  }
}

async function crearCursosChecks() {
  console.log("\n— Crear cursos en lote");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} cursos`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };

  const drafts = toCourseDrafts({
    courses: [
      { title: `${P} Alturas`, description: "Trabajos en altura", validity_months: 24 },
      { title: "  ", description: "sin título", validity_months: 0 },
      { title: `${P} Montacargas`, description: "", validity_months: 0 },
    ],
  });
  check("Conversión: tres borradores", drafts.length === 3, drafts.length);
  check("Vigencia en meses", drafts[0].validityMonths === 24);
  check("Sin vigencia: vitalicio", drafts[2].validityMonths === null);

  const result = await toolByName("crear_cursos")!.run(
    { origen: "texto", texto: `Titulo,Descripcion,Vigencia\n${P} Alturas,Trabajos en altura,24\n${P} Montacargas,,\n,,12`, hoja: "" },
    ctx
  );
  check("Crea la propuesta", typeof result.proposalId === "string", result.forModel);
  const proposal = getProposal(result.proposalId!)!;
  check("Tres filas", proposal.rows.length === 3, proposal.rows);
  check("Fila sin título: bloqueada", proposal.rows[2].blocked === true, proposal.rows[2]);
  check("Columnas editables", proposal.draft.columns.every((c) => c.editable !== false));

  const applied = await applyProposal(result.proposalId!, proposal.rows, ctx, "");
  check("Se crean dos", "text" in applied && applied.text.includes("2"), applied);
  const creados = db.select().from(coursesTable).where(like(coursesTable.title, `${P} %`)).all();
  const alturas = creados.find((c) => c.title.includes("Alturas"));
  const monta = creados.find((c) => c.title.includes("Montacargas"));
  check("Nacen en borrador y a nombre del maestro", !!alturas && alturas!.status === "draft" && alturas!.ownerId === ids.teacher, alturas && [alturas.status, alturas.ownerId]);
  check("Guarda la vigencia en meses", alturas?.validityMonths === 24, alturas?.validityMonths);
  check("Sin vigencia queda como el resto de cursos nuevos", !!monta && monta!.validityMonths === null, monta?.validityMonths);
  check("Auditoría", db.select().from(auditLog).where(eq(auditLog.action, "assistant_crear_cursos")).get() !== undefined);

  // Título repetido
  const repetido = await toolByName("crear_cursos")!.run({ origen: "texto", texto: `Titulo,Descripcion\n${P} Alturas,otra vez`, hoja: "" }, ctx);
  const pRep = getProposal(repetido.proposalId!)!;
  check("Título que ya existe: bloqueado", pRep.rows[0].blocked === true && (pRep.rows[0].warning ?? "").toLowerCase().includes("ya"), pRep.rows[0]);

  // Corregir en la tabla una fila con aviso sí sirve: se revalida al aplicar
  check("Las filas con aviso se vuelven a revisar", getProposal(repetido.proposalId!)?.draft.recheckOnApply === true);
  const corregida = await applyProposal(
    repetido.proposalId!,
    pRep.rows.map((r) => ({ ...r, cells: { ...r.cells, titulo: `${P} Espacios Confinados` } })),
    ctx,
    ""
  );
  check("Con el título corregido, el curso se crea", "text" in corregida && corregida.text.includes("1"), corregida);
  check(
    "…y existe en la base",
    db.select().from(coursesTable).where(like(coursesTable.title, `${P} Espacios%`)).all().length === 1
  );
}

// ─── Formatos de Excel (generar y aceptar de vuelta) ─────────────────────────

/** Puro: lo único que distingue un formato de otro son sus encabezados. */
function excelFormatChecks() {
  console.log("\n— Reconocer el formato por los encabezados");
  check("Lecciones", detectFormat(["id", "carpeta", "tipo", "titulo", "requerido", "secuencia", "visible", "segundos_minimos"]) === "lecciones");
  check("Lecciones: basta id, titulo y una propiedad", detectFormat(["id", "titulo", "visible"]) === "lecciones");
  check("Matrícula", detectFormat(["correo", "nombre", "progreso", "estado", "accion"]) === "matricula");
  check("Examen", detectFormat(["tipo", "pregunta", "puntos", "opcion_1", "correctas"]) === "examen");
  check("Alumnos", detectFormat(["nombre", "correo", "contrasena", "grupo"]) === "alumnos");
  check("Cursos", detectFormat(["titulo", "descripcion", "vigencia"]) === "cursos");
  check("Mayúsculas, acentos y espacios", detectFormat(["Correo electrónico", "Nombre completo", "ACCIÓN"]) === "matricula");
  check("Otro orden y con alias", detectFormat(["E-mail", "Alumno"]) === "alumnos");
  check("Examen con alias", detectFormat(["Tipo", "Enunciado", "Pts"]) === "examen");
  check("Lecciones con acentos", detectFormat(["ID", "Título", "Segundos mínimos"]) === "lecciones");
  check("Con «accion» manda la matrícula, no los alumnos", detectFormat(["nombre", "correo", "accion"]) === "matricula");
  check("Cursos no se confunde con lecciones (trae id)", detectFormat(["id", "titulo", "descripcion"]) === null);
  check("Encabezados que no son de ningún formato", detectFormat(["cosa", "otra", "mas"]) === null);
  check("Sin encabezados", detectFormat([]) === null);
}

/** Curso aparte con lecciones y un examen: es lo que se exporta y se devuelve editado. */
const fmt = { curso: "", ajeno: "", leccion: "", video: "", examen: "" };

function seedFormatos() {
  fmt.curso = createCourse({ ownerId: ids.teacher, title: `${P} Formatos` }).id;
  fmt.leccion = createItem({ courseId: fmt.curso, parentId: null, kind: "text", title: `${P} Introducción` }).id;
  fmt.video = createItem({ courseId: fmt.curso, parentId: null, kind: "video", title: `${P} Video` }).id;
  fmt.examen = createItem({ courseId: fmt.curso, parentId: null, kind: "exam", title: `${P} Evaluación` }).id;
  // De otro maestro: el formato no debe salir
  fmt.ajeno = createCourse({ ownerId: ids.admin, title: `${P} Ajeno` }).id;
  enrollStudents(fmt.curso, [ids.s1], ids.teacher);
}

/** Las hojas del Excel que una herramienta dejó en su bloque de descarga. */
async function hojasDeDescarga(blocks: AssistantBlock[] | undefined): Promise<SheetData[]> {
  const file = await readExportBytes(ids.teacher, exportIdOf(blocks));
  return file ? readSheetRows(file.bytes, file.fileName) : [];
}

/** Filas de texto → xlsx, como si el usuario hubiera llenado la hoja y la subiera. */
function xlsxDeFilas(hoja: string, headers: string[], filas: string[][]): Promise<Buffer> {
  return buildXlsx([
    { name: hoja, columns: headers.map((title) => ({ title })), rows: filas.map((f) => f.map((text) => ({ text }))) },
  ]);
}

/** Sube la hoja como adjunto real de la conversación (archivo en disco incluido). */
async function adjuntar(conversationId: string, bytes: Buffer, name: string): Promise<StoredAttachment> {
  const fileId = await saveTestFile(bytes, name, ids.teacher);
  const { id, summary } = await attachToConversation({ conversationId, fileId, userId: ids.teacher });
  return { id, fileId, summary };
}

/** Las celdas de una hoja, ya rellenadas a lo ancho del encabezado. */
function filasDe(hoja: SheetData | undefined, headers: string[]): string[][] {
  return (hoja?.rows ?? []).slice(1).map((r) => headers.map((_, i) => r.cells[i] ?? ""));
}

async function formatoExcelChecks() {
  console.log("\n— Formato de Excel para llenar");
  seedFormatos();
  if (!HAS_SOFFICE) {
    console.log("  (sin LibreOffice: se omite)");
    return;
  }
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} formatos`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };
  const pedir = (tipo: string, curso_id = "", item_id = "") =>
    toolByName("formato_excel")!.run({ tipo, curso_id, item_id }, ctx);

  const alumnos = await pedir("alumnos");
  check("Alumnos: deja la descarga del formato", downloadOf(alumnos.blocks)?.label === "Descargar el formato", alumnos.blocks);
  check("…y le dice qué hacer con él", (alumnos.blocks ?? []).some((b) => b.type === "text" && b.text.includes("suéltalo")), alumnos.blocks);
  check("La IA solo ve la línea corta con el id de la descarga", alumnos.forModel.length < 200 && alumnos.forModel.includes("Descarga:"), alumnos.forModel);
  const hojasA = await hojasDeDescarga(alumnos.blocks);
  check("Alumnos: los encabezados que la plataforma sabe leer", (hojasA[0]?.rows[0]?.cells ?? []).join("|") === "nombre|correo|contrasena|grupo", hojasA[0]?.rows[0]?.cells);
  check("Alumnos: una sola fila de ejemplo", hojasA[0]?.rows.length === 2 && (hojasA[0]?.rows[1]?.cells[1] ?? "").includes("@"), hojasA[0]?.rows[1]?.cells);
  check("Alumnos: hoja de notas con una línea por columna", (hojasA[1]?.name ?? "").includes("Notas") && (hojasA[1]?.rows.length ?? 0) >= 5, hojasA.map((h) => h.name));

  const cursos = await pedir("cursos");
  const hojasC = await hojasDeDescarga(cursos.blocks);
  check("Cursos: encabezados y ejemplo", (hojasC[0]?.rows[0]?.cells ?? []).join("|") === "titulo|descripcion|vigencia" && hojasC[0]?.rows.length === 2, hojasC[0]?.rows.map((r) => r.cells));
  check("Cursos: las notas explican la vigencia", (hojasC[1]?.rows ?? []).some((r) => r.cells[0].includes("sin vencimiento")), hojasC[1]?.rows.map((r) => r.cells[0]));

  const matricula = await pedir("matricula", fmt.curso);
  const hojasM = await hojasDeDescarga(matricula.blocks);
  const filasM = hojasM[0]?.rows ?? [];
  check("Matrícula: los encabezados del export de siempre", (filasM[0]?.cells ?? []).join("|") === "correo|nombre|progreso|estado|accion", filasM[0]?.cells);
  check("Matrícula: sale con quien está matriculado hoy", filasM.length === 2 && filasM[1].cells[0] === `${P}-ana@test.local`, filasM[1]?.cells);
  check("Matrícula: la columna que se edita viene vacía", (filasM[1]?.cells[4] ?? "") === "", filasM[1]?.cells);
  check("Matrícula: las notas dicen qué se escribe", (hojasM[1]?.rows ?? []).some((r) => r.cells[0].includes("matricular o quitar")), hojasM[1]?.rows.map((r) => r.cells[0]));

  const lecciones = await pedir("lecciones", fmt.curso);
  const hojasL = await hojasDeDescarga(lecciones.blocks);
  const filasL = hojasL[0]?.rows ?? [];
  check("Lecciones: los encabezados del export de siempre", (filasL[0]?.cells ?? []).join("|") === "id|carpeta|tipo|titulo|requerido|secuencia|visible|segundos_minimos", filasL[0]?.cells);
  check("Lecciones: una fila por lección, con su id", filasL.length === 4 && filasL.some((r) => r.cells[0] === fmt.leccion && r.cells[3] === `${P} Introducción`), filasL.map((r) => r.cells.slice(0, 4)));
  check("Lecciones: las notas avisan de no tocar el id", (hojasL[1]?.rows ?? []).some((r) => r.cells[0].includes("«id»")), hojasL[1]?.rows.map((r) => r.cells[0]));

  const examen = await pedir("examen");
  const hojasE = await hojasDeDescarga(examen.blocks);
  const filasE = hojasE[0]?.rows ?? [];
  check("Examen sin id: la plantilla en blanco", (filasE[0]?.cells ?? []).slice(0, 3).join("|") === "tipo|pregunta|puntos", filasE[0]?.cells);
  check("Examen: un ejemplo de cada tipo", filasE.length === 8, filasE.length);
  check("Examen: las notas explican los tipos y los pares", (hojasE[1]?.rows ?? []).some((r) => r.cells[0].includes("verdadero_falso")) && (hojasE[1]?.rows ?? []).some((r) => r.cells[0].includes("izquierda=derecha")), hojasE[1]?.rows.map((r) => r.cells[0]));

  const conPreguntas = await pedir("examen", "", fmt.examen);
  check("Examen vacío por id: sigue siendo la plantilla y lo dice en las notas", (await hojasDeDescarga(conPreguntas.blocks))[1]?.rows[0]?.cells[0]?.includes("todavía no tiene preguntas") === true, conPreguntas.forModel);

  const ajeno = await pedir("matricula", fmt.ajeno);
  check("Curso que no es tuyo: no genera nada", !downloadOf(ajeno.blocks) && ajeno.forModel.includes("no te pertenece"), ajeno.forModel);
  const sinCurso = await pedir("lecciones");
  check("Sin curso: lo pide y manda a buscar_curso", !downloadOf(sinCurso.blocks) && sinCurso.forModel.includes("buscar_curso"), sinCurso.forModel);
  const examenAjeno = await pedir("examen", "", fmt.leccion);
  check("Un id que no es de examen: se niega", !downloadOf(examenAjeno.blocks) && examenAjeno.forModel.includes("examen"), examenAjeno.forModel);
}

async function aplicarExcelChecks() {
  console.log("\n— Aplicar un Excel editado");
  if (!HAS_SOFFICE) {
    console.log("  (sin LibreOffice: se omite)");
    return;
  }
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} aplicar`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const base = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };
  const tool = toolByName("aplicar_excel")!;

  const sinAdjunto = await tool.run({ curso_id: "", item_id: "", formato: "" }, base);
  check("Sin adjunto: lo dice y no propone nada", !sinAdjunto.proposalId && sinAdjunto.forModel.toLowerCase().includes("adjunto"), sinAdjunto.forModel);

  // ── Matrícula: la vuelta completa (se genera, se edita y se aplica) ──
  const formato = await toolByName("formato_excel")!.run({ tipo: "matricula", curso_id: fmt.curso, item_id: "" }, base);
  const hojas = await hojasDeDescarga(formato.blocks);
  const cabecera = hojas[0]?.rows[0]?.cells ?? [];
  const iAccion = cabecera.indexOf("accion");
  const filas = filasDe(hojas[0], cabecera);
  for (const fila of filas) if (fila[0] === `${P}-ana@test.local`) fila[iAccion] = "quitar";
  const nueva = cabecera.map(() => "");
  nueva[0] = `${P}-beto@test.local`;
  nueva[iAccion] = "matricular";
  filas.push(nueva);
  const adjM = await adjuntar(conv.id, await xlsxDeFilas("Matrícula", cabecera, filas), `${P}-matricula.xlsx`);
  const ctxM = { ...base, attachments: [adjM] };

  const propM = await tool.run({ curso_id: fmt.curso, item_id: "", formato: "" }, ctxM);
  check("Reconoce la matrícula y crea la propuesta", typeof propM.proposalId === "string", propM.forModel);
  const pM = getProposal(propM.proposalId!)!;
  check("Solo las filas con acción escrita", pM.rows.length === 2, pM.rows.map((r) => r.cells));
  const quitar = pM.rows.find((r) => r.cells.correo === `${P}-ana@test.local`);
  const poner = pM.rows.find((r) => r.cells.correo === `${P}-beto@test.local`);
  check("La de Ana dice Quitar y trae su nombre", quitar?.cells.accion === "Quitar" && (quitar?.cells.alumno ?? "").includes("Ana"), quitar);
  check("La de Beto dice Matricular y no está bloqueada", poner?.cells.accion === "Matricular" && !poner?.blocked, poner);
  check("Las columnas no se editan a mano (manda el archivo)", pM.draft.columns.every((c) => c.editable === false), pM.draft.columns);
  check("El título dice de qué curso es", pM.draft.title.includes("Formatos"), pM.draft.title);
  const ajeno = await tool.run({ curso_id: fmt.ajeno, item_id: "", formato: "" }, ctxM);
  check("Curso que no es tuyo: no propone nada", !ajeno.proposalId && ajeno.forModel.includes("no te pertenece"), ajeno.forModel);
  const sinCurso = await tool.run({ curso_id: "", item_id: "", formato: "" }, ctxM);
  check("Sin curso: lo pide y no aplica nada", !sinCurso.proposalId && sinCurso.forModel.includes("buscar_curso"), sinCurso.forModel);
  const aplM = await applyProposal(propM.proposalId!, pM.rows, ctxM, "");
  check("El resultado trae las cifras del importador", "text" in aplM && aplM.text.includes("1 alumno") && aplM.text.includes("1 dado"), aplM);
  const deAna = db.select().from(enrollments).where(and(eq(enrollments.courseId, fmt.curso), eq(enrollments.studentId, ids.s1))).get();
  const deBeto = db.select().from(enrollments).where(and(eq(enrollments.courseId, fmt.curso), eq(enrollments.studentId, ids.s2))).get();
  check("Ana queda dada de baja de verdad", deAna?.status === "dropped", deAna?.status);
  check("Beto queda matriculado de verdad", deBeto?.status === "active", deBeto?.status);
  check("Auditoría del formato aplicado", db.select().from(auditLog).where(eq(auditLog.action, "assistant_aplicar_excel")).all().length >= 1);

  // ── Lecciones: cambiar un título ──
  const fl = await toolByName("formato_excel")!.run({ tipo: "lecciones", curso_id: fmt.curso, item_id: "" }, base);
  const hojasL = await hojasDeDescarga(fl.blocks);
  const cabL = hojasL[0]?.rows[0]?.cells ?? [];
  const filasL = filasDe(hojasL[0], cabL);
  const iTitulo = cabL.indexOf("titulo");
  for (const fila of filasL) if (fila[0] === fmt.leccion) fila[iTitulo] = `${P} Bienvenida`;
  const adjL = await adjuntar(conv.id, await xlsxDeFilas("Lecciones", cabL, filasL), `${P}-lecciones.xlsx`);
  const ctxL = { ...base, attachments: [adjL] };
  const propL = await tool.run({ curso_id: fmt.curso, item_id: "", formato: "" }, ctxL);
  const pL = getProposal(propL.proposalId!)!;
  const cambia = pL.rows.find((r) => !r.blocked);
  check("Lecciones: solo se aplica la que se editó, y dice qué cambia", pL.rows.filter((r) => !r.blocked).length === 1 && (cambia?.cells.cambio ?? "").includes("título"), pL.rows.map((r) => r.cells));
  check("Lecciones: las que quedan igual se bloquean como «sin cambios»", pL.rows.filter((r) => r.blocked && r.warning === "Sin cambios").length === 2, pL.rows.map((r) => r.warning));
  const aplL = await applyProposal(propL.proposalId!, pL.rows, ctxL, "");
  check("Lecciones: el título cambia de verdad", getItem(fmt.leccion)?.title === `${P} Bienvenida`, getItem(fmt.leccion)?.title);
  check("Lecciones: el resultado lo dice", "text" in aplL && aplL.text.includes("1 lección"), aplL);

  // ── Examen: agregar o reemplazar, nunca a ciegas ──
  const cabE = ["tipo", "pregunta", "puntos", "opcion_1", "opcion_2", "correctas"];
  const filaE = ["opcion_unica", `${P} ¿Qué extintor va en fuego eléctrico?`, "2", "Agua", "CO2", "2"];
  const adjE = await adjuntar(conv.id, await xlsxDeFilas("Preguntas", cabE, [filaE]), `${P}-examen.xlsx`);
  const ctxE = { ...base, attachments: [adjE] };
  const sinItem = await tool.run({ curso_id: fmt.curso, item_id: "", formato: "", modo: "" }, ctxE);
  check("Examen sin item_id: lo pide y no aplica nada", !sinItem.proposalId && sinItem.forModel.includes("item_id"), sinItem.forModel);
  const sinModo = await tool.run({ curso_id: "", item_id: fmt.examen, formato: "", modo: "" }, ctxE);
  check(
    "Examen sin modo: pregunta con las dos opciones y no propone nada",
    !sinModo.proposalId && sinModo.forModel.includes("reemplazar") && sinModo.forModel.includes("agregar") && sinModo.forModel.includes("duplicadas"),
    sinModo.forModel
  );
  const propE = await tool.run({ curso_id: "", item_id: fmt.examen, formato: "", modo: "agregar" }, ctxE);
  const pE = getProposal(propE.proposalId!)!;
  check("Examen: la pregunta sale con su tipo y sus puntos", pE.rows.length === 1 && pE.rows[0].cells.tipo === "Opción única" && pE.rows[0].cells.puntos === "2", pE.rows[0]?.cells);
  check("Examen: el título dice que se agregan", pE.draft.title === `Agregar preguntas a ${P} Evaluación`, pE.draft.title);
  const antesDeAgregar = listQuestions(fmt.examen).length;
  const aplE = await applyProposal(propE.proposalId!, pE.rows, ctxE, "");
  check("Examen: la pregunta se suma a las que ya había", listQuestions(fmt.examen).length === antesDeAgregar + 1, listQuestions(fmt.examen).map((q) => q.promptMd));
  check("Examen: el resultado lo dice", "text" in aplE && aplE.text.includes("1 pregunta"), aplE);

  // Reemplazar: es el caso natural (el archivo salió del propio examen)
  const filaR = ["opcion_unica", `${P} Cada cuanto se revisa un extintor`, "3", "Cada mes", "Cada ano", "2"];
  const adjR = await adjuntar(conv.id, await xlsxDeFilas("Preguntas", cabE, [filaR]), `${P}-examen-2.xlsx`);
  const ctxR = { ...base, attachments: [adjR] };
  const propR = await tool.run({ curso_id: "", item_id: fmt.examen, formato: "", modo: "reemplazar" }, ctxR);
  const pR = getProposal(propR.proposalId!)!;
  check("Reemplazar: el título de la propuesta lo dice", pR.draft.title === `Reemplazar las preguntas de ${P} Evaluación`, pR.draft.title);
  check("Reemplazar: la fila no dice «se agregará»", pR.rows[0]?.cells.estado === "Quedará en el examen", pR.rows[0]?.cells);
  const antesDeReemplazar = listQuestions(fmt.examen).length;
  const aplR = await applyProposal(propR.proposalId!, pR.rows, ctxR, "");
  const quedan = listQuestions(fmt.examen);
  check(
    "Reemplazar: el examen queda SOLO con la del archivo",
    antesDeReemplazar === 1 && quedan.length === 1 && quedan[0].promptMd.includes("revisa un extintor"),
    [antesDeReemplazar, quedan.map((q) => q.promptMd)]
  );
  check("Reemplazar: el resultado dice a cuántas sustituyó", "text" in aplR && aplR.text.includes("reemplazaron a las 1"), aplR);

  // ── Lo que no es de nadie y lo que ya tiene herramienta ──
  const adjRaro = await adjuntar(conv.id, await xlsxDeFilas("Hoja", ["cosa", "otra"], [["1", "2"]]), `${P}-raro.xlsx`);
  const noSe = await tool.run({ curso_id: fmt.curso, item_id: "", formato: "" }, { ...base, attachments: [adjRaro] });
  check("Formato desconocido: lo dice y ofrece los que entiende", !noSe.proposalId && noSe.forModel.includes("No reconocí") && noSe.forModel.includes("matrícula"), noSe.forModel);

  const lista = await makeColoredXlsx();
  if (lista) {
    const adjA = await adjuntar(conv.id, lista, `${P}-lista.xlsx`);
    const remite = await tool.run({ curso_id: "", item_id: "", formato: "" }, { ...base, attachments: [adjA] });
    check("Lista de alumnos: manda a alta_alumnos y no duplica trabajo", !remite.proposalId && remite.forModel.includes("alta_alumnos"), remite.forModel);
    const forzado = await tool.run({ curso_id: "", item_id: "", formato: "cursos" }, { ...base, attachments: [adjA] });
    check("Lo que pide el usuario manda, pero avisa de la diferencia", forzado.forModel.includes("crear_cursos") && forzado.forModel.includes("parecen de alumnos"), forzado.forModel);
  }
}

/**
 * Movimientos de HOY en el curso zasst para que las consultas tengan qué leer:
 * una tarea entregada, un examen calificado por debajo del mínimo, el curso
 * completado y un certificado que vence en 10 días. Lo borra `cleanup()`.
 */
/** Fecha fija de otro año: «30 sep 2020» pase cuando pase la prueba. */
const VIEJO = new Date(2020, 8, 30, 9, 5);
const VIEJO_TEXTO = "30 sep 2020";

function seedMovimientos() {
  const now = new Date();
  // Ratos distintos del MISMO día (así se comprueba el orden por fecha), sin
  // salirse de «hoy» aunque la prueba corra recién pasada la medianoche
  const inicioDia = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const antes = (minutos: number) => new Date(Math.max(inicioDia + 1000, now.getTime() - minutos * 60_000));
  const entregaAt = antes(30);
  const examenAt = antes(15);

  const enrollment = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, ids.course), eq(enrollments.studentId, ids.s1)))
    .get()!;

  const tareaId = nanoid();
  db.insert(courseItems).values({ id: tareaId, courseId: ids.course, position: 0, kind: "assignment", title: `${P} Tarea 1` }).run();
  db.insert(itemAssignments).values({ itemId: tareaId }).run();
  db.insert(assignmentSubmissions)
    .values({ id: nanoid(), itemId: tareaId, enrollmentId: enrollment.id, studentId: ids.s1, submittedAt: entregaAt })
    .run();

  const examenId = nanoid();
  db.insert(courseItems).values({ id: examenId, courseId: ids.course, position: 1, kind: "exam", title: `${P} Examen final` }).run();
  db.insert(exams).values({ itemId: examenId, passScore: 80 }).run();
  db.insert(examAttempts)
    .values({
      id: nanoid(),
      examItemId: examenId,
      studentId: ids.s1,
      enrollmentId: enrollment.id,
      attemptNumber: 1,
      startedAt: entregaAt,
      submittedAt: examenAt,
      finalScore: 6,
      maxScoreSnapshot: 10, // 60 %: por debajo del mínimo de 80
      status: "graded",
    })
    .run();

  db.update(enrollments).set({ status: "completed", completedAt: now }).where(eq(enrollments.id, enrollment.id)).run();

  db.insert(certificates)
    .values({
      id: nanoid(),
      folio: `${P}-CERT-${nanoid(8)}`,
      enrollmentId: enrollment.id,
      studentId: ids.s1,
      courseId: ids.course,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 10 * 86_400_000),
      verificationHash: "x",
    })
    .run();

  // Último acceso de otro año: así se comprueba que esa fecha sí lleva el año
  db.update(users).set({ lastLoginAt: VIEJO }).where(eq(users.id, ids.s1)).run();
}

async function queryChecks() {
  console.log("\n— Consultas");
  seedMovimientos();
  const scope = ownScope({ ...teacherUser, id: ids.teacher });
  const hoy = dateRange("hoy", "");

  const mov = movimientosQuery(scope, hoy, null);
  check("Movimientos: cuatro tiles con cifras", mov.tiles.length === 4 && mov.tiles.every((t) => /^\d+$/.test(t.value)), mov.tiles);
  check("Movimientos: aparece lo de hoy", mov.rows.some((r) => r.join(" ").includes(`${P}`)), mov.rows.slice(0, 3));
  check("Movimientos: CSV con encabezado y BOM", mov.csv.startsWith("﻿") && mov.csv.split("\n").length >= 2);
  check("Movimientos: a la IA van cifras, no la lista", mov.forModel.length <= 400, mov.forModel.length);
  check("Movimientos: máximo 20 filas mostradas", mov.rows.length <= 20);
  const ajeno = movimientosQuery(ownScope({ ...teacherUser, id: ids.admin }), hoy, null);
  check("Otro maestro no ve estos movimientos", !ajeno.rows.some((r) => r.join(" ").includes(`${P}`)), ajeno.rows.slice(0, 3));
  check("Filtrar por curso ajeno no da nada", movimientosQuery(scope, hoy, "no-existe").total === 0);

  const sinEntrar = pendientesQuery(scope, "sin_entrar", null);
  check("Pendientes: columnas de sin_entrar", sinEntrar.columns.join("|") === "Alumno|Curso|Último acceso", sinEntrar.columns);
  check("Pendientes: tipo desconocido no revienta", pendientesQuery(scope, "lo-que-sea" as never, null).columns.length === 3);
  check("Pendientes: sin entregar", pendientesQuery(scope, "sin_entregar", null).columns.includes("Tarea"));
  check("Pendientes: reprobados", pendientesQuery(scope, "reprobados", null).columns.includes("Examen"));

  const emitidos = certificadosQuery(scope, "emitidos", null, 30);
  check("Certificados emitidos: el de la prueba está", emitidos.total >= 1 && emitidos.columns.includes("Folio"));
  const porVencer = certificadosQuery(scope, "por_vencer", null, 30);
  check("Por vencer: dice los días", porVencer.forModel.includes("30"), porVencer.forModel);
  check("Vencidos: no incluye los que no vencen", certificadosQuery(scope, "vencidos", null, 30).rows.every((r) => !r.join(" ").includes("no vence")));

  // Un admin con curso propio entra al panorama; otro sin cursos, no
  makeUser(ids.adminConCurso, "admin-con-curso", "Admin Con Curso", "admin", null);
  makeUser(ids.adminSinCursos, "admin-sin-cursos", "Admin Sin Cursos", "admin", null);
  createCourse({ ownerId: ids.adminConCurso, title: `${P} Curso del admin` });

  const pan = panoramaQuery();
  check("Panorama: una fila por maestro", pan.columns[0] === "Maestro" && pan.rows.length >= 1, pan.columns);
  check("Panorama: el maestro de prueba aparece con sus cifras", pan.rows.some((r) => r[0].includes(`${P}`)), pan.rows.slice(0, 3));
  check("Panorama: tiles totales", pan.tiles.length === 4);
  check(
    "Panorama: el admin con curso propio aparece marcado «(admin)»",
    pan.rows.some((r) => r[0] === `${P} Admin Con Curso (admin)` && r[1] === "1"),
    pan.rows.filter((r) => r[0].includes("Admin"))
  );
  check(
    "Panorama: un admin sin cursos no aparece",
    !pan.rows.some((r) => r[0].includes("Admin Sin Cursos")),
    pan.rows.map((r) => r[0])
  );

  // Extras: lo que la prueba sembró se ve tal cual
  check("Movimientos: entrega, examen, aprobado y certificado", mov.tiles.every((t) => Number(t.value) >= 1), mov.tiles);
  check("Movimientos: el examen lleva puntaje sobre el máximo", mov.rows.some((r) => r[2].includes("6 / 10")), mov.rows.map((r) => r[2]).slice(0, 5));
  check("Movimientos: el total es la suma de los tiles", mov.total === mov.tiles.reduce((s, t) => s + Number(t.value), 0), [mov.total, mov.tiles]);
  const queHaPasado = mov.rows.map((r) => r[2]);
  check(
    "Movimientos: lo más nuevo primero",
    queHaPasado.findIndex((w) => w.startsWith("Certificado")) < queHaPasado.findIndex((w) => w.startsWith("Entregó")),
    queHaPasado
  );
  const reprobados = pendientesQuery(scope, "reprobados", null);
  check("Reprobados: Ana con 60 % y el mínimo de 80", reprobados.rows.some((r) => r[0].includes("Ana") && r[3].includes("60") && r[3].includes("80")), reprobados.rows);
  const sinEntregarRows = pendientesQuery(scope, "sin_entregar", null);
  check("Sin entregar: Beto, que no entregó la tarea", sinEntregarRows.rows.some((r) => r[0].includes("Beto") && r[2].includes("Tarea 1")), sinEntregarRows.rows);
  check("Por vencer: el certificado de la prueba (vence en 10 días)", porVencer.rows.some((r) => r[2].startsWith(`${P}-CERT-`)), porVencer.rows);
  check("Certificados: «no vence» cuando es vitalicio o la fecha si vence", emitidos.rows.every((r) => r[4].length > 0), emitidos.rows.slice(0, 3));
  check("El CSV lleva todas las filas, no solo las 20", certificadosQuery(scope, "emitidos", null, 30).csv.split("\r\n").length === emitidos.total + 1, emitidos.total);
  check("Días fuera de rango: se recorta a 365", certificadosQuery(scope, "por_vencer", null, 9999).forModel.includes("365"));
  check("Días en cero: vuelve a 30", certificadosQuery(scope, "por_vencer", null, 0).forModel.includes("30"));

  // Fechas cortas: «22 sep» (o «30 sep 2025» si es de otro año) y solo «Cuándo» lleva hora
  const esteAnio = String(new Date().getFullYear());
  const soloDia = /^\d{1,2} [a-z]+$/i; // «22 sep»
  const diaConAnio = /^\d{1,2} [a-z]+ \d{4}$/i; // «30 sep 2025»
  const conHora = /^\d{1,2} [a-z]+, \d{1,2}:\d{2}/i; // «22 sep, 10:49 p. m.»
  check(
    "Fechas: «Cuándo» lleva hora corta y, por ser de hoy, va sin el año",
    mov.rows.length > 0 && mov.rows.every((r) => conHora.test(r[3]) && !r[3].includes(esteAnio)),
    mov.rows.map((r) => r[3]).slice(0, 4)
  );
  check(
    "Fechas: «Emitido» es de hoy, sin hora y sin el año",
    emitidos.rows.every((r) => soloDia.test(r[3])),
    emitidos.rows.map((r) => r[3]).slice(0, 3)
  );
  check(
    "Fechas: «Vence» tampoco lleva hora",
    emitidos.rows.every((r) => r[4] === "no vence" || soloDia.test(r[4]) || diaConAnio.test(r[4])),
    emitidos.rows.map((r) => r[4]).slice(0, 3)
  );
  check(
    `Fechas: «Último acceso» de otro año sí lleva el año («${VIEJO_TEXTO}»)`,
    sinEntrar.rows.some((r) => r[0].includes("Ana") && r[2] === VIEJO_TEXTO),
    sinEntrar.rows.filter((r) => r[0].includes("Ana"))
  );
  check(
    "Fechas: «Último acceso» del panorama, sin hora",
    pan.rows.every((r) => r[4] === "nunca" || soloDia.test(r[4]) || diaConAnio.test(r[4])),
    pan.rows.map((r) => r[4])
  );
}

/** Id de la descarga que hay dentro de un bloque `download`. */
function exportIdOf(blocks: AssistantBlock[] | undefined): string {
  const block = (blocks ?? []).find((b) => b.type === "download");
  return block?.type === "download" ? (block.href.split("/").pop() ?? "") : "";
}

function downloadOf(blocks: AssistantBlock[] | undefined): Extract<AssistantBlock, { type: "download" }> | undefined {
  const block = (blocks ?? []).find((b) => b.type === "download");
  return block?.type === "download" ? block : undefined;
}

/**
 * Datos del listado, en un curso APARTE: las demás secciones cuentan lo que hay
 * en «zasst Extintores» y no deben notar nada. Dos lecciones requeridas (el
 * examen no cuenta para completar), así que el avance solo puede ser 0, 50 o
 * 100 %.
 */
const lst = {
  curso: "",
  grupo: `${P} Matutino`,
  eva: nanoid(), // 100 %, completada, certificado vigente
  fito: nanoid(), // 50 %, activa, la única del grupo
  gala: nanoid(), // 0 %, dada de baja
  hugo: nanoid(), // 50 %, activa, reprobada y certificado vencido
  iris: nanoid(), // 0 %, activa, certificado revocado
};

function seedListado() {
  lst.curso = createCourse({ ownerId: ids.teacher, title: `${P} Listado` }).id;
  const l1 = nanoid();
  const l2 = nanoid();
  const examen = nanoid();
  db.insert(courseItems)
    .values([
      { id: l1, courseId: lst.curso, position: 0, kind: "text", title: `${P} Lección 1` },
      { id: l2, courseId: lst.curso, position: 1, kind: "text", title: `${P} Lección 2` },
      // No cuenta para completar: así el avance se mide solo con las lecciones
      { id: examen, courseId: lst.curso, position: 2, kind: "exam", title: `${P} Examen`, requiredForCompletion: false },
    ])
    .run();
  db.insert(exams).values({ itemId: examen, passScore: 80 }).run();

  makeUser(lst.eva, "eva", "Eva Mora", "student", ids.teacher);
  makeUser(lst.fito, "fito", "Fito Paz", "student", ids.teacher);
  makeUser(lst.gala, "gala", "Gala Ríos", "student", ids.teacher);
  makeUser(lst.hugo, "hugo", "Hugo Sol", "student", ids.teacher);
  makeUser(lst.iris, "iris", "Iris Vela", "student", ids.teacher);
  enrollStudents(lst.curso, [lst.eva, lst.fito, lst.gala, lst.hugo, lst.iris], ids.teacher);

  const matricula = (studentId: string) =>
    db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, lst.curso), eq(enrollments.studentId, studentId)))
      .get()!.id;
  const eva = matricula(lst.eva);
  const fito = matricula(lst.fito);
  const gala = matricula(lst.gala);
  const hugo = matricula(lst.hugo);
  const iris = matricula(lst.iris);

  const termina = (enrollmentId: string, itemIds: string[]) => {
    for (const itemId of itemIds) {
      db.insert(itemProgress)
        .values({ id: nanoid(), enrollmentId, itemId, status: "completed", percent: 100, completedAt: new Date() })
        .run();
    }
  };
  termina(eva, [l1, l2]);
  termina(fito, [l1]);
  termina(hugo, [l1]);

  db.update(enrollments).set({ status: "completed", completedAt: new Date() }).where(eq(enrollments.id, eva)).run();
  db.update(enrollments)
    .set({ status: "dropped", droppedAt: new Date(), droppedFrom: "active" })
    .where(eq(enrollments.id, gala))
    .run();

  // Un grupo con un solo alumno: el filtro por grupo tiene que dejar fuera al resto
  assignEnrollmentsToCohort([fito], createCohort(lst.curso, lst.grupo, ids.teacher).id);

  // Hugo reprueba: 5 de 10 (50 %) contra el mínimo de 80
  db.insert(examAttempts)
    .values({
      id: nanoid(),
      examItemId: examen,
      studentId: lst.hugo,
      enrollmentId: hugo,
      attemptNumber: 1,
      startedAt: new Date(),
      submittedAt: new Date(),
      finalScore: 5,
      maxScoreSnapshot: 10,
      status: "graded",
    })
    .run();

  const certificado = (studentId: string, enrollmentId: string, expiresAt: Date, revoked: boolean) =>
    db
      .insert(certificates)
      .values({
        id: nanoid(),
        folio: `${P}-CERT-${nanoid(8)}`,
        enrollmentId,
        studentId,
        courseId: lst.curso,
        issuedAt: new Date(),
        expiresAt,
        revoked,
        verificationHash: "x",
      })
      .run();
  const enDias = (n: number) => new Date(Date.now() + n * 86_400_000);
  certificado(lst.eva, eva, enDias(30), false);
  certificado(lst.hugo, hugo, enDias(-5), false); // vencido
  certificado(lst.iris, iris, enDias(30), true); // revocado
}

/** Los parámetros de la herramienta: todos obligatorios, «» = sin filtro. */
function listadoParams(extra: Record<string, string> = {}) {
  return {
    de: "matriculas",
    curso_id: lst.curso,
    grupo: "",
    estado: "",
    avance_min: "",
    avance_max: "",
    con_certificado: "",
    desde: "",
    hasta: "",
    orden: "",
    ...extra,
  };
}

async function listadoChecks() {
  console.log("\n— Listados a la medida");
  seedListado();
  const scope = ownScope({ ...teacherUser, id: ids.teacher });
  const base: ListadoFiltros = {
    de: "matriculas",
    courseId: null,
    grupo: "",
    estado: "todos",
    avanceMin: null,
    avanceMax: null,
    conCertificado: "da_igual",
    desde: null,
    hasta: null,
    orden: "nombre",
  };
  const q = (extra: Partial<ListadoFiltros>): ListadoResult => listadoQuery(scope, { ...base, ...extra, courseId: extra.courseId ?? null });

  // ── Matrículas ────────────────────────────────────────────────────────────
  const todas = q({ courseId: lst.curso });
  check(
    "Matrículas: las columnas exactas",
    todas.columns.join("|") === "Alumno|Correo|Curso|Grupo|Avance|Estado|Matriculado|Completado",
    todas.columns
  );
  check(
    "Matrículas del curso zasst: las cinco sembradas",
    todas.total === 5 && todas.rows.every((r) => r[2] === `${P} Listado`),
    todas.rows
  );
  const sinFiltro = q({});
  check("Sin filtros: salen esas y las de los demás cursos del maestro", sinFiltro.total >= 5, sinFiltro.total);
  check("Sin filtros: el texto de la IA lo dice", sinFiltro.forModel.includes("sin filtros"), sinFiltro.forModel);

  const grupo = q({ courseId: lst.curso, grupo: lst.grupo });
  check(
    "Filtro por grupo: solo el alumno del grupo",
    grupo.total === 1 && grupo.rows[0][0].includes("Fito") && grupo.rows[0][3] === lst.grupo,
    grupo.rows
  );

  const hasta50 = q({ courseId: lst.curso, avanceMax: 50 });
  check(
    "avance_max 50: Eva (100 %) queda fuera y Fito (50 %) entra",
    !hasta50.rows.some((r) => r[0].includes("Eva")) && hasta50.rows.some((r) => r[0].includes("Fito") && r[4] === "50%"),
    hasta50.rows.map((r) => [r[0], r[4]])
  );
  const desde100 = q({ courseId: lst.curso, avanceMin: 100 });
  check("avance_min 100: solo quien terminó todo", desde100.total === 1 && desde100.rows[0][0].includes("Eva"), desde100.rows);

  const bajas = q({ courseId: lst.curso, estado: "bajas" });
  check(
    "estado bajas: la dada de baja y ninguna activa",
    bajas.total === 1 && bajas.rows[0][0].includes("Gala") && bajas.rows.every((r) => r[5] === "baja"),
    bajas.rows
  );
  const completados = q({ courseId: lst.curso, estado: "completados" });
  check(
    "estado completados: al revés, solo la completada",
    completados.total === 1 && completados.rows[0][0].includes("Eva") && completados.rows.every((r) => r[5] === "completado"),
    completados.rows
  );
  const reprobados = q({ courseId: lst.curso, estado: "reprobados" });
  check("estado reprobados: el mismo criterio que pendientes", reprobados.total === 1 && reprobados.rows[0][0].includes("Hugo"), reprobados.rows);

  const conCert = q({ courseId: lst.curso, conCertificado: "si" });
  check(
    "con_certificado si: solo quien lo tiene vigente (el vencido y el revocado no cuentan)",
    conCert.total === 1 && conCert.rows[0][0].includes("Eva"),
    conCert.rows
  );
  const sinCert = q({ courseId: lst.curso, conCertificado: "no" });
  check("con_certificado no: los otros cuatro", sinCert.total === 4 && !sinCert.rows.some((r) => r[0].includes("Eva")), sinCert.rows.map((r) => r[0]));

  const porAvance = q({ courseId: lst.curso, orden: "avance" });
  check(
    "orden avance: de mayor a menor",
    porAvance.rows[0][0].includes("Eva") && porAvance.rows[0][4] === "100%" && porAvance.rows.at(-1)![4] === "0%",
    porAvance.rows.map((r) => [r[0], r[4]])
  );

  // ── Alumnos ───────────────────────────────────────────────────────────────
  const alumnos = q({ de: "alumnos", courseId: lst.curso });
  check(
    "Alumnos: las columnas exactas",
    alumnos.columns.join("|") === "Nombre|Correo|Cursos|Avance medio|Último acceso|Estado",
    alumnos.columns
  );
  check(
    "Alumnos: los cinco del curso, con sus cursos y su avance medio",
    alumnos.total === 5 && alumnos.rows.some((r) => r[0].includes("Eva") && r[2] === "1" && r[3] === "100%" && r[5] === "activo"),
    alumnos.rows
  );
  const alumnosGrupo = q({ de: "alumnos", courseId: lst.curso, grupo: lst.grupo });
  check("Alumnos por grupo: solo el del grupo", alumnosGrupo.total === 1 && alumnosGrupo.rows[0][0].includes("Fito"), alumnosGrupo.rows);
  const alumnosCert = q({ de: "alumnos", courseId: lst.curso, conCertificado: "si" });
  check("Alumnos con certificado vigente: solo quien lo tiene", alumnosCert.total === 1 && alumnosCert.rows[0][0].includes("Eva"), alumnosCert.rows);
  const alumnosBaja = q({ de: "alumnos", courseId: lst.curso, estado: "bajas" });
  check("Alumnos dados de baja del curso: solo la baja", alumnosBaja.total === 1 && alumnosBaja.rows[0][0].includes("Gala"), alumnosBaja.rows);
  const alumnosSinEntrar = q({ de: "alumnos", courseId: lst.curso, estado: "sin_entrar" });
  const matriculasSinEntrar = q({ courseId: lst.curso, estado: "sin_entrar" });
  check(
    "Sin entrar: los tres con matrícula activa que nunca entraron (ni la completada ni la baja)",
    alumnosSinEntrar.total === 3 && matriculasSinEntrar.total === 3 && !alumnosSinEntrar.csv.includes("Gala"),
    [alumnosSinEntrar.rows.map((r) => r[0]), matriculasSinEntrar.rows.map((r) => r[0])]
  );
  const ajenos = listadoQuery(ownScope({ ...teacherUser, id: ids.admin }), { ...base, de: "alumnos" });
  check(
    "Alumnos: con el contexto de otro maestro no aparecen los de la prueba",
    !ajenos.csv.includes("Eva Mora") && !ajenos.csv.includes("Fito Paz") && !ajenos.csv.includes("Ana López"),
    ajenos.total
  );

  // ── Certificados ──────────────────────────────────────────────────────────
  const certs = q({ de: "certificados", courseId: lst.curso });
  check("Certificados: las columnas exactas", certs.columns.join("|") === "Alumno|Curso|Folio|Emitido|Vence|Estado", certs.columns);
  check(
    "Certificados: uno vigente, uno vencido y uno revocado",
    certs.total === 3 && ["vigente", "vencido", "revocado"].every((e) => certs.rows.some((r) => r[5] === e)),
    certs.rows.map((r) => [r[0], r[5]])
  );
  const estiloDe = (nombre: string) => certs.sheet.rows.find((r) => r[0].text.includes(nombre))?.[0].style;
  check("Hoja: el vencido y el revocado, en rojo", estiloDe("Hugo") === "bad" && estiloDe("Iris") === "bad", [estiloDe("Hugo"), estiloDe("Iris")]);
  check("Hoja: el vigente, en verde", estiloDe("Eva") === "good", estiloDe("Eva"));
  const vigentes = q({ de: "certificados", courseId: lst.curso, estado: "activos" });
  check("Certificados vigentes: solo el que no está ni vencido ni revocado", vigentes.total === 1 && vigentes.rows[0][5] === "vigente", vigentes.rows);

  // ── Lo que ve la IA ───────────────────────────────────────────────────────
  const resultados = [todas, sinFiltro, grupo, hasta50, bajas, completados, reprobados, conCert, alumnos, alumnosGrupo, certs, porAvance];
  check("A la IA: nunca más de 400 caracteres", resultados.every((r) => r.forModel.length <= 400), resultados.map((r) => r.forModel.length));
  check("A la IA: cifras y nombres, nunca correos", resultados.every((r) => !r.forModel.includes("@")), resultados.map((r) => r.forModel).slice(0, 3));
  check("A la IA: el filtro va en palabras", grupo.forModel.includes(`grupo «${lst.grupo}»`) && hasta50.forModel.includes("avance 0–50 %"), [grupo.forModel, hasta50.forModel]);
  check("A la IA: cuántos pasan el filtro y sobre cuántos", /: 1 de \d+\./.test(grupo.forModel), grupo.forModel);

  // ── El Excel ──────────────────────────────────────────────────────────────
  if (HAS_SOFFICE) {
    const sheets = await readSheetRows(await buildXlsx([todas.sheet]), "listado.xlsx");
    check("Excel: la hoja del listado y la de notas", sheets.length === 2 && sheets[0].name === "Listado de matrículas", sheets.map((s) => s.name));
    const filas = sheets[0]?.rows ?? [];
    check("Excel: encabezado con las mismas columnas", filas[0]?.cells.join("|") === todas.columns.join("|"), filas[0]?.cells);
    check("Excel: una fila por matrícula", filas.length === todas.total + 1, filas.length);
    const fila = (nombre: string) => filas.find((r) => r.cells[0].includes(nombre));
    check("Excel: la matrícula reprobada sale en rojo", fila("Hugo")?.color === "rojo", fila("Hugo")?.color);
    check("Excel: la baja también", fila("Gala")?.color === "rojo", fila("Gala")?.color);
    check("Excel: la completada sale en verde", fila("Eva")?.color === "verde", fila("Eva")?.color);
  } else {
    console.log("  (sin LibreOffice: se omite el Excel)");
  }

  // ── La herramienta ────────────────────────────────────────────────────────
  check("listado está en el catálogo de los dos roles", !!toolByName("listado") && ["teacher", "admin"].every((r) => toolsForRole(r as "teacher").some((t) => t.name === "listado")));
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} listado`);
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id };

  const res = await toolByName("listado")!.run(listadoParams(), ctx);
  const descargas = (res.blocks ?? []).filter((b) => b.type === "download");
  check("listado: tiles y tabla", (res.blocks ?? []).some((b) => b.type === "tiles") && (res.blocks ?? []).some((b) => b.type === "table"), res.blocks?.map((b) => b.type));
  check(
    HAS_SOFFICE ? "listado: deja las dos descargas, Excel primero" : "listado: sin LibreOffice deja solo el CSV",
    HAS_SOFFICE
      ? descargas.length === 2 && descargas[0].label === "Descargar Excel" && descargas[1].label === "Descargar CSV"
      : descargas.length === 1 && descargas[0].label === "Descargar CSV" && res.forModel.includes("no se pudo generar el Excel"),
    descargas
  );
  const csvBloque = descargas.find((b) => b.label === "Descargar CSV");
  const csvId = csvBloque?.href.split("/").pop() ?? "";
  check("listado: el CSV se guarda como texto", readExport(ids.teacher, csvId)?.mime === "text/csv", readExport(ids.teacher, csvId));

  if (HAS_SOFFICE) {
    const excelId = descargas[0].href.split("/").pop() ?? "";
    const info = readExport(ids.teacher, excelId);
    if (info?.fileId) testFileIds.push(info.fileId);
    check("listado: la descarga de Excel se guarda con su tipo", info?.mime === XLSX_MIME && !!info.fileId, info);
    check("listado: el tamaño del Excel va en el botón", /^\d+ KB · 5 filas · caduca en 24 horas$/.test(descargas[0].detail ?? ""), descargas[0].detail);
    check("listado: los dos ids viajan a la IA", res.forModel.includes(excelId) && res.forModel.includes(csvId), res.forModel);
    const reofrecida = await toolByName("descargar_csv")!.run({ descarga_id: excelId }, ctx);
    check("descargar_csv de un Excel: el botón dice «Descargar Excel»", downloadOf(reofrecida.blocks)?.label === "Descargar Excel", reofrecida.blocks);
    const reofrecidaCsv = await toolByName("descargar_csv")!.run({ descarga_id: csvId }, ctx);
    check("descargar_csv de un CSV: sigue diciendo «Descargar CSV»", downloadOf(reofrecidaCsv.blocks)?.label === "Descargar CSV", reofrecidaCsv.blocks);
  }

  // Números como texto: lo que no sea 0–100 no filtra nada
  const raro = await toolByName("listado")!.run(listadoParams({ avance_min: "abc", avance_max: "500" }), ctx);
  check("listado: un avance que no es número no filtra", raro.forModel.includes(": 5 de"), raro.forModel);

  const vacio = await toolByName("listado")!.run(listadoParams({ grupo: `${P} Nocturno` }), ctx);
  check(
    "listado sin filas: ninguna descarga y el texto dice qué dejó fuera",
    !(vacio.blocks ?? []).some((b) => b.type === "download") && vacio.forModel.includes("Nocturno") && vacio.forModel.includes("ninguna"),
    vacio.forModel
  );
}

// ─── Reportes en Excel ───────────────────────────────────────────────────────

/** El valor de un tile por su etiqueta. */
function tileOf(blocks: AssistantBlock[] | undefined, label: string): string | undefined {
  return (blocks ?? []).flatMap((b) => (b.type === "tiles" ? b.tiles : [])).find((t) => t.label === label)?.value;
}

/** Las dos descargas de un reporte, en orden (Excel primero). */
function descargasDe(blocks: AssistantBlock[] | undefined) {
  return (blocks ?? []).filter((b): b is Extract<AssistantBlock, { type: "download" }> => b.type === "download");
}

const mimeDe = (href: string) => readExport(ids.teacher, href.split("/").pop() ?? "")?.mime;

/**
 * Los dos reportes. Usa los cursos que ya sembraron `queryChecks` («zasst
 * Extintores») y `listadoChecks` («zasst Listado»: dos lecciones requeridas y
 * cuatro matrículas vivas con avances distintos), más dos cursos vacíos para
 * los casos en los que no hay nada que reportar.
 */
async function reporteChecks() {
  console.log("\n— Reportes en Excel");
  const user = { ...teacherUser, id: ids.teacher };
  const scope = ownScope(user);
  const conv = createConversation(ids.teacher, `${P} reportes`);
  const ctx = { ...ctxFor(user, scope), conversationId: conv.id };
  const avance = toolByName("reporte_avance")!;
  const periodo = toolByName("reporte_periodo")!;

  check(
    "Las dos están en el catálogo de los dos roles",
    ["reporte_avance", "reporte_periodo"].every((n) =>
      ["teacher", "admin"].every((r) => toolsForRole(r as "teacher").some((t) => t.name === n))
    ),
    toolsForRole("teacher").map((t) => t.name)
  );
  check("Ya no se anuncian los reportes como «aún no puedo»", !NOT_YET.join(" ").includes("reporte"), NOT_YET);

  // Cursos para los casos sin nada que reportar (se crean antes de contar el periodo)
  const sinAlumnos = createCourse({ ownerId: ids.teacher, title: `${P} Sin alumnos` }).id;
  createItem({ courseId: sinAlumnos, parentId: null, kind: "text", title: `${P} Única` });
  const sinLecciones = createCourse({ ownerId: ids.teacher, title: `${P} Sin lecciones` }).id;
  enrollStudents(sinLecciones, [ids.s2], ids.teacher);

  // ── La hoja, sobre el SheetSpec ───────────────────────────────────────────
  const matriz = courseMatrix(lst.curso, { page: 1, pageSize: 100000, filter: "all", cohort: { kind: "default" } });
  const hoja = hojaAvance(matriz.columns, matriz.rows);
  check(
    "Avance: columnas fijas y una por lección requerida",
    hoja.columns.map((c) => c.title).join("|") === `Estudiante|Correo|% Curso|Estado|${P} Lección 1|${P} Lección 2`,
    hoja.columns.map((c) => c.title)
  );
  const filaDe = (nombre: string) => hoja.rows.find((r) => r[0].text.includes(nombre));
  const eva = filaDe("Eva");
  const iris = filaDe("Iris");
  check("Avance: el % del curso es un número de verdad", eva?.[2].percent === 1 && eva?.[2].text === "100%", eva?.[2]);
  check("Avance: la lección completada sale en verde", eva?.[4].style === "good" && eva?.[4].text === "Completado", eva?.[4]);
  check("Avance: la que no se ha empezado sale en gris", iris?.[4].style === "muted" && iris?.[4].text === "Sin empezar", iris?.[4]);
  check("Avance: la que la secuencia bloquea sale en rojo", iris?.[5].style === "bad" && iris?.[5].text === "Bloqueado", iris?.[5]);
  check("Avance: el estado del curso acompaña a la fila", eva?.[3].text === "Aprobado" && eva?.[3].style === "good", eva?.[3]);
  check("Avance: la baja no entra (la matriz la deja fuera)", !hoja.rows.some((r) => r[0].text.includes("Gala")), hoja.rows.map((r) => r[0].text));

  const resumen = hojaResumen(
    { curso: `${P} Listado`, grupo: "", filtro: "all", incluidos: matriz.rows.length, total: matriz.total },
    matriz.columns,
    matriz.rows
  );
  const valor = (dato: string) => resumen.rows.find((r) => r[0].text === dato)?.[1];
  check("Resumen: alumnos, completados y sin empezar", valor("Alumnos")?.number === 4 && valor("Completados")?.number === 1 && valor("Sin empezar")?.number === 1, [
    valor("Alumnos"),
    valor("Completados"),
    valor("Sin empezar"),
  ]);
  check("Resumen: el avance medio, como porcentaje", valor("Avance medio")?.percent === 0.5, valor("Avance medio"));
  const iPeores = resumen.rows.findIndex((r) => r[0].text === "Lecciones con menos avance");
  check(
    "Resumen: las lecciones con menos avance, la peor primero",
    iPeores > 0 && resumen.rows[iPeores + 1]?.[0].text === `${P} Lección 2` && resumen.rows[iPeores + 1]?.[1].percent === 0.25,
    resumen.rows.slice(iPeores + 1).map((r) => [r[0].text, r[1]?.percent])
  );

  // ── La herramienta ────────────────────────────────────────────────────────
  const res = await avance.run({ curso_id: lst.curso, grupo: "", solo: "" }, ctx);
  const descargas = descargasDe(res.blocks);
  check("reporte_avance: tiles y tabla corta con los primeros alumnos", tileOf(res.blocks, "Alumnos") === "4" && (res.blocks ?? []).some((b) => b.type === "table" && b.rows.length === 4), res.blocks?.map((b) => b.type));
  check("reporte_avance: cifras del curso en los tiles", tileOf(res.blocks, "Completados") === "1" && tileOf(res.blocks, "Avance medio") === "50%", res.blocks?.[0]);
  check(
    HAS_SOFFICE ? "reporte_avance: las dos descargas, Excel primero" : "reporte_avance: sin LibreOffice, solo el CSV",
    HAS_SOFFICE
      ? descargas.length === 2 && descargas[0].label === "Descargar Excel" && descargas[1].label === "Descargar CSV"
      : descargas.length === 1 && descargas[0].label === "Descargar CSV",
    descargas.map((d) => d.label)
  );
  if (HAS_SOFFICE) {
    check("reporte_avance: cada descarga con su tipo", mimeDe(descargas[0].href) === XLSX_MIME && mimeDe(descargas[1].href) === "text/csv", descargas.map((d) => mimeDe(d.href)));
  }
  check("reporte_avance: a la IA, una línea corta con las cifras", res.forModel.length <= 400 && res.forModel.includes("4 alumno(s)") && res.forModel.includes("avance medio 50 %"), res.forModel);

  const csvDelReporte = readExport(ids.teacher, descargas.at(-1)!.href.split("/").pop() ?? "")?.content ?? "";
  check("reporte_avance: el CSV es el mismo de la pantalla de Reportes", csvDelReporte.includes("Estudiante,Correo,% Curso,Estado del curso,"), csvDelReporte.slice(0, 80));

  if (HAS_SOFFICE) {
    const hojas = await hojasDeDescarga(res.blocks);
    check("Excel: las dos hojas del reporte", hojas.length === 2 && hojas[0].name === "Avance" && hojas[1].name === "Resumen", hojas.map((h) => h.name));
    const filas = hojas[0]?.rows ?? [];
    check("Excel: el encabezado trae una columna por lección", filas[0]?.cells.join("|") === `Estudiante|Correo|% Curso|Estado|${P} Lección 1|${P} Lección 2`, filas[0]?.cells);
    check("Excel: una fila por alumno", filas.length === 5, filas.length);
    const fEva = filas.find((r) => r.cells[0].includes("Eva"));
    check("Excel: la fila de la que terminó viene en verde", fEva?.color === "verde", fEva?.color);
  }

  // ── Filtros y casos en los que no hay nada que reportar ───────────────────
  const porGrupo = await avance.run({ curso_id: lst.curso, grupo: lst.grupo, solo: "" }, ctx);
  check(
    "reporte_avance: el grupo deja solo a su alumno",
    tileOf(porGrupo.blocks, "Alumnos") === "1" && porGrupo.forModel.includes(lst.grupo) && porGrupo.forModel.length <= 400,
    porGrupo.forModel
  );
  const soloCompletados = await avance.run({ curso_id: lst.curso, grupo: "", solo: "completados" }, ctx);
  const tablaCompletados = (soloCompletados.blocks ?? []).find((b) => b.type === "table");
  check(
    "reporte_avance: «completados» deja solo a quien terminó",
    tileOf(soloCompletados.blocks, "Alumnos") === "1" && tablaCompletados?.type === "table" && tablaCompletados.rows[0][0].includes("Eva"),
    tablaCompletados
  );
  const grupoRaro = await avance.run({ curso_id: lst.curso, grupo: `${P} Nocturno`, solo: "" }, ctx);
  check("reporte_avance: un grupo que no existe se avisa sin generar nada", descargasDe(grupoRaro.blocks).length === 0 && grupoRaro.forModel.includes("Nocturno"), grupoRaro.forModel);
  const ajeno = await avance.run({ curso_id: fmt.ajeno, grupo: "", solo: "" }, ctx);
  check("reporte_avance: curso ajeno, se niega", descargasDe(ajeno.blocks).length === 0 && ajeno.forModel.includes("no te pertenece"), ajeno.forModel);
  const sinCurso = await avance.run({ curso_id: "", grupo: "", solo: "" }, ctx);
  check("reporte_avance: sin curso manda a buscar_curso", descargasDe(sinCurso.blocks).length === 0 && sinCurso.forModel.includes("buscar_curso"), sinCurso.forModel);
  const vacioAlumnos = await avance.run({ curso_id: sinAlumnos, grupo: "", solo: "" }, ctx);
  check("reporte_avance: curso sin alumnos, lo dice y no genera nada", descargasDe(vacioAlumnos.blocks).length === 0 && vacioAlumnos.forModel.includes("no tiene alumnos"), vacioAlumnos.forModel);
  const vacioLecciones = await avance.run({ curso_id: sinLecciones, grupo: "", solo: "" }, ctx);
  check("reporte_avance: curso sin lecciones requeridas, lo dice y no genera nada", descargasDe(vacioLecciones.blocks).length === 0 && vacioLecciones.forModel.includes("ninguna lección"), vacioLecciones.forModel);

  // ── Reporte de periodo ────────────────────────────────────────────────────
  const hoy = dateRange("hoy", "");
  const mov = movimientosQuery(scope, hoy, null);
  const movTile = (label: string) => mov.tiles.find((t) => t.label === label)?.value;
  const per = await periodo.run({ desde: "hoy", hasta: "", curso_id: "" }, ctx);
  const descargasPer = descargasDe(per.blocks);
  check(
    "reporte_periodo: las cifras cuadran con las de movimientos",
    ["Entregas", "Exámenes", "Aprobados", "Certificados"].every((l) => tileOf(per.blocks, l) === movTile(l)),
    ["Entregas", "Exámenes", "Aprobados", "Certificados"].map((l) => [l, tileOf(per.blocks, l), movTile(l)])
  );
  check("reporte_periodo: también cuenta altas y matrículas del periodo", Number(tileOf(per.blocks, "Altas")) > 0 && Number(tileOf(per.blocks, "Matrículas")) > 0, [tileOf(per.blocks, "Altas"), tileOf(per.blocks, "Matrículas")]);
  check("reporte_periodo: a la IA, el rango en palabras y corto", per.forModel.length <= 400 && per.forModel.includes("hoy"), per.forModel);
  check(
    HAS_SOFFICE ? "reporte_periodo: las dos descargas con su tipo" : "reporte_periodo: sin LibreOffice, solo el CSV",
    HAS_SOFFICE
      ? descargasPer.length === 2 && mimeDe(descargasPer[0].href) === XLSX_MIME && mimeDe(descargasPer[1].href) === "text/csv"
      : descargasPer.length === 1 && mimeDe(descargasPer[0].href) === "text/csv",
    descargasPer.map((d) => [d.label, mimeDe(d.href)])
  );

  if (HAS_SOFFICE) {
    const hojasPer = await hojasDeDescarga(per.blocks);
    check("Excel: las hojas Resumen y Detalle", hojasPer.length === 2 && hojasPer[0].name === "Resumen" && hojasPer[1].name === "Detalle", hojasPer.map((h) => h.name));
    const cifra = (dato: string) => hojasPer[0]?.rows.find((r) => r.cells[0] === dato)?.cells[1];
    check("Resumen: una fila por cifra, con los mismos números", cifra("Entregas") === movTile("Entregas") && cifra("Certificados emitidos") === movTile("Certificados"), [cifra("Entregas"), cifra("Certificados emitidos")]);
    check("Resumen: el reparto por curso cuando hay varios", (hojasPer[0]?.rows ?? []).some((r) => r.cells[0] === "Curso" && r.cells[1] === "Matrículas"), hojasPer[0]?.rows.map((r) => r.cells[0]));
    check("Detalle: las mismas filas que movimientos", (hojasPer[1]?.rows.length ?? 0) === mov.total + 1, [hojasPer[1]?.rows.length, mov.total]);
  }

  const unCurso = await periodo.run({ desde: "hoy", hasta: "", curso_id: ids.course }, ctx);
  check("reporte_periodo: acotado a un curso, lo dice", unCurso.forModel.includes("Extintores") && descargasDe(unCurso.blocks).length >= 1, unCurso.forModel);
  const ajenoPer = await periodo.run({ desde: "hoy", hasta: "", curso_id: fmt.ajeno }, ctx);
  check("reporte_periodo: curso ajeno, se niega", descargasDe(ajenoPer.blocks).length === 0 && ajenoPer.forModel.includes("no te pertenece"), ajenoPer.forModel);
  const sinNada = await periodo.run({ desde: "2021-01-01", hasta: "2021-01-02", curso_id: "" }, ctx);
  check("reporte_periodo: un periodo sin movimientos no genera archivos", descargasDe(sinNada.blocks).length === 0 && sinNada.forModel.includes("ningún movimiento"), sinNada.forModel);
}

/** Las herramientas de consulta: usan lo que sembró `queryChecks`. */
async function consultaToolChecks() {
  console.log("\n— Herramientas de consulta");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} consultas`);
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id };
  const admin: SessionUser = { id: ids.admin, email: "", fullName: `${P} Admin`, role: "admin" };
  const convAdmin = createConversation(ids.admin, `${P} consultas admin`);
  const adminCtx = { ...ctxFor(admin, { kind: "all" }), conversationId: convAdmin.id };

  check(
    "panorama: solo del administrador",
    !toolsForRole("teacher").some((t) => t.name === "panorama") && toolsForRole("admin").some((t) => t.name === "panorama")
  );
  check(
    "Las consultas están en el catálogo del maestro",
    ["movimientos", "pendientes", "certificados"].every((n) => toolsForRole("teacher").some((t) => t.name === n))
  );

  const mov = await toolByName("movimientos")!.run({ desde: "hoy", hasta: "", curso_id: "" }, ctx);
  check("movimientos hoy: tiles y tabla", (mov.blocks ?? []).some((b) => b.type === "tiles") && (mov.blocks ?? []).some((b) => b.type === "table"), mov.blocks?.map((b) => b.type));
  check("movimientos: el periodo va en el texto de la IA", mov.forModel.includes("hoy"), mov.forModel);
  const movDl = downloadOf(mov.blocks);
  check(
    "movimientos: deja la descarga del CSV",
    movDl?.label === "Descargar CSV" && movDl.href.startsWith("/api/assistant/export/") && (movDl.detail ?? "").includes("caduca en 24 horas"),
    movDl
  );
  const movId = exportIdOf(mov.blocks);
  const guardada = readExport(ids.teacher, movId);
  check("La descarga la abre su dueño", guardada !== null && (guardada.content ?? "").includes("Alumno"), guardada?.fileName);
  check("Nombre con la fecha del día", /^movimientos-\d{4}-\d{2}-\d{2}\.csv$/.test(guardada?.fileName ?? ""), guardada?.fileName);
  check("Otro usuario no la abre", readExport(ids.admin, movId) === null);
  check("El id de la descarga viaja a la IA", mov.forModel.includes(movId), mov.forModel);

  const ajeno = await toolByName("movimientos")!.run({ desde: "hoy", hasta: "", curso_id: "no-existe" }, ctx);
  check("movimientos con un curso ajeno: lo dice y no enseña nada", !ajeno.blocks && ajeno.forModel.toLowerCase().includes("curso"), ajeno.forModel);

  const raro = await toolByName("pendientes")!.run({ tipo: "lo-que-sea", curso_id: "" }, ctx);
  check("pendientes con un tipo desconocido: no revienta", (raro.blocks ?? []).some((b) => b.type === "tiles") && raro.forModel.length > 0, raro.forModel);
  const sinEntregar = await toolByName("pendientes")!.run({ tipo: "sin_entregar", curso_id: ids.course }, ctx);
  check("pendientes de un curso propio: sí responde", (sinEntregar.blocks ?? []).some((b) => b.type === "tiles"), sinEntregar.forModel);

  const dias = await toolByName("certificados")!.run({ estado: "por_vencer", curso_id: "", dias: "abc" }, ctx);
  check("certificados: «abc» días valen 30", dias.forModel.includes("30"), dias.forModel);
  const dias60 = await toolByName("certificados")!.run({ estado: "por_vencer", curso_id: "", dias: "60" }, ctx);
  check("certificados: un número sí se usa", dias60.forModel.includes("60"), dias60.forModel);

  const panPropio = await toolByName("panorama")!.run({ periodo: "" }, { ...ctxFor(admin, ownScope(admin)), conversationId: convAdmin.id });
  check(
    "panorama fuera de «General — todos»: pide cambiar el contexto y no consulta",
    panPropio.forModel.includes("General") && (panPropio.blocks ?? []).every((b) => b.type === "links"),
    panPropio
  );
  const pan = await toolByName("panorama")!.run({ periodo: "" }, adminCtx);
  check("panorama en «General — todos»: tiles, tabla y descarga", (pan.blocks ?? []).some((b) => b.type === "tiles") && (pan.blocks ?? []).some((b) => b.type === "table") && !!downloadOf(pan.blocks), pan.blocks?.map((b) => b.type));
  check("La descarga del panorama es del administrador", readExport(ids.admin, exportIdOf(pan.blocks)) !== null);

  const todas = [mov, ajeno, raro, sinEntregar, dias, dias60, panPropio, pan];
  check("A la IA le llegan menos de 500 caracteres", todas.every((r) => r.forModel.length < 500), todas.map((r) => r.forModel.length));
}

/** Las herramientas de descarga y la ruta que sirve el CSV. */
async function descargaToolChecks() {
  console.log("\n— Descargar certificados y CSV");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} descargar`);
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id };

  // La ruta que sirve el CSV no se puede llamar desde aquí: importarla arrastra
  // `next/navigation` (no carga fuera de Next) y su `GET` lee las cookies de la
  // petición, que aquí no existen. Lo que decide quién lo abre es `readExport`
  // (dueño y caducidad), probado arriba y otra vez con un id de verdad más
  // abajo; lo único que queda por comprobar es que el archivo esté donde apunta
  // el enlace.
  check("La ruta del CSV existe donde apuntan los enlaces", existsSync("src/app/api/assistant/export/[exportId]/route.ts"));

  const csvId = createExport(conv.id, "movimientos-2026-09-22.csv", "﻿Alumno\r\nAna\r\n");
  const ok = await toolByName("descargar_csv")!.run({ descarga_id: csvId }, ctx);
  const okDl = downloadOf(ok.blocks);
  check("descargar_csv con un id bueno: devuelve el bloque", okDl?.href === `/api/assistant/export/${csvId}` && okDl.label === "Descargar CSV", okDl);
  const malo = await toolByName("descargar_csv")!.run({ descarga_id: "no-existe" }, ctx);
  check("descargar_csv con un id inventado: lo dice y no ofrece nada", !malo.blocks && malo.forModel.includes("ya no está disponible"), malo.forModel);
  const deOtro = await toolByName("descargar_csv")!.run({ descarga_id: csvId }, { ...ctxFor({ ...teacherUser, id: ids.admin }, ownScope({ id: ids.admin, role: "teacher" })), conversationId: conv.id });
  check("descargar_csv de otro usuario: tampoco", !deOtro.blocks, deOtro.forModel);

  const mio = await toolByName("descargar_certificados")!.run({ alumno_id: ids.s1, curso_id: "" }, ctx);
  const mioDl = downloadOf(mio.blocks);
  check("descargar_certificados de un alumno propio: ZIP del alumno", mioDl?.href === `/api/certificates/zip?studentId=${ids.s1}` && mioDl.label === "Descargar certificados", mioDl);
  check("…y dice de quién son", (mioDl?.detail ?? "").includes("Ana"), mioDl?.detail);
  const alumnoAjeno = await toolByName("descargar_certificados")!.run({ alumno_id: ids.s3, curso_id: "" }, ctx);
  check("descargar_certificados de un alumno ajeno: se niega", !alumnoAjeno.blocks && alumnoAjeno.forModel.toLowerCase().includes("alumno"), alumnoAjeno.forModel);

  const curso = await toolByName("descargar_certificados")!.run({ alumno_id: "", curso_id: ids.course }, ctx);
  check("descargar_certificados de un curso propio: ZIP del curso", downloadOf(curso.blocks)?.href === `/api/certificates/zip?courseId=${ids.course}`, curso.blocks);
  const cursoAjeno = await toolByName("descargar_certificados")!.run({ alumno_id: "", curso_id: "no-existe" }, ctx);
  check("descargar_certificados de un curso ajeno: se niega", !cursoAjeno.blocks && cursoAjeno.forModel.toLowerCase().includes("curso"), cursoAjeno.forModel);
  const sinNada = await toolByName("descargar_certificados")!.run({ alumno_id: "", curso_id: "" }, ctx);
  check("descargar_certificados sin id: pide uno", !sinNada.blocks && sinNada.forModel.includes("id"), sinNada.forModel);
}

function suggestionChecks() {
  console.log("\n— Sugerencias del panel");
  const user = { ...teacherUser, id: ids.teacher };
  const mias = platformSuggestions(user, ownScope(user));
  check("Nunca más de 3", mias.length <= 3, mias);
  check("Todas con cifra mayor que cero", mias.every((s) => /^[1-9]\d* \S/.test(s.detail)), mias);
  check("Todas son preguntas", mias.every((s) => s.text.startsWith("¿") && s.text.endsWith("?")), mias);
  const cert = mias.find((s) => s.text === "¿A quién le vence el certificado este mes?");
  check("Está la de certificados por vencer (el de la prueba vence en 10 días)", !!cert && cert.detail.includes("certificado"), mias);
  check("La de certificados va primero", mias[0]?.text === cert?.text, mias);
  check(
    "Las herramientas que contestan esas preguntas existen",
    ["certificados", "pendientes", "buscar_curso", "resumen_curso"].every((n) => toolByName(n) !== null)
  );
  const otro = { ...teacherUser, id: ids.admin };
  const ajenas = platformSuggestions(otro, ownScope(otro));
  check(
    "Otro maestro: cifras distintas (o ninguna sugerencia)",
    ajenas.length === 0 || ajenas.some((s) => !mias.some((m) => m.text === s.text && m.detail === s.detail)),
    ajenas
  );

  // «¿Quién no ha entrado todavía?» cuenta alumnos, no matrículas
  const cuenta = () => [sinEntrarCount(ownScope(user)), pendientesQuery(ownScope(user), "sin_entrar", null).total] as const;
  const [alumnosAntes, matriculasAntes] = cuenta();
  check("Ana ya cuenta como alumno sin entrar", alumnosAntes >= 1, alumnosAntes);
  const segundo = createCourse({ ownerId: ids.teacher, title: `${P} Segundo curso` }).id;
  enrollStudents(segundo, [ids.s1], ids.teacher);
  const [alumnosDespues, matriculasDespues] = cuenta();
  check("Un alumno matriculado en dos cursos del maestro cuenta una vez", alumnosDespues === alumnosAntes, [alumnosAntes, alumnosDespues]);
  check("…y la cuenta por matrículas sí sube (lo que se hacía antes)", matriculasDespues === matriculasAntes + 1, [matriculasAntes, matriculasDespues]);
}

async function detallesChecks() {
  console.log("\n— Caducidad al abrir, búsqueda y ritmo");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} detalles`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };

  // Al abrir una conversación, una propuesta vencida no debe verse pendiente
  const prop = await toolByName("matricular")!.run({ alumno_ids: [ids.s1, ids.s2], curso_id: ids.course }, ctx);
  const propuesta = prop.proposalId!;
  const msg = appendMessage(
    conv.id,
    "assistant",
    [{ type: "proposal", proposalId: propuesta, title: "t", applyLabel: "Aplicar", columns: [], rows: [], status: "pending" }],
    ""
  );
  const bloqueDe = () => getConversation(ids.teacher, conv.id)!.messages.find((m) => m.id === msg.id)!.blocks[0];
  db.update(aiProposals).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiProposals.id, propuesta)).run();
  const antes = bloqueDe();
  check("Vencida pero sin barrer: todavía se ve pendiente", antes.type === "proposal" && antes.status === "pending", antes);
  expireProposals();
  const despues = bloqueDe();
  check("Tras expireProposals(), al leerla se ve caducada", despues.type === "proposal" && despues.status === "expired", despues);

  // Buscar en el historial: % y _ son texto, no comodines
  const conPorciento = createConversation(ids.teacher, `${P} 100% aprobado`);
  createConversation(ids.teacher, `${P} plan_a`);
  createConversation(ids.teacher, `${P} planXa`);
  const todas = listConversations(ids.teacher).length;
  const porciento = listConversations(ids.teacher, "100%");
  check("«100%» encuentra «100% aprobado»", porciento.some((c) => c.id === conPorciento.id), porciento);
  const soloSigno = listConversations(ids.teacher, "%");
  check("Buscar «%» a secas no devuelve todas", soloSigno.length < todas && soloSigno.every((c) => c.title.includes("%")), [soloSigno.length, todas]);
  const guionBajo = listConversations(ids.teacher, "plan_a");
  check("El guion bajo tampoco es comodín", guionBajo.length === 1 && guionBajo[0].title.endsWith("plan_a"), guionBajo);

  // Ritmo: 20 turnos cada 5 minutos por usuario, en memoria del proceso
  const quien = `${P}-ritmo`;
  const ahora = Date.now();
  check("Los primeros 20 turnos pasan", Array.from({ length: 20 }, () => rateLimitHit(quien, ahora)).every((frenado) => frenado === false));
  check("El 21 se frena", rateLimitHit(quien, ahora) === true);
  check("Otro usuario no paga el plato", rateLimitHit(`${quien}-otro`, ahora) === false);
  check("Pasados 5 minutos vuelve a pasar", rateLimitHit(quien, ahora + 5 * 60_000) === false);

  // Adjuntar tiene su propio cubo: subir archivos y preguntar no se estorban
  const conArchivos = `${P}-ritmo-archivos`;
  Array.from({ length: 20 }, () => rateLimitHit(conArchivos, ahora));
  check("Agotadas las preguntas, todavía puede adjuntar", rateLimitHit(conArchivos, ahora) === true && rateLimitHit(`attach:${conArchivos}`, ahora) === false);
  Array.from({ length: 19 }, () => rateLimitHit(`attach:${conArchivos}`, ahora));
  check("El cubo de adjuntos también se frena a los 20", rateLimitHit(`attach:${conArchivos}`, ahora) === true);
}

/** Grupo (o null) de la matrícula vigente de un alumno en un curso. */
function grupoDe(courseId: string, studentId: string): string | null {
  return (
    db
      .select({ cohortId: enrollments.cohortId })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
      .get()?.cohortId ?? null
  );
}

function matriculaDe(courseId: string, studentId: string) {
  return db
    .select({ status: enrollments.status, cycle: enrollments.cycle, droppedAt: enrollments.droppedAt })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
    .get();
}

async function gruposChecks() {
  console.log("\n— Grupos");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} grupos`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };
  const tool = toolByName("grupos")!;

  // Curso y alumnos propios de esta sección: así no se mueve nada de las demás
  ids.grupoCourse = createCourse({ ownerId: ids.teacher, title: `${P} Alturas` }).id;
  makeUser(ids.g1, "g1", "Gina Uno", "student", ids.teacher);
  makeUser(ids.g2, "g2", "Gael Dos", "student", ids.teacher);
  makeUser(ids.g3, "g3", "Gema Tres", "student", ids.teacher);
  enrollStudents(ids.grupoCourse, [ids.g1, ids.g2, ids.g3], ids.teacher);
  const curso = ids.grupoCourse;
  const params = (extra: Record<string, unknown>) => ({ accion: "", curso_id: curso, grupo: "", nombre_nuevo: "", alumno_ids: [], ...extra });
  const donde = (studentId: string) => grupoDe(curso, studentId);

  check("Los grupos ya no se anuncian como «aún no puedo»", !NOT_YET.join(" ").toLowerCase().includes("grupo"), NOT_YET);

  // Listar sin grupos
  const vacio = await tool.run(params({ accion: "listar" }), ctx);
  check(
    "Listar sin grupos: lo dice y no pinta tabla",
    vacio.forModel.includes("no tiene ningún grupo") && !(vacio.blocks ?? []).some((b) => b.type === "table"),
    vacio.forModel
  );

  // Crear
  const creadoA = await tool.run(params({ accion: "crear", grupo: "Turno A" }), ctx);
  const grupoA = findCohortByName(curso, "Turno A");
  check("Crear: el grupo queda en la base", grupoA !== null && grupoA.status === "open", grupoA);
  check("Crear: se hace al momento, con deshacer", !creadoA.proposalId && creadoA.undo?.params.accion === "crear", creadoA.undo);
  check("Crear: bloque de resultado con «Deshacer»", (creadoA.blocks ?? []).some((b) => b.type === "result" && b.undoable === true), creadoA.blocks);
  await tool.run(params({ accion: "crear", grupo: "Turno B" }), ctx);
  const grupoB = findCohortByName(curso, "Turno B")!;
  const repetido = await tool.run(params({ accion: "crear", grupo: "turno a" }), ctx);
  check(
    "Crear repetido (aunque cambien las mayúsculas): no duplica",
    repetido.forModel.includes("Ya existe") && cohortOptions(curso, { includeClosed: true }).length === 2,
    repetido.forModel
  );

  // Crear y deshacer: el grupo vacío se borra
  const creadoC = await tool.run(params({ accion: "crear", grupo: "Turno C" }), ctx);
  const grupoC = findCohortByName(curso, "Turno C")!;
  await tool.undo!(creadoC.undo!.params, ctx);
  check("Deshacer «crear» borra el grupo vacío", getCohort(grupoC.id) === null);

  // Listar con grupos y sus conteos
  const listado2 = await tool.run(params({ accion: "listar" }), ctx);
  const tabla = (listado2.blocks ?? []).find((b) => b.type === "table");
  check(
    "Listar: tabla con los dos grupos, sus alumnos y su estado",
    tabla?.type === "table" && tabla.rows.length === 2 && tabla.rows.every((f) => f[1] === "0" && f[2] === "abierto"),
    tabla
  );

  // Mover a uno solo: al momento, con deshacer
  const uno = await tool.run(params({ accion: "mover", grupo: "Turno A", alumno_ids: [ids.g1] }), ctx);
  check("Mover a uno: al momento y sin propuesta", !uno.proposalId && donde(ids.g1) === grupoA!.id, uno.forModel);
  check(
    "Auditoría del movimiento",
    db.select().from(auditLog).where(and(eq(auditLog.action, "assistant_grupos"), eq(auditLog.entityId, grupoA!.id))).get() !== undefined
  );
  await tool.undo!(uno.undo!.params, ctx);
  check("Deshacer lo devuelve a «sin grupo»", donde(ids.g1) === null);

  // Deshacer cuando SÍ tenía grupo: vuelve al de antes, no a ninguno
  await tool.run(params({ accion: "mover", grupo: "Turno A", alumno_ids: [ids.g1] }), ctx);
  const aB = await tool.run(params({ accion: "mover", grupo: "Turno B", alumno_ids: [ids.g1] }), ctx);
  check("Mover de un grupo a otro", donde(ids.g1) === grupoB.id, aB.forModel);
  await tool.undo!(aB.undo!.params, ctx);
  check("Deshacer lo devuelve al grupo en el que estaba", donde(ids.g1) === grupoA!.id);

  // Deshacer «crear» con gente dentro: no se borra
  const conGente = await errorOf(async () => tool.undo!(creadoA.undo!.params, ctx));
  check("Deshacer «crear» con alumnos dentro: error claro y el grupo sigue", conGente.startsWith("No se pudo deshacer") && getCohort(grupoA!.id) !== null, conGente);

  // Mover a varios: propuesta con sus avisos
  const varios = await tool.run(params({ accion: "mover", grupo: "Turno A", alumno_ids: [ids.g2, ids.g1, ids.s1] }), ctx);
  const propuesta = getProposal(varios.proposalId!)!;
  const fila = (id: string) => propuesta.rows.find((r) => r.id === id);
  check("Varios: propuesta de tres filas", propuesta.rows.length === 3, propuesta.rows);
  check("Gael (matriculado y sin grupo): se puede", fila(ids.g2)?.blocked !== true && fila(ids.g2)?.cells.grupo_actual === "Sin grupo", fila(ids.g2));
  check("Gina (ya en Turno A): bloqueada «Ya está en ese grupo»", fila(ids.g1)?.blocked === true && fila(ids.g1)?.warning === "Ya está en ese grupo", fila(ids.g1));
  check(
    "Ana (de otro curso): bloqueada «No está matriculado en este curso»",
    fila(ids.s1)?.blocked === true && fila(ids.s1)?.warning === "No está matriculado en este curso",
    fila(ids.s1)
  );
  check("Columnas Alumno, Correo y Grupo actual, no editables", propuesta.draft.columns.map((c) => c.key).join(",") === "alumno,correo,grupo_actual" && propuesta.draft.columns.every((c) => c.editable === false), propuesta.draft.columns);
  check("La IA no recibe correos", !varios.forModel.includes("@test.local"), varios.forModel);
  const aplicada = await applyProposal(varios.proposalId!, propuesta.rows, ctx, "");
  check(
    "Aplicar mueve solo al válido",
    "text" in aplicada && aplicada.text.startsWith("1 alumno(s)") && donde(ids.g2) === grupoA!.id && grupoDe(ids.course, ids.s1) === null,
    aplicada
  );

  // Alumno de otro maestro
  const ajeno = await tool.run(params({ accion: "mover", grupo: "Turno B", alumno_ids: [ids.g3, ids.s3] }), ctx);
  const pAjeno = getProposal(ajeno.proposalId!)!;
  check(
    "Carla (de otro maestro): bloqueada «No es uno de tus alumnos»",
    pAjeno.rows.find((r) => r.id === ids.s3)?.warning === "No es uno de tus alumnos",
    pAjeno.rows
  );
  cancelProposal(ajeno.proposalId!, ids.teacher);

  // Renombrar
  const ren = await tool.run(params({ accion: "renombrar", grupo: "Turno B", nombre_nuevo: "Turno B2" }), ctx);
  check("Renombrar cambia el nombre", getCohort(grupoB.id)?.name === "Turno B2" && ren.undo?.params.nombre_anterior === "Turno B", ren.undo);
  await tool.undo!(ren.undo!.params, ctx);
  check("Deshacer devuelve el nombre anterior", getCohort(grupoB.id)?.name === "Turno B");
  const choque = await tool.run(params({ accion: "renombrar", grupo: "Turno B", nombre_nuevo: "Turno A" }), ctx);
  check("Renombrar con un nombre ya usado: lo dice y no cambia", choque.forModel.includes("Ya existe") && getCohort(grupoB.id)?.name === "Turno B", choque.forModel);

  // Cerrar, mover a un grupo cerrado y reabrir
  const cerrado = await tool.run(params({ accion: "cerrar", grupo: "Turno B" }), ctx);
  check("Cerrar deja el grupo cerrado, con deshacer", getCohort(grupoB.id)?.status === "closed" && cerrado.undo?.params.estado_anterior === "open", cerrado.undo);
  const yaCerrado = await tool.run(params({ accion: "cerrar", grupo: "Turno B" }), ctx);
  check("Cerrar uno ya cerrado: no cambia nada", yaCerrado.forModel.includes("ya estaba cerrado") && !yaCerrado.undo, yaCerrado.forModel);
  const aCerrado = await tool.run(params({ accion: "mover", grupo: "Turno B", alumno_ids: [ids.g3] }), ctx);
  check(
    "Mover a un grupo cerrado: lo dice, ofrece reabrirlo y no mueve",
    !aCerrado.proposalId && aCerrado.forModel.includes("cerrado") && aCerrado.forModel.includes("reabr") && donde(ids.g3) === null,
    aCerrado.forModel
  );
  const reabierto = await tool.run(params({ accion: "reabrir", grupo: "Turno B" }), ctx);
  check("Reabrir deja el grupo abierto", getCohort(grupoB.id)?.status === "open", reabierto.forModel);
  await tool.undo!(reabierto.undo!.params, ctx);
  check("Deshacer «reabrir» lo vuelve a cerrar", getCohort(grupoB.id)?.status === "closed");
  await tool.undo!(cerrado.undo!.params, ctx);
  check("Deshacer «cerrar» lo reabre", getCohort(grupoB.id)?.status === "open");

  // Curso ajeno: ninguna acción pasa
  const otro = { ...teacherUser, id: ids.admin };
  const ctxAjeno = { ...ctxFor(otro, ownScope(otro)), conversationId: conv.id, messageId: anchor.id };
  const acciones = ["listar", "crear", "mover", "renombrar", "cerrar", "reabrir", "borrar"];
  const negadas = [];
  for (const accion of acciones) {
    const r = await tool.run({ accion, curso_id: curso, grupo: "Turno A", nombre_nuevo: "Turno Z", alumno_ids: [ids.g1] }, ctxAjeno);
    negadas.push(r.forModel);
  }
  check(
    "Curso ajeno: las siete acciones se niegan y no tocan nada",
    negadas.every((t) => t.includes("no te pertenece")) && cohortOptions(curso, { includeClosed: true }).length === 2 && getCohort(grupoA!.id)?.name === "Turno A",
    negadas
  );

  // Mover a un grupo que todavía no existe: se crea al vuelo (como en la pantalla)
  const alVuelo = await tool.run(params({ accion: "mover", grupo: "Matutino", alumno_ids: [ids.g3] }), ctx);
  const matutino = findCohortByName(curso, "Matutino");
  check(
    "Mover a un grupo que no existe: lo crea al vuelo y lo dice con todas las letras",
    matutino !== null && donde(ids.g3) === matutino.id && alVuelo.forModel.includes("Creé el grupo «Matutino»") && alVuelo.forModel.includes("1 alumno"),
    alVuelo.forModel
  );
  check("Crear al vuelo sigue siendo instantáneo, con deshacer", !alVuelo.proposalId && (alVuelo.blocks ?? []).some((b) => b.type === "result" && b.undoable === true), alVuelo.blocks);
  await tool.undo!(alVuelo.undo!.params, ctx);
  check(
    "Deshacer devuelve al alumno y borra el grupo que nació con el movimiento",
    donde(ids.g3) === null && findCohortByName(curso, "Matutino") === null
  );

  // Varios a un grupo nuevo: el grupo nace al aplicar, no al proponer
  const variosNuevo = await tool.run(params({ accion: "mover", grupo: "Vespertino", alumno_ids: [ids.g3, ids.g1] }), ctx);
  const pNuevo = getProposal(variosNuevo.proposalId!)!;
  check(
    "Proponer no crea el grupo todavía, y se avisa",
    findCohortByName(curso, "Vespertino") === null && variosNuevo.forModel.includes("lo crearé al aplicar"),
    variosNuevo.forModel
  );
  check("Con un grupo que no existe nadie sale «ya está en ese grupo»", pNuevo.rows.every((r) => r.warning !== "Ya está en ese grupo"), pNuevo.rows);
  const aplNuevo = await applyProposal(variosNuevo.proposalId!, pNuevo.rows, ctx, "");
  const vespertino = findCohortByName(curso, "Vespertino");
  check(
    "Aplicar crea el grupo, mueve a los dos y lo dice",
    "text" in aplNuevo && aplNuevo.text.startsWith("Creé el grupo «Vespertino» y moví a 2 alumno(s)") && vespertino !== null && donde(ids.g3) === vespertino.id && donde(ids.g1) === vespertino.id,
    aplNuevo
  );

  // Cancelar una propuesta de grupo al vuelo no deja grupos vacíos por ahí
  const cancelada = await tool.run(params({ accion: "mover", grupo: "Nocturno", alumno_ids: [ids.g1, ids.g2] }), ctx);
  cancelProposal(cancelada.proposalId!, ids.teacher);
  check("Cancelar la propuesta no deja el grupo creado", findCohortByName(curso, "Nocturno") === null);

  // Borrar: es irreversible, así que va por revisión con ELIMINAR
  const borrado = await tool.run(params({ accion: "borrar", grupo: "Vespertino" }), ctx);
  const pBorrar = getProposal(borrado.proposalId!)!;
  check("Borrar va por propuesta y pide escribir ELIMINAR", !!borrado.proposalId && pBorrar.draft.confirmWord === "ELIMINAR", pBorrar.draft);
  check(
    "La tabla dice qué grupo se borra y a cuántos deja sin grupo",
    pBorrar.rows.length === 1 && pBorrar.rows[0].cells.grupo === "Vespertino" && pBorrar.rows[0].cells.alumnos === "2" && pBorrar.draft.columns.map((c) => c.key).join(",") === "grupo,alumnos" && pBorrar.draft.columns.every((c) => c.editable === false),
    pBorrar.rows
  );
  const sinPalabra = await applyProposal(borrado.proposalId!, pBorrar.rows, ctx, "");
  check("Sin escribir ELIMINAR no se borra nada", "error" in sinPalabra && getCohort(vespertino!.id) !== null, sinPalabra);
  const borrada = await applyProposal(borrado.proposalId!, pBorrar.rows, ctx, " eliminar ");
  check(
    "Con ELIMINAR se borra; los alumnos se quedan sin grupo pero siguen matriculados",
    "text" in borrada && borrada.text.includes("2 alumno(s) se quedaron sin grupo") && getCohort(vespertino!.id) === null && donde(ids.g1) === null && donde(ids.g3) === null && matriculaDe(curso, ids.g1)?.status === "active",
    borrada
  );
  check(
    "Auditoría del borrado",
    db.select().from(auditLog).where(and(eq(auditLog.action, "assistant_grupos"), eq(auditLog.entityId, vespertino!.id))).get() !== undefined
  );
  const noExiste = await tool.run(params({ accion: "borrar", grupo: "Vespertino" }), ctx);
  check("Borrar un grupo que ya no existe: lo dice y no propone", !noExiste.proposalId && noExiste.forModel.includes("No hay ningún grupo"), noExiste.forModel);
}

async function restaurarChecks() {
  console.log("\n— Restaurar bajas");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} restaurar`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };
  const tool = toolByName("restaurar")!;
  const curso = ids.grupoCourse;

  const sinBajas = await tool.run({ curso_id: curso, alumno_ids: [], grupo: "" }, ctx);
  check("Curso sin bajas: lo dice y no propone", !sinBajas.proposalId && sinBajas.forModel.includes("no tiene bajas"), sinBajas.forModel);

  unenrollStudent(curso, ids.g1, ids.teacher);
  unenrollStudent(curso, ids.g2, ids.teacher);
  const result = await tool.run({ curso_id: curso, alumno_ids: [], grupo: "" }, ctx);
  const propuesta = getProposal(result.proposalId!)!;
  check("Dos bajas, dos filas", propuesta.rows.length === 2, propuesta.rows);
  check("Cada fila trae su fecha de baja y lo que conserva", propuesta.rows.every((r) => r.cells.baja !== "" && r.cells.baja !== "sin fecha" && r.cells.avance === "En curso"), propuesta.rows);
  check(
    "Columnas Alumno, Correo, Dado de baja, Avance y Grupo, no editables",
    propuesta.draft.columns.map((c) => c.key).join(",") === "alumno,correo,baja,avance,grupo" && propuesta.draft.columns.every((c) => c.editable === false),
    propuesta.draft.columns
  );
  check(
    "Sin grupo de destino, la columna muestra el que cada uno tenía",
    propuesta.rows.find((r) => r.cells.alumno.includes("Gael"))?.cells.grupo === "Turno A" &&
      propuesta.rows.find((r) => r.cells.alumno.includes("Gina"))?.cells.grupo === "Sin grupo",
    propuesta.rows.map((r) => [r.cells.alumno, r.cells.grupo])
  );
  check("Ninguna fila bloqueada: son sus alumnos", propuesta.rows.every((r) => !r.blocked), propuesta.rows);
  check("La IA no recibe correos", !result.forModel.includes("@test.local"), result.forModel);

  const aplicada = await applyProposal(result.proposalId!, propuesta.rows, ctx, "");
  const g1 = matriculaDe(curso, ids.g1);
  const g2 = matriculaDe(curso, ids.g2);
  check(
    "Vuelven al curso activos, con su ciclo y sin fecha de baja",
    "text" in aplicada && aplicada.text.startsWith("2 alumno(s)") && g1?.status === "active" && g1?.cycle === 1 && g1?.droppedAt === null && g2?.status === "active",
    [aplicada, g1, g2]
  );
  check("El texto explica que vuelven con su avance", "text" in aplicada && aplicada.text.includes("avance"), aplicada);
  check("Auditoría de la restauración", db.select().from(auditLog).where(eq(auditLog.action, "assistant_restaurar")).get() !== undefined);

  check("Sin grupo de destino, Gael conserva el suyo", grupoDe(curso, ids.g2) === findCohortByName(curso, "Turno A")?.id);

  // Por alumno_ids: solo esa baja
  unenrollStudent(curso, ids.g1, ids.teacher);
  unenrollStudent(curso, ids.g3, ids.teacher);
  const soloUno = await tool.run({ curso_id: curso, alumno_ids: [ids.g3], grupo: "" }, ctx);
  const pUno = getProposal(soloUno.proposalId!)!;
  check("Con alumno_ids solo viene ese alumno", pUno.rows.length === 1 && pUno.rows[0].cells.alumno.includes("Gema"), pUno.rows);
  await applyProposal(soloUno.proposalId!, pUno.rows, ctx, "");
  check(
    "Se restaura solo el pedido; el otro sigue en la papelera",
    matriculaDe(curso, ids.g3)?.status === "active" && matriculaDe(curso, ids.g1)?.status === "dropped"
  );

  const fuera = await tool.run({ curso_id: curso, alumno_ids: [ids.g2], grupo: "" }, ctx);
  check("Un alumno que no está en la papelera: lo dice y no propone", !fuera.proposalId && fuera.forModel.includes("Ninguno"), fuera.forModel);

  // Con grupo de destino: se crea al aplicar y ahí quedan
  unenrollStudent(curso, ids.g2, ids.teacher);
  const conGrupo = await tool.run({ curso_id: curso, alumno_ids: [ids.g2], grupo: "Regreso" }, ctx);
  const pGrupo = getProposal(conGrupo.proposalId!)!;
  check("La columna del grupo muestra el destino pedido", pGrupo.rows.length === 1 && pGrupo.rows[0].cells.grupo === "Regreso", pGrupo.rows);
  check(
    "Proponer todavía no crea el grupo, y se avisa",
    findCohortByName(curso, "Regreso") === null && conGrupo.forModel.includes("lo crearé al aplicar"),
    conGrupo.forModel
  );
  const aplGrupo = await applyProposal(conGrupo.proposalId!, pGrupo.rows, ctx, "");
  const regreso = findCohortByName(curso, "Regreso");
  check(
    "Al aplicar se crea el grupo y los restaurados quedan ahí",
    "text" in aplGrupo && aplGrupo.text.includes("Creé el grupo «Regreso»") && regreso !== null && grupoDe(curso, ids.g2) === regreso.id && matriculaDe(curso, ids.g2)?.status === "active",
    [aplGrupo, regreso]
  );

  // Un grupo que ya existe no se duplica: los restaurados se suman a él
  unenrollStudent(curso, ids.g3, ids.teacher);
  const mismoGrupo = await tool.run({ curso_id: curso, alumno_ids: [ids.g3], grupo: "regreso" }, ctx);
  const pMismo = getProposal(mismoGrupo.proposalId!)!;
  const aplMismo = await applyProposal(mismoGrupo.proposalId!, pMismo.rows, ctx, "");
  check(
    "Con un grupo que ya existe: ni lo duplica ni dice que lo creó",
    "text" in aplMismo && aplMismo.text.includes("Quedaron en el grupo «Regreso»") && cohortOptions(curso, { includeClosed: true }).filter((c) => c.name === "Regreso").length === 1 && grupoDe(curso, ids.g3) === regreso!.id,
    aplMismo
  );

  const nombreMalo = await tool.run({ curso_id: curso, alumno_ids: [], grupo: "x" }, ctx);
  check("Nombre de grupo inválido: lo dice y no propone", !nombreMalo.proposalId && nombreMalo.forModel.includes("entre 2 y 80"), nombreMalo.forModel);

  // Curso ajeno
  const otro = { ...teacherUser, id: ids.admin };
  const ajeno = await tool.run({ curso_id: curso, alumno_ids: [], grupo: "" }, { ...ctxFor(otro, ownScope(otro)), conversationId: conv.id, messageId: anchor.id });
  check("Curso ajeno: negado", !ajeno.proposalId && ajeno.forModel.includes("no te pertenece"), ajeno.forModel);
}

/** Los avisos del maestro que le llegaron a esos alumnos, con su contenido. */
type Aviso = { userId: string; title: string; body: string; from: string; courseId: string | null };
function avisosDe(studentIds: string[]): Aviso[] {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.type, "teacher_notice"), inArray(notifications.userId, studentIds)))
    .all()
    .map((n) => {
      const p = (typeof n.payload === "object" && n.payload !== null ? n.payload : {}) as Record<string, unknown>;
      return {
        userId: n.userId,
        title: String(p.title ?? ""),
        body: String(p.body ?? ""),
        from: String(p.from ?? ""),
        courseId: typeof p.courseId === "string" ? p.courseId : null,
      };
    });
}

async function avisarChecks() {
  console.log("\n— Avisar a los alumnos");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} avisar`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };
  const tool = toolByName("avisar")!;
  const params = (extra: Record<string, unknown>) => ({
    titulo: "",
    mensaje: "",
    curso_id: "",
    a_quien: "curso",
    alumno_ids: [] as string[],
    grupo: "",
    ...extra,
  });

  // Curso y alumnos propios de esta sección: tres matriculados que no tocan nada más
  ids.avisoCourse = createCourse({ ownerId: ids.teacher, title: `${P} Avisos` }).id;
  makeUser(ids.a1, "a1", "Aída Uno", "student", ids.teacher);
  makeUser(ids.a2, "a2", "Abel Dos", "student", ids.teacher);
  makeUser(ids.a3, "a3", "Alma Tres", "student", ids.teacher);
  enrollStudents(ids.avisoCourse, [ids.a1, ids.a2, ids.a3], ids.teacher);
  const curso = ids.avisoCourse;

  check("Los recordatorios ya no se anuncian como «aún no puedo»", !NOT_YET.join(" ").toLowerCase().includes("recordatorio"), NOT_YET);

  // Falta lo básico: no se propone nada
  const sinTitulo = await tool.run(params({ curso_id: curso, titulo: "   ", mensaje: "Hola" }), ctx);
  check("Título vacío: lo dice y no propone", !sinTitulo.proposalId && sinTitulo.forModel.includes("Falta el título"), sinTitulo.forModel);
  const sinMensaje = await tool.run(params({ curso_id: curso, titulo: "Aviso", mensaje: " \n  \n " }), ctx);
  check("Mensaje vacío: lo dice y no propone", !sinMensaje.proposalId && sinMensaje.forModel.includes("Falta el mensaje"), sinMensaje.forModel);
  const sinCurso = await tool.run(params({ titulo: "Aviso", mensaje: "Hola a todos" }), ctx);
  check("Sin curso (y sin ids): lo pide y no propone", !sinCurso.proposalId && sinCurso.forModel.includes("Falta curso_id"), sinCurso.forModel);

  // A todo el curso
  const todos = await tool.run(params({ curso_id: curso, titulo: "  Examen   el viernes  ", mensaje: "Traigan su credencial." }), ctx);
  const pTodos = getProposal(todos.proposalId!)!;
  check("Curso: una fila por matriculado, con su motivo", pTodos.rows.length === 3 && pTodos.rows.every((r) => r.cells.motivo === "matriculado" && !r.blocked), pTodos.rows);
  check(
    "Columnas Alumno, Correo y Motivo, no editables",
    pTodos.draft.columns.map((c) => c.key).join(",") === "alumno,correo,motivo" && pTodos.draft.columns.every((c) => c.editable === false),
    pTodos.draft.columns
  );
  check("La cabecera de la revisión dice lo que se va a hacer", pTodos.draft.title === "Mandar un aviso a 3 alumnos", pTodos.draft.title);
  check(
    "Antes de la tabla va la vista previa de lo que verán",
    (todos.blocks ?? []).some((b) => b.type === "text" && b.text === "Así lo verán: **Examen el viernes** — Traigan su credencial."),
    todos.blocks
  );
  check("Nunca es instantáneo: siempre propuesta", !!todos.proposalId && !todos.undo, todos.forModel);
  check("La IA no recibe correos", !todos.forModel.includes("@test.local"), todos.forModel);

  const antes = unreadCount(ids.a1);
  const aplicada = await applyProposal(todos.proposalId!, pTodos.rows, ctx, "");
  const llegadas = avisosDe([ids.a1, ids.a2, ids.a3]);
  check(
    "Al aplicar le llega a los tres, con su título, su cuerpo, de quién y el curso",
    "text" in aplicada &&
      aplicada.text.startsWith("El aviso le llegó a 3 alumno(s)") &&
      llegadas.length === 3 &&
      llegadas.every((n) => n.title === "Examen el viernes" && n.body === "Traigan su credencial." && n.from === `${P} Maestro` && n.courseId === curso),
    [aplicada, llegadas]
  );
  check("La campana del alumno sube", unreadCount(ids.a1) === antes + 1);
  check(
    "El resultado deja el enlace a los alumnos del curso",
    "text" in aplicada && (aplicada.blocks ?? []).some((b) => b.type === "links" && b.links.some((l) => l.href.includes(curso))),
    "text" in aplicada ? aplicada.blocks : aplicada
  );
  check(
    "Auditoría del aviso, con el curso y el conteo",
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "assistant_avisar"), eq(auditLog.entity, "courses"), eq(auditLog.entityId, curso)))
      .all()
      .some((r) => (r.detail as { alumnos?: number } | null)?.alumnos === 3)
  );

  // A un grupo, creado con la herramienta de grupos
  const gTool = toolByName("grupos")!;
  const gParams = (extra: Record<string, unknown>) => ({ accion: "", curso_id: curso, grupo: "", nombre_nuevo: "", alumno_ids: [] as string[], ...extra });
  await gTool.run(gParams({ accion: "mover", grupo: "Matutino", alumno_ids: [ids.a1] }), ctx);
  await gTool.run(gParams({ accion: "mover", grupo: "Matutino", alumno_ids: [ids.a2] }), ctx);
  const aGrupo = await tool.run(params({ curso_id: curso, a_quien: "grupo", grupo: "Matutino", titulo: "Solo el matutino", mensaje: "Nos vemos a las 7." }), ctx);
  const pGrupo = getProposal(aGrupo.proposalId!)!;
  check(
    "Grupo: solo los de ese grupo, con el motivo",
    pGrupo.rows.length === 2 && pGrupo.rows.every((r) => r.cells.motivo === "grupo «Matutino»") && !pGrupo.rows.some((r) => r.cells.alumno.includes("Alma")),
    pGrupo.rows
  );
  cancelProposal(aGrupo.proposalId!, ids.teacher);
  const grupoRaro = await tool.run(params({ curso_id: curso, a_quien: "grupo", grupo: "Nocturno", titulo: "Aviso", mensaje: "Hola" }), ctx);
  check("Grupo que no existe: lo dice y no propone", !grupoRaro.proposalId && grupoRaro.forModel.includes("No hay ningún grupo"), grupoRaro.forModel);
  await gTool.run(gParams({ accion: "crear", grupo: "Vespertino" }), ctx);
  const grupoVacio = await tool.run(params({ curso_id: curso, a_quien: "grupo", grupo: "Vespertino", titulo: "Aviso", mensaje: "Hola" }), ctx);
  check("Grupo sin nadie: lo dice y no propone", !grupoVacio.proposalId && grupoVacio.forModel.includes("No hay a quién"), grupoVacio.forModel);

  // Sin entrar: exactamente lo que devuelve «pendientes»
  const sinEntrar = await tool.run(params({ curso_id: curso, a_quien: "sin_entrar", titulo: "¿Todo bien?", mensaje: "Hace días que no te vemos." }), ctx);
  const pSinEntrar = getProposal(sinEntrar.proposalId!)!;
  const esperados = pendientesQuery(ownScope(user), "sin_entrar", curso).allRows.map((f) => f[0]).sort();
  check(
    "sin_entrar: los mismos que lista pendientes",
    JSON.stringify(pSinEntrar.rows.map((r) => r.cells.alumno).sort()) === JSON.stringify(esperados),
    [pSinEntrar.rows.map((r) => r.cells.alumno), esperados]
  );
  check("…y el motivo lo explica", pSinEntrar.rows.every((r) => r.cells.motivo.includes("entrado")), pSinEntrar.rows);
  cancelProposal(sinEntrar.proposalId!, ids.teacher);

  // Sin entregar: una tarea que solo entregó Alma
  const tareaId = nanoid();
  db.insert(courseItems).values({ id: tareaId, courseId: curso, position: 0, kind: "assignment", title: `${P} Tarea 2` }).run();
  db.insert(itemAssignments).values({ itemId: tareaId }).run();
  const matriculaA3 = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, curso), eq(enrollments.studentId, ids.a3)))
    .get()!;
  db.insert(assignmentSubmissions)
    .values({ id: nanoid(), itemId: tareaId, enrollmentId: matriculaA3.id, studentId: ids.a3, submittedAt: new Date() })
    .run();
  const sinEntregar = await tool.run(params({ curso_id: curso, a_quien: "sin_entregar", titulo: "Falta tu tarea", mensaje: "Entrégala esta semana." }), ctx);
  const pSinEntregar = getProposal(sinEntregar.proposalId!)!;
  check(
    "sin_entregar: solo quien debe, con la tarea en el motivo",
    pSinEntregar.rows.length === 2 && pSinEntregar.rows.every((r) => r.cells.motivo === `no entregó ${P} Tarea 2`) && !pSinEntregar.rows.some((r) => r.cells.alumno.includes("Alma")),
    pSinEntregar.rows
  );
  cancelProposal(sinEntregar.proposalId!, ids.teacher);

  // Un alumno de otro maestro: bloqueado, y ni forzando la fila le llega
  const ajeno = await tool.run(params({ curso_id: curso, a_quien: "ids", alumno_ids: [ids.a1, ids.s3], titulo: "Aviso suelto", mensaje: "Para los dos." }), ctx);
  const pAjeno = getProposal(ajeno.proposalId!)!;
  check(
    "Carla (de otro maestro): bloqueada «No es uno de tus alumnos»",
    pAjeno.rows.find((r) => r.id === ids.s3)?.blocked === true && pAjeno.rows.find((r) => r.id === ids.s3)?.warning === "No es uno de tus alumnos",
    pAjeno.rows
  );
  const forzado = await applyProposal(
    ajeno.proposalId!,
    pAjeno.rows.map((r) => ({ ...r, blocked: false, warning: undefined })),
    ctx,
    ""
  );
  check(
    "Aunque se mande «desbloqueada», al ajeno no le llega nada",
    "text" in forzado && forzado.text.startsWith("El aviso le llegó a 1 alumno(s)") && avisosDe([ids.s3]).length === 0,
    [forzado, avisosDe([ids.s3])]
  );

  // Se sanea lo que escribe la IA: saltos de sobra fuera y tope duro de caracteres
  const raro = await tool.run(params({ curso_id: curso, a_quien: "ids", alumno_ids: [ids.a2], titulo: "Junta", mensaje: "Uno.\n\n\n\nDos.   Tres.  " }), ctx);
  const pRaro = getProposal(raro.proposalId!)!;
  check("Los saltos repetidos y los espacios de sobra se van", pRaro.payload.mensaje === "Uno.\n\nDos. Tres.", pRaro.payload.mensaje);
  cancelProposal(raro.proposalId!, ids.teacher);

  const largo = await tool.run(
    params({
      curso_id: curso,
      a_quien: "ids",
      alumno_ids: [ids.a3],
      titulo: `Recordatorio ${"muy ".repeat(40)}largo`,
      mensaje: `Aviso larguísimo. ${"Traigan todo. ".repeat(80)}`,
    }),
    ctx
  );
  const pLargo = getProposal(largo.proposalId!)!;
  check(
    "Título y mensaje se recortan al proponer",
    String(pLargo.payload.titulo).length <= MAX_TITULO &&
      String(pLargo.payload.titulo).endsWith("…") &&
      String(pLargo.payload.mensaje).length <= MAX_MENSAJE &&
      String(pLargo.payload.mensaje).endsWith("…"),
    [String(pLargo.payload.titulo).length, String(pLargo.payload.mensaje).length]
  );
  await applyProposal(largo.proposalId!, pLargo.rows, ctx, "");
  const guardado = avisosDe([ids.a3]).find((n) => n.title.startsWith("Recordatorio"));
  check(
    "…y lo que se guarda en la notificación ya viene recortado",
    guardado !== undefined && guardado.title.length <= MAX_TITULO && guardado.body.length <= MAX_MENSAJE && guardado.body.endsWith("…"),
    guardado
  );

  // Tope de destinatarios
  const muchos = Array.from({ length: MAX_DESTINATARIOS + 1 }, () => nanoid());
  const tope = await tool.run(params({ curso_id: curso, a_quien: "ids", alumno_ids: muchos, titulo: "A todos", mensaje: "Hola." }), ctx);
  check(
    "Más de 500 destinatarios: no propone y lo dice",
    !tope.proposalId && tope.forModel.includes(String(MAX_DESTINATARIOS + 1)) && tope.forModel.includes(String(MAX_DESTINATARIOS)),
    tope.forModel
  );

  // Quien ya terminó el curso también recibe el aviso, pero el motivo lo dice
  db.update(enrollments)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(enrollments.courseId, curso), eq(enrollments.studentId, ids.a3)))
    .run();
  const conCompletado = await tool.run(params({ curso_id: curso, titulo: "Cierre", mensaje: "Gracias a todos." }), ctx);
  const pCompletado = getProposal(conCompletado.proposalId!)!;
  check(
    "El motivo distingue al que ya completó el curso (se puede quitar de la tabla)",
    pCompletado.rows.length === 3 &&
      pCompletado.rows.find((r) => r.id === ids.a3)?.cells.motivo === "ya completó el curso" &&
      pCompletado.rows.filter((r) => r.id !== ids.a3).every((r) => r.cells.motivo === "matriculado"),
    pCompletado.rows
  );
  cancelProposal(conCompletado.proposalId!, ids.teacher);

  // Curso ajeno
  const otro = { ...teacherUser, id: ids.admin };
  const cursoAjeno = await tool.run(params({ curso_id: curso, titulo: "Aviso", mensaje: "Hola" }), {
    ...ctxFor(otro, ownScope(otro)),
    conversationId: conv.id,
    messageId: anchor.id,
  });
  check("Curso ajeno: negado y sin propuesta", !cursoAjeno.proposalId && cursoAjeno.forModel.includes("no te pertenece"), cursoAjeno.forModel);
}

async function reactivarAlumnosChecks() {
  console.log("\n— Reactivar alumnos");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} reactivar`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };
  const activo = (id: string) => db.select({ active: users.active }).from(users).where(eq(users.id, id)).get()?.active;
  const params = (alumnoIds: string[]) => ({ origen: "ids", alumno_ids: alumnoIds, texto: "", hoja: "", filtro_color: "" });

  // Un solo alumno: se hace al momento y se puede deshacer
  setStudentActive(ids.s4, false);
  const una = await toolByName("reactivar_alumnos")!.run(params([ids.s4]), ctx);
  check("Un alumno: se aplica al momento, sin propuesta", !una.proposalId && activo(ids.s4) === true, una.forModel);
  check("Un alumno: trae deshacer", una.undo?.tool === "reactivar_alumnos" && una.undo?.params.alumno_id === ids.s4, una.undo);
  check("Un alumno: bloque de resultado con «Deshacer»", (una.blocks ?? []).some((b) => b.type === "result" && b.undoable === true), una.blocks);
  check(
    "Auditoría de la reactivación",
    db.select().from(auditLog).where(and(eq(auditLog.action, "assistant_reactivar_alumnos"), eq(auditLog.entityId, ids.s4))).get() !== undefined
  );

  await toolByName("reactivar_alumnos")!.undo!(una.undo!.params, ctx);
  check("Deshacer vuelve a deshabilitarla", activo(ids.s4) === false);
  check(
    "Deshacer deja auditoría",
    db.select().from(auditLog).where(and(eq(auditLog.action, "assistant_reactivar_alumnos_undo"), eq(auditLog.entityId, ids.s4))).get() !== undefined
  );
  const dosVeces = await errorOf(async () => toolByName("reactivar_alumnos")!.undo!(una.undo!.params, ctx));
  check("Deshacer dos veces: error claro", dosVeces.startsWith("No se pudo deshacer"), dosVeces);

  // Varios: tabla para revisar, con sus avisos
  setStudentActive(ids.s3, false);
  const varios = await toolByName("reactivar_alumnos")!.run(params([ids.s4, ids.s1, ids.s3]), ctx);
  const propuesta = getProposal(varios.proposalId!)!;
  const fila = (id: string) => propuesta.rows.find((r) => r.id === id);
  check("Varios: propuesta con tres filas", propuesta.rows.length === 3, propuesta.rows);
  check("Dora (deshabilitada): se puede", fila(ids.s4)?.blocked !== true, fila(ids.s4));
  check("Ana (activa): bloqueada «Ya estaba activo»", fila(ids.s1)?.blocked === true && fila(ids.s1)?.warning === "Ya estaba activo", fila(ids.s1));
  check(
    "Carla (de otro maestro): bloqueada «No es uno de tus alumnos»",
    fila(ids.s3)?.blocked === true && fila(ids.s3)?.warning === "No es uno de tus alumnos",
    fila(ids.s3)
  );
  check("Columnas nombre y correo no editables", propuesta.draft.columns.every((c) => c.editable === false));
  check("La IA no recibe correos", !varios.forModel.includes("@test.local"), varios.forModel);

  const aplicada = await applyProposal(varios.proposalId!, propuesta.rows, ctx, "");
  check(
    "Aplicar reactiva solo a Dora, y Carla sigue deshabilitada",
    "text" in aplicada && aplicada.text.startsWith("1 alumno(s) reactivado(s)") && activo(ids.s4) === true && activo(ids.s3) === false,
    aplicada
  );

  // Lista pegada: se resuelve por correo, como en baja_alumnos
  setStudentActive(ids.s4, false);
  const porTexto = await toolByName("reactivar_alumnos")!.run(
    {
      origen: "texto",
      alumno_ids: [],
      texto: `Nombre,Correo\n${P} Dora Sola,${P}-dora@test.local\n${P} Ana López,${P}-ana@test.local`,
      hoja: "",
      filtro_color: "",
    },
    ctx
  );
  const pTexto = getProposal(porTexto.proposalId!)!;
  check("Por texto: Dora se puede y Ana ya estaba activa", pTexto.rows.length === 2 && pTexto.rows.some((r) => r.id === ids.s4 && !r.blocked), pTexto.rows);
  cancelProposal(porTexto.proposalId!, ids.teacher);

  // Se devuelve todo como estaba para las demás secciones
  setStudentActive(ids.s4, true);
  setStudentActive(ids.s3, true);
  check("Los alumnos quedan como estaban (activos)", activo(ids.s4) === true && activo(ids.s3) === true && activo(ids.s1) === true);
}

async function bajaAlumnosChecks() {
  console.log("\n— Baja de alumnos");
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} bajas`);
  const anchor = appendMessage(conv.id, "assistant", [], "");
  const ctx = { ...ctxFor(user, ownScope(user)), conversationId: conv.id, messageId: anchor.id };

  const falta = await toolByName("baja_alumnos")!.run(
    { modo: "", origen: "texto", texto: `Nombre,Correo\n${P} Ana López,${P}-ana@test.local`, hoja: "", filtro_color: "", alumno_ids: [] },
    ctx
  );
  check("Sin modo: pregunta y no propone", !falta.proposalId && falta.forModel.toLowerCase().includes("deshabilitar"), falta.forModel);

  const result = await toolByName("baja_alumnos")!.run(
    {
      modo: "deshabilitar",
      origen: "texto",
      // En columnas se lee sin gastar IA; una sola columna pediría la API
      texto: `Nombre,Correo\n${P} Ana López,${P}-ana@test.local\n${P} Carla Ajena,${P}-carla@test.local\nSin Cuenta,desconocido@test.local`,
      hoja: "",
      filtro_color: "",
      alumno_ids: [],
    },
    ctx
  );
  const proposal = getProposal(result.proposalId!)!;
  check("Tres filas", proposal.rows.length === 3, proposal.rows);
  check("Ana (alumna del maestro): se puede", !proposal.rows[0].blocked, proposal.rows[0]);
  check("Carla (de otro maestro): bloqueada", proposal.rows[1].blocked === true, proposal.rows[1]);
  check("Correo desconocido: bloqueado", proposal.rows[2].blocked === true, proposal.rows[2]);
  check("Columnas no editables", proposal.draft.columns.every((c) => c.editable === false));
  check("Deshabilitar no pide palabra", !proposal.draft.confirmWord);
  check("La IA no recibe correos", !result.forModel.includes("@test.local"), result.forModel);

  await applyProposal(result.proposalId!, proposal.rows, ctx, "");
  check("Ana queda deshabilitada", db.select({ active: users.active }).from(users).where(eq(users.id, ids.s1)).get()?.active === false);
  check("Carla sigue activa", db.select({ active: users.active }).from(users).where(eq(users.id, ids.s3)).get()?.active === true);
  check("Auditoría de la baja", db.select().from(auditLog).where(eq(auditLog.action, "assistant_baja_alumnos")).get() !== undefined);
  setStudentActive(ids.s1, true); // se restaura para el resto de las pruebas

  // Bloqueo por PERMISO: mandar la fila «corregida» no se la salta
  const ajena = await toolByName("baja_alumnos")!.run(
    { modo: "deshabilitar", origen: "texto", texto: `Nombre,Correo\n${P} Carla Ajena,${P}-carla@test.local`, hoja: "", filtro_color: "", alumno_ids: [] },
    ctx
  );
  const pAjena = getProposal(ajena.proposalId!)!;
  check("La baja no se vuelve a revisar al aplicar", !pAjena.draft.recheckOnApply, pAjena.draft);
  const forzada = await applyProposal(
    ajena.proposalId!,
    pAjena.rows.map((r) => ({ ...r, blocked: false, warning: undefined })),
    ctx,
    ""
  );
  check(
    "Fila bloqueada por permiso mandada «corregida»: no se deshabilita",
    "text" in forzada &&
      forzada.text.startsWith("0 ") &&
      db.select({ active: users.active }).from(users).where(eq(users.id, ids.s3)).get()?.active === true,
    forzada
  );

  // Por ids, en vez de por archivo
  const porIds = await toolByName("baja_alumnos")!.run(
    { modo: "deshabilitar", origen: "ids", texto: "", hoja: "", filtro_color: "", alumno_ids: [ids.s2] },
    ctx
  );
  check("Por ids también propone", typeof porIds.proposalId === "string" && getProposal(porIds.proposalId!)!.rows.length === 1);

  // Borrar: solo admin y con palabra
  const maestroBorra = await toolByName("baja_alumnos")!.run(
    { modo: "borrar", origen: "ids", texto: "", hoja: "", filtro_color: "", alumno_ids: [ids.s4] },
    ctx
  );
  check("Maestro no puede borrar cuentas", !maestroBorra.proposalId && maestroBorra.forModel.toLowerCase().includes("administrador"), maestroBorra.forModel);

  const admin = { ...teacherUser, id: ids.admin, role: "admin" as const };
  const convA = createConversation(ids.admin, `${P} bajas admin`);
  const anchorA = appendMessage(convA.id, "assistant", [], "");
  const ctxA = { ...ctxFor(admin, ownScope(admin)), conversationId: convA.id, messageId: anchorA.id };
  const borrar = await toolByName("baja_alumnos")!.run(
    { modo: "borrar", origen: "ids", texto: "", hoja: "", filtro_color: "", alumno_ids: [ids.s4] },
    ctxA
  );
  const pBorrar = getProposal(borrar.proposalId!)!;
  check("Borrar pide la palabra", pBorrar.draft.confirmWord === "BORRAR");
  check("El título avisa de que es definitivo", pBorrar.draft.title.toLowerCase().includes("definitiv") || pBorrar.draft.applyLabel.toLowerCase().includes("borrar"));
  const sinPalabra = await applyProposal(borrar.proposalId!, pBorrar.rows, ctxA, "");
  check("Sin palabra no borra", "error" in sinPalabra && db.select().from(users).where(eq(users.id, ids.s4)).get() !== undefined);
  const conPalabra = await applyProposal(borrar.proposalId!, pBorrar.rows, ctxA, "BORRAR");
  check("Con palabra sí borra", "text" in conPalabra && db.select().from(users).where(eq(users.id, ids.s4)).get() === undefined, conPalabra);
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
  const turn = await runTurn({ user, scope: ownScope(user), route: "/teach/students", conversationId: null, text: `${P} ¿cómo va Ana?`, summarize: false, ai: { key: "k", model: "m", fetchImpl: ai.fetchImpl } });
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
  const t2 = await runTurn({ user, scope: ownScope(user), route: "/teach/dashboard", conversationId: turn.conversationId, text: "llévame al perfil de Ana", summarize: false, ai: { key: "k", model: "m", fetchImpl: nav.fetchImpl } });
  check("Navegación: bloque navigate con la URL", "message" in t2 && t2.message.blocks.some((b) => b.type === "navigate" && b.href === `/teach/students/${ids.s1}`));
  const third = nav.bodies[0] as { input: { role?: string; content?: string }[] };
  check("El historial anterior viaja como texto", third.input.some((i) => i.role === "assistant" && (i.content ?? "").includes("Ana lleva")));

  // Herramienta desconocida y parámetros con __
  const unknown = scripted([[call("c1", "borrar_todo", {})], [call("c2", "buscar_curso", { texto: "extintores", __undo: true })], [say("No puedo hacer eso.")]]);
  const t3 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "borra todo", summarize: false, ai: { key: "k", model: "m", fetchImpl: unknown.fetchImpl } });
  const u = unknown.bodies[1] as { input: { type?: string; output?: string }[] };
  check("Herramienta desconocida: se le dice a la IA y sigue", "message" in t3 && u.input.some((i) => i.type === "function_call_output" && (i.output ?? "").includes("no existe")));
  check("Termina con el texto final", "message" in t3 && t3.message.blocks.some((b) => b.type === "text" && b.text.includes("No puedo")));

  // Propuesta (conversación nueva): la IA redacta una línea y el turno termina
  const prop = scripted([[call("c1", "matricular", { alumno_ids: [ids.s1, ids.s2], curso_id: ids.course })], [say("Revisa la tabla.")]]);
  const t4 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: null, text: `${P} matricula a Ana y Beto en extintores`, summarize: false, ai: { key: "k", model: "m", fetchImpl: prop.fetchImpl } });
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
  const t4b = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula y busca", summarize: false, ai: { key: "k", model: "m", fetchImpl: twoCalls.fetchImpl } });
  const twoBody = twoCalls.bodies[1] as { input: { type?: string; call_id?: string; output?: string }[] };
  check("Tras la propuesta, la llamada siguiente se contesta como no ejecutada", "message" in t4b && twoBody.input.some((i) => i.type === "function_call_output" && i.call_id === "c2" && (i.output ?? "").includes("no ejecutada")) && !t4b.message.blocks.some((b) => b.type === "text" && b.text.includes("x")));

  // Matrícula instantánea: el mensaje guarda el undo
  const inst = scripted([[call("c1", "matricular", { alumno_ids: [ids.s2], curso_id: ids.course })], [say("Listo.")]]);
  const t5 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto", summarize: false, ai: { key: "k", model: "m", fetchImpl: inst.fetchImpl } });
  check("Instantánea: bloque result deshacible", "message" in t5 && t5.message.blocks.some((b) => b.type === "result" && b.undoable));
  check("…y el undo queda guardado en el mensaje", "message" in t5 && messageUndo(ids.teacher, turn.conversationId, t5.message.id)?.undo.tool === "matricular");

  const activeFor = (studentId: string) =>
    db.select().from(enrollments).where(and(eq(enrollments.courseId, ids.course), eq(enrollments.studentId, studentId))).all().filter((e) => e.status === "active").length;

  // Una sola acción instantánea por turno: tras matricular, la IA ya no recibe herramientas
  unenrollStudent(ids.course, ids.s2, ids.teacher);
  const twice = scripted([[call("c1", "matricular", { alumno_ids: [ids.s2], curso_id: ids.course })], [call("c2", "matricular", { alumno_ids: [ids.s4], curso_id: ids.course })], [say("Listo.")]]);
  const t5c = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto y luego a Dora", summarize: false, ai: { key: "k", model: "m", fetchImpl: twice.fetchImpl } });
  const twiceSecond = twice.bodies[1] as { tool_choice?: string; tools?: unknown };
  check("Tras la instantánea, la vuelta siguiente va sin herramientas", twiceSecond.tool_choice === "none" && twiceSecond.tools === undefined);
  check("Solo una matrícula nueva (Beto sí, Dora no)", activeFor(ids.s2) === 1 && activeFor(ids.s4) === 0);
  check("Un solo bloque deshacible y termina en 2 vueltas", "message" in t5c && t5c.message.blocks.filter((b) => b.type === "result" && b.undoable).length === 1 && twice.calls() === 2);
  check("…y el undo guardado es el de Beto", "message" in t5c && messageUndo(ids.teacher, turn.conversationId, t5c.message.id)?.undo.params.alumno_id === ids.s2);

  // Dos instantáneas en la misma vuelta: la segunda se contesta como no ejecutada
  unenrollStudent(ids.course, ids.s2, ids.teacher);
  const sameRound = scripted([[call("c1", "matricular", { alumno_ids: [ids.s2], curso_id: ids.course }), call("c2", "matricular", { alumno_ids: [ids.s4], curso_id: ids.course })], [say("Listo.")]]);
  const t5d = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto y a Dora", summarize: false, ai: { key: "k", model: "m", fetchImpl: sameRound.fetchImpl } });
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
  const t5b = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "matricula a Beto otra vez", summarize: false, ai: { key: "k", model: "m", fetchImpl: thenFail } });
  check("Instantánea + fallo de API: result deshacible y error reintentable", "message" in t5b && t5b.message.blocks.some((b) => b.type === "result" && b.undoable) && t5b.message.blocks.some((b) => b.type === "error" && b.retryable));
  check("…y el undo se guarda aunque falle la API", "message" in t5b && messageUndo(ids.teacher, turn.conversationId, t5b.message.id)?.undo.tool === "matricular");
  check("…y el historial recuerda la herramienta usada", recentModelText(turn.conversationId, 1)[0]?.text.includes("[usó: matricular]"));

  // Tope de vueltas
  const loop = scripted([[call("c1", "buscar_curso", { texto: "x" })]]);
  const t6 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "bucle", summarize: false, ai: { key: "k", model: "m", fetchImpl: loop.fetchImpl } });
  const lastBody = loop.bodies[loop.bodies.length - 1] as { tool_choice?: string; input: { role?: string; content?: string }[] };
  check("Tope de 6 vueltas: 7 llamadas y termina", "message" in t6 && loop.calls() === 7 && t6.message.blocks.length > 0);
  check("Última vuelta: sin herramientas y aviso como system", lastBody.tool_choice === "none" && lastBody.input.some((i) => i.role === "system" && (i.content ?? "").includes("Ya no puedes")));

  // Argumentos que no son objeto: no revienta y responde a la IA
  const badArgs = scripted([[call("c1", "buscar_curso", "\"texto\"")], [say("Necesito el nombre del curso.")]]);
  const t6b = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "busca", summarize: false, ai: { key: "k", model: "m", fetchImpl: badArgs.fetchImpl } });
  const badBody = badArgs.bodies[1] as { input: { type?: string; call_id?: string }[] };
  check("Args no objeto: se contesta la llamada y termina con texto", "message" in t6b && badBody.input.some((i) => i.type === "function_call_output" && i.call_id === "c1") && t6b.message.blocks.some((b) => b.type === "text"));

  // Rol no admitido: ni toca la base
  const student: SessionUser = { id: ids.s1, email: "", fullName: "Ana", role: "student" };
  const denied = await runTurn({ user: student, scope: ownScope(student), route: "/", conversationId: null, text: `${P} hola`, summarize: false, ai: { key: "k", model: "m", fetchImpl: loop.fetchImpl } });
  check("Alumno: error sin crear conversación", "error" in denied && denied.error.includes("solo para maestros") && listConversations(ids.s1).length === 0 && loop.calls() === 7);

  // Error de la API
  const failing = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  const t7 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: turn.conversationId, text: "hola", summarize: false, ai: { key: "k", model: "m", fetchImpl: failing } });
  check("Fallo de OpenAI: bloque de error reintentable", "message" in t7 && t7.message.blocks.some((b) => b.type === "error" && b.retryable));

  // Texto vacío
  check("Texto vacío: error", "error" in (await runTurn({ user, scope: ownScope(user), route: "/", conversationId: null, text: "  ", summarize: false, ai: { key: "k", model: "m", fetchImpl: failing } })));
}

async function turnoConAdjuntoChecks() {
  console.log("\n— Turno con adjunto");
  const bytes = await makeColoredXlsx();
  if (!bytes) {
    console.log("  (sin LibreOffice: se omite)");
    return;
  }
  const user = { ...teacherUser, id: ids.teacher };
  const conv = createConversation(ids.teacher, `${P} con adjunto`);
  const fileId = await saveTestFile(bytes, `${P}-prueba.xlsx`, ids.teacher);
  const { id: attachmentId, summary } = await attachToConversation({ conversationId: conv.id, fileId, userId: ids.teacher });
  check("El adjunto se guarda con su resumen", summary.sheets.length === 2 && summary.fileName.endsWith(".xlsx"), summary.fileName);
  check("Adjunto de otra persona: se rechaza", (await errorOf(() => attachToConversation({ conversationId: conv.id, fileId, userId: ids.admin }))) !== "");

  const ai = scripted([
    [call("c1", "alta_alumnos", { origen: "adjunto", texto: "", hoja: "", filtro_color: "rojo", curso_id: "", grupo: "" })],
    [say("Revisa la tabla.")],
  ]);
  const turn = await runTurn({
    user,
    scope: ownScope(user),
    route: "/teach/students",
    conversationId: conv.id,
    text: "da de alta a los que están en rojo",
    attachmentIds: [attachmentId],
    ai: { key: "k", model: "m", fetchImpl: ai.fetchImpl },
  });
  check("El turno sale bien", "message" in turn, turn);
  if (!("message" in turn)) return;
  const body = ai.bodies[0] as { input: { role?: string; content?: string }[] };
  const system = body.input.find((i) => i.role === "system")?.content ?? "";
  check("El resumen del archivo va en la instrucción", system.includes("prueba.xlsx") && system.includes("Turno A"), system.slice(-400));
  // El resumen lleva dos filas de ejemplo; de ahí en adelante nada del archivo viaja
  check("La IA NO recibe las filas del archivo", !system.includes("carla@x.com"));
  check("Propuesta con solo la fila roja", turn.message.blocks.some((b) => b.type === "proposal" && b.rows.length === 1), turn.message.blocks.map((b) => b.type));
  const saved = getConversation(ids.teacher, conv.id)!;
  check("El mensaje del usuario muestra el archivo", saved.messages[0].blocks.some((b) => b.type === "attachment"), saved.messages[0].blocks);

  // Sin adjuntos, el prompt no habla de archivos
  const ai2 = scripted([[say("Hola.")]]);
  await runTurn({ user, scope: ownScope(user), route: "/", conversationId: conv.id, text: "hola", ai: { key: "k", model: "m", fetchImpl: ai2.fetchImpl } });
  const system2 = (ai2.bodies[0] as { input: { role?: string; content?: string }[] }).input.find((i) => i.role === "system")?.content ?? "";
  check("Sin adjunto no se menciona ningún archivo", !system2.includes("Archivo adjunto"));

  // Adjunto de otra conversación: no se usa
  const otra = createConversation(ids.teacher, `${P} otra`);
  const ai3 = scripted([[say("Hola.")]]);
  const turn3 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: otra.id, text: "hola", attachmentIds: [attachmentId], ai: { key: "k", model: "m", fetchImpl: ai3.fetchImpl } });
  const system3 = (ai3.bodies[0] as { input: { role?: string; content?: string }[] }).input.find((i) => i.role === "system")?.content ?? "";
  check("Un adjunto de otra conversación no se cuela", !system3.includes("prueba.xlsx") && "message" in turn3);

  // Conversación nacida de un archivo: el primer texto le pone título
  const desdeArchivo = createConversation(ids.teacher, ATTACHMENT_TITLE);
  const ai4 = scripted([[say("Hola.")]]);
  await runTurn({ user, scope: ownScope(user), route: "/", conversationId: desdeArchivo.id, text: `${P} da de alta a los de la lista`, ai: { key: "k", model: "m", fetchImpl: ai4.fetchImpl } });
  check("«Archivo adjunto» toma el título del primer mensaje", getConversation(ids.teacher, desdeArchivo.id)?.title === `${P} da de alta a los de la lista`, getConversation(ids.teacher, desdeArchivo.id)?.title);
  // Si el título no cambió, no lo alcanza la limpieza por prefijo: se borra aquí
  deleteConversation(ids.teacher, desdeArchivo.id);
  const ai5 = scripted([[say("Hola.")]]);
  await runTurn({ user, scope: ownScope(user), route: "/", conversationId: conv.id, text: "otro mensaje", ai: { key: "k", model: "m", fetchImpl: ai5.fetchImpl } });
  check("Un título normal no se toca", getConversation(ids.teacher, conv.id)?.title === `${P} con adjunto`);
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

  check("Detalle: varias hojas y el total de filas", attachmentDetail(summary) === "2 hojas · 94 filas", attachmentDetail(summary));
  const unaHoja: AttachmentSummary = { ...summary, sheets: [{ ...summary.sheets[0], rowCount: 8 }] };
  check("Detalle: una sola hoja lleva su nombre", attachmentDetail(unaHoja) === "«Matutino» · 8 filas", attachmentDetail(unaHoja));
  check("Detalle: una sola hoja", attachmentDetail(cursos) === "«Hoja1» · 4 filas", attachmentDetail(cursos));
  const sinNombre: AttachmentSummary = { ...unaHoja, sheets: [{ ...unaHoja.sheets[0], name: "  " }] };
  check("Detalle: hoja sin nombre, solo las filas", attachmentDetail(sinNombre) === "8 filas", attachmentDetail(sinNombre));
  check("Detalle: documento con sus caracteres", attachmentDetail({ fileName: "manual.pdf", kind: "doc", sheets: [], chars: 12_000 }) === "PDF · 12 000 caracteres", attachmentDetail({ fileName: "manual.pdf", kind: "doc", sheets: [], chars: 12_000 }));
  check("Detalle: imagen", attachmentDetail({ fileName: "foto.jpg", kind: "image", sheets: [], chars: 0 }) === "Imagen");

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

/**
 * El Excel que generamos, comprobado volviéndolo a leer con el mismo lector
 * que usa el asistente para los adjuntos: si sobrevivieron los colores y los
 * números, el rodeo por FODS hizo su trabajo.
 */
async function xlsxChecks() {
  console.log("\n— Excel con formato");

  // Sin LibreOffice no hay Excel: el mensaje tiene que mandar al CSV
  const antes = process.env.SOFFICE_PATH;
  process.env.SOFFICE_PATH = "C:/no-existe/soffice.exe";
  const sinOffice = await errorOf(() => buildXlsx([{ name: "X", columns: [{ title: "A" }], rows: [] }]));
  if (antes === undefined) delete process.env.SOFFICE_PATH;
  else process.env.SOFFICE_PATH = antes;
  check("Sin LibreOffice: manda al CSV", sinOffice === "No se pudo generar el Excel. Descarga el CSV.", sinOffice);

  if (!HAS_SOFFICE) {
    console.log("  (sin LibreOffice: se omite lo demás)");
    return;
  }

  const spec: SheetSpec[] = [
    {
      name: "Avance",
      columns: [{ title: "Alumno", width: 6 }, { title: "Avance" }, { title: "Calificación" }, { title: "Última entrada" }],
      rows: [
        [
          { text: "Ana Lopez" },
          { text: "92%", percent: 0.92 },
          { text: "9.5", number: 9.5 },
          { text: "23/09/2026", date: new Date(2026, 8, 23) },
        ],
        [
          { text: "Beto Ruiz", style: "bad" },
          { text: "10%", percent: 0.1, style: "bad" },
          { text: "3", number: 3, style: "bad" },
          { text: "", style: "bad" },
        ],
        [{ text: "Carla & Diaz", style: "good" }, { text: "100%", percent: 1, style: "good" }],
      ],
      notes: ["Los porcentajes cuentan lecciones terminadas.", "En rojo, quien lleva 30 días sin entrar."],
    },
    // Nombre larguísimo y con «/»: se sanea y no rompe la conversión
    { name: `Detalle/por curso ${"x".repeat(40)}`, columns: [{ title: "Nada", width: 99 }], rows: [] },
    // Repetido: se le añade un número
    { name: "Avance", columns: [{ title: "Otra" }], rows: [[{ text: "sin estilo" }]] },
  ];
  const bytes = await buildXlsx(spec);
  check("Devuelve un xlsx (ZIP con contenido)", bytes.length > 1000 && bytes.subarray(0, 2).toString("latin1") === "PK", bytes.length);

  const sheets = await readSheetRows(bytes, "avance.xlsx");
  const nombres = sheets.map((s) => s.name);
  check("Las hojas pedidas y la de notas, en orden", sheets.length === 4, nombres);
  check("La primera conserva su nombre", nombres[0] === "Avance", nombres[0]);
  check("Las notas van en una hoja aparte", (nombres[1] ?? "").includes("Notas"), nombres[1]);
  check("Una línea por nota", sheets[1]?.rows.length === 2 && sheets[1].rows[0].cells[0].startsWith("Los porcentajes"), sheets[1]?.rows.map((r) => r.cells[0]));
  check("Nombre largo y con «/»: saneado a 31 caracteres", (nombres[2] ?? "").length <= 31 && !(nombres[2] ?? "x").includes("/"), nombres[2]);
  check("Nombre repetido: lleva número", nombres[3] !== "Avance" && (nombres[3] ?? "").startsWith("Avance"), nombres[3]);

  const filas = sheets[0]?.rows ?? [];
  check("El encabezado, con los títulos que se pidieron", filas[0]?.cells.join("|") === "Alumno|Avance|Calificación|Última entrada", filas[0]?.cells);
  check("Fila normal: sin pintar y con su texto", filas[1]?.color === null && filas[1]?.cells[0] === "Ana Lopez", filas[1]);
  check("Fila «bad»: sale en rojo", filas[2]?.color === "rojo", filas[2]?.color);
  check("Fila «good»: sale en verde", filas[3]?.color === "verde", filas[3]?.color);
  check("El «&» del texto llega entero", filas[3]?.cells[0] === "Carla & Diaz", filas[3]?.cells[0]);
  // Según cómo exporte LibreOffice, el porcentaje se ve formateado o crudo:
  // lo que importa es que NO sea el texto que le pasamos por casualidad
  const pct = filas[1]?.cells[1] ?? "";
  check("El porcentaje es un número con formato (92% o 0.92)", ["92%", "0.92", "0,92"].includes(pct), pct);
  check("El número no se volvió texto", filas[1]?.cells[2] === "9.5" || filas[1]?.cells[2] === "9,5", filas[1]?.cells[2]);
  check("La fecha se lee como fecha (dd/mm/aaaa)", /^\d{2}\/\d{2}\/\d{4}$/.test(filas[1]?.cells[3] ?? ""), filas[1]?.cells[3]);

  const vacia = sheets[2]?.rows ?? [];
  check("Sin filas: queda el encabezado solo", vacia.length === 1 && vacia[0].cells[0] === "Nada", vacia);
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

  // Título arriba: el encabezado no es la primera fila y aun así se lee sin IA (si la usara, lanzaría)
  const conTitulo = Buffer.from("LISTA DE ASISTENCIA\nSeptiembre 2026\nNombre,Correo\nGina Paz,gina@x.com\n", "utf8");
  const deTitulo = await peopleRows({ bytes: conTitulo, fileName: "titulo.csv" }, { ai: undefined });
  check("Encabezado bajo un título: una persona y sin IA", deTitulo.rows.length === 1 && deTitulo.rows[0].email === "gina@x.com", deTitulo.rows);
}

async function modeloChatChecks() {
  console.log("\n— Modelo aparte para conversar");
  // Los ajustes de IA son globales y esta base es la de verdad: se guarda lo
  // que había y se restaura pase lo que pase
  const antes = getAiSettings();
  try {
    saveAiSettings({ model: "gpt-5.6-terra", chatModel: "gpt-5.6-luna" });
    const con = getAiSettings();
    check("Se guarda y se lee el modelo de conversación", con.chatModel === "gpt-5.6-luna" && con.model === "gpt-5.6-terra", con);
    check("Conversar usa el de conversación", chatModelOf(con) === "gpt-5.6-luna");
    check("Las extracciones siguen con el principal", getAiSettings().model === "gpt-5.6-terra");

    const malo = await errorOf(async () => saveAiSettings({ model: "gpt-5.6-terra", chatModel: "no es un modelo" }));
    check("Un modelo de conversación inválido se rechaza con mensaje", malo.includes("nombre del modelo"), malo);
    check("…y no pisa el que ya estaba", getAiSettings().chatModel === "gpt-5.6-luna");

    saveAiSettings({ model: "gpt-5.6-terra", chatModel: "" });
    const sin = getAiSettings();
    check("Vacío borra el ajuste", sin.chatModel === "");
    check("…y entonces se conversa con el principal", chatModelOf(sin) === "gpt-5.6-terra");

    // Sin `chatModel` en la entrada, el que hubiera se queda como estaba
    saveAiSettings({ model: "gpt-5.6-terra", chatModel: "gpt-5.6-luna" });
    saveAiSettings({ model: "gpt-5.6-terra" });
    check("Guardar sin tocar el campo no lo borra", getAiSettings().chatModel === "gpt-5.6-luna");
  } finally {
    saveAiSettings({ model: antes.model, chatModel: antes.chatModel });
    const vuelto = getAiSettings();
    check("Los ajustes de IA quedan como estaban", vuelto.model === antes.model && vuelto.chatModel === antes.chatModel, [antes.model, antes.chatModel, vuelto.model, vuelto.chatModel]);
  }
}

/** Mensajes de relleno para llegar al tope de resumen sin llamar a la IA. */
function seedMensajes(conversationId: string, cuantos: number, texto: string) {
  for (let i = 0; i < cuantos; i++) {
    appendMessage(conversationId, i % 2 === 0 ? "user" : "assistant", [], `${texto} ${i}`);
  }
}

async function resumenChecks() {
  console.log("\n— Resumen de la conversación");
  const user = { ...teacherUser, id: ids.teacher };
  const ai = (fetchImpl: typeof fetch) => ({ key: "k", model: "m", fetchImpl });

  // Menos de 10 mensajes nuevos: ni se llama a la IA
  const corta = createConversation(ids.teacher, `${P} resumen corto`);
  seedMensajes(corta.id, 8, "charla");
  const nadie = scripted([[say("no debería llamarse")]]);
  const sinResumir = await maybeSummarize(corta.id, ai(nadie.fetchImpl));
  check("Con menos de 10 mensajes nuevos no se llama a la IA", sinResumir === false && nadie.calls() === 0, nadie.calls());
  check("…y la conversación sigue sin resumen", getSummary(corta.id).summary === null && getSummary(corta.id).total === 8);

  // 12 mensajes: resume y deja summaryUpto en 12
  const larga = createConversation(ids.teacher, `${P} resumen largo`);
  seedMensajes(larga.id, 12, "mensaje viejo");
  const resumidor = scripted([[say(JSON.stringify({ resumen: "Se matriculó a Ana en Extintores." }))]]);
  const hecho = await maybeSummarize(larga.id, ai(resumidor.fetchImpl));
  const guardado = getSummary(larga.id);
  check("Con 12 mensajes resume y guarda hasta el 12", hecho === true && guardado.summary === "Se matriculó a Ana en Extintores." && guardado.summaryUpto === 12, guardado);
  const pedido = resumidor.bodies[0] as { input: { role?: string; content?: string }[] };
  check("La instrucción pide menos de 600 caracteres y no inventar", (pedido.input[0].content ?? "").includes("600 caracteres") && (pedido.input[0].content ?? "").includes("No inventes"), pedido.input[0].content);
  check("Le manda los mensajes a resumir", (pedido.input[1].content ?? "").includes("mensaje viejo 0"));

  // Justo después no vuelve a resumir: no hay 10 nuevos
  const otraVez = scripted([[say("tampoco")]]);
  check("Recién resumida no se vuelve a llamar", (await maybeSummarize(larga.id, ai(otraVez.fetchImpl))) === false && otraVez.calls() === 0);

  // El turno siguiente manda el resumen y NO los mensajes ya resumidos
  const post = scripted([[say("Listo.")]]);
  const t = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: larga.id, text: "¿y ahora qué?", summarize: false, ai: ai(post.fetchImpl) });
  const input = (post.bodies[0] as { input: { role?: string; content?: string }[] }).input;
  check("El turno siguiente sale bien", "message" in t, t);
  check("…y manda el resumen de lo anterior", input.some((i) => (i.content ?? "").includes("Resumen de lo anterior: Se matriculó a Ana")), input);
  check("…y no repite los mensajes ya resumidos", !input.some((i) => (i.content ?? "").includes("mensaje viejo")), input);

  // Un turno que pasa del tope resume al terminar, en la misma llamada
  const alVuelo = createConversation(ids.teacher, `${P} resumen al vuelo`);
  seedMensajes(alVuelo.id, 11, "paso");
  const dos = scripted([[say("Hecho.")], [say(JSON.stringify({ resumen: "Repaso de lo hecho." }))]]);
  const t2 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: alVuelo.id, text: "cierra", ai: ai(dos.fetchImpl) });
  const alVueloSummary = getSummary(alVuelo.id);
  check("Al terminar el turno se resume (2 llamadas: turno y resumen)", "message" in t2 && dos.calls() === 2, dos.calls());
  check("…y el resumen cubre los 13 mensajes", alVueloSummary.summary === "Repaso de lo hecho." && alVueloSummary.summaryUpto === 13, alVueloSummary);

  // Si la IA del resumen falla, el turno sale bien y el resumen queda igual
  const falla = createConversation(ids.teacher, `${P} resumen que falla`);
  seedMensajes(falla.id, 11, "hola");
  let n = 0;
  const turnoOkResumenMal = (async () => {
    n++;
    return n === 1
      ? new Response(JSON.stringify({ output: [say("Todo bien.")] }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("{}", { status: 500 });
  }) as typeof fetch;
  console.log("  (se espera un error de resumen en el registro)");
  const t3 = await runTurn({ user, scope: ownScope(user), route: "/", conversationId: falla.id, text: "sigue", ai: ai(turnoOkResumenMal) });
  const tras = getSummary(falla.id);
  check("El resumen se intentó (2 llamadas)", n === 2, n);
  check("Aunque falle, el turno responde igual", "message" in t3 && t3.message.blocks.some((b) => b.type === "text" && b.text.includes("Todo bien")), t3);
  check("…y el resumen queda como estaba", tras.summary === null && tras.summaryUpto === 0, tras);
}

async function main() {
  placeholderChecks();
  dateRangeChecks();
  await clientChecks();
  await modeloChatChecks();
  attachmentSummaryChecks();
  excelFormatChecks();
  await sheetColorChecks();
  await xlsxChecks();
  await intakeChecks();
  await rowsFromAttachmentChecks();
  await setup();
  try {
    await catalogChecks();
    await readToolChecks();
    await conversationChecks();
    await exportChecks();
    await proposalChecks();
    await confirmWordChecks();
    await altaAlumnosChecks();
    await agentChecks();
    await resumenChecks();
    await turnoConAdjuntoChecks();
    await crearCursosChecks();
    await formatoExcelChecks();
    await aplicarExcelChecks();
    await queryChecks();
    await listadoChecks();
    await reporteChecks();
    await consultaToolChecks();
    await descargaToolChecks();
    suggestionChecks();
    await detallesChecks();
    await gruposChecks();
    await restaurarChecks();
    await avisarChecks();
    // Al final: borrar a Dora dejaría sin alumno a las demás secciones
    await reactivarAlumnosChecks();
    await bajaAlumnosChecks();
  } finally {
    await cleanup();
  }
  check("Ninguna prueba usó la API real", openaiCalls === 0, openaiCalls);
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
