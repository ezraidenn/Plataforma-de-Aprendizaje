/**
 * Prueba de «Importar estudiantes con IA» sin gastar: tramos de una lista,
 * normalización de lo que devuelve la IA (OpenAI simulado), reglas de
 * validación, importación con grupos por fila y auditoría.
 * Con --live, además una lectura real de texto y otra de una imagen con la
 * clave guardada en Configuración (necesita internet; gasta centavos).
 *
 * Uso: pnpm smoke:ai-students [--live]   (necesita los datos de `pnpm seed:demo`)
 */
import { and, eq, inArray, like } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../src/server/db";
import { auditLog, cohorts, courses as coursesTable, enrollments, users } from "../src/server/db/schema";
import {
  ROSTER_CHUNK_CHARS,
  STUDENTS_SCHEMA,
  interpretStudentsChunk,
  interpretStudentsChunkWithRetry,
  interpretStudentsVision,
  splitRosterChunks,
  toStudentDrafts,
} from "../src/server/services/ai-student-import";
import { cohortsForRows, importStudents, studentRowsToCsv, validateStudentsCsv } from "../src/server/services/csv-import";
import { getAiKey, getAiSettings } from "../src/server/services/ai-settings";
import { prepareImage } from "../src/server/services/image-prep";
import { studentDraftProblem } from "../src/lib/student-draft";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? `  · ${extra}` : ""}`);
}
async function rejects(fn: () => Promise<unknown>, text: string) {
  try {
    await fn();
    return false;
  } catch (e) {
    return (e as Error).message.includes(text);
  }
}

/** fetch simulado que responde como la Responses API. */
function fakeResponse(payload: unknown, status = 200, capture?: (body: unknown) => void): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    capture?.(JSON.parse(String(init?.body ?? "{}")));
    const body =
      status === 200
        ? { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }] }
        : { error: { message: "simulado" } };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}
const opts = (fetchImpl: typeof fetch) => ({ key: "sk-prueba", model: "modelo-prueba", fetchImpl });

function chunkChecks() {
  console.log("\n— Tramos de una lista");
  const header = "Nombre,Correo,Grupo";
  const rows = Array.from({ length: 600 }, (_, i) => `Persona Número ${i + 1},persona${i + 1}@empresa.local,Grupo ${1 + (i % 3)}`);
  const chunks = splitRosterChunks([header, ...rows].join("\n"));
  check("una lista larga se parte en varios tramos", chunks.length > 1, `${chunks.length} tramos`);
  check("ningún tramo pasa del límite (con margen del encabezado)", chunks.every((c) => c.length <= ROSTER_CHUNK_CHARS + 200));
  const all = chunks.join("\n");
  check("ninguna fila se corta ni se pierde", rows.every((r) => all.includes(r)));
  check("los tramos siguientes llevan el encabezado", chunks.slice(1).every((c) => c.startsWith(`(continúa la lista; encabezado: ${header})`)));
  const sheets = splitRosterChunks("# Hoja: A\nNombre,Correo\nAna López,ana@x.mx\n# Hoja: B\nNombre,Correo\nBeto Ruiz,beto@x.mx");
  check("un Excel chico de dos hojas cabe en un tramo", sheets.length === 1 && sheets[0].includes("# Hoja: B"));
  // Filas numeradas («1.», «2)»): el corte de exámenes las partiría como preguntas
  const numbered = splitRosterChunks(Array.from({ length: 50 }, (_, i) => `${i + 1}. Persona ${i + 1}`).join("\n"));
  check("filas numeradas no se parten una por una", numbered.length === 1);
}

function normalizeChecks() {
  console.log("\n— Lo que devuelve la IA se revisa");
  const drafts = toStudentDrafts({
    students: [
      { fullName: "  Ana   María López ", email: " Ana.Lopez@Empresa.MX ", group: " Turno A ", issues: [" "] },
      { fullName: "Beto Ruiz", email: "mailto:beto@empresa.mx", group: "", issues: ["Correo ilegible"] },
      { fullName: "", email: "", group: "X", issues: [] },
      { fullName: 42, email: null },
      "basura",
    ],
  });
  check("descarta filas vacías y basura", drafts.length === 2, `${drafts.length} filas`);
  check("nombre sin espacios de más", drafts[0]?.fullName === "Ana María López");
  check("correo en minúsculas y sin espacios", drafts[0]?.email === "ana.lopez@empresa.mx");
  check("quita «mailto:»", drafts[1]?.email === "beto@empresa.mx");
  check("grupo limpio", drafts[0]?.group === "Turno A");
  check("notas vacías fuera, las reales se quedan", drafts[0]?.issues.length === 0 && drafts[1]?.issues[0] === "Correo ilegible");
  check("cada fila con su clave", new Set(drafts.map((d) => d.key)).size === drafts.length);
  check("respuesta sin «students» → lista vacía", toStudentDrafts({ foo: 1 }).length === 0 && toStudentDrafts(null).length === 0);
  check("problema en vivo: sin correo", studentDraftProblem({ fullName: "Ana López", email: "" }) === "Falta el correo");
  check("problema en vivo: correo inválido", studentDraftProblem({ fullName: "Ana López", email: "ana@" }) === "Correo inválido");
  check("problema en vivo: sin nombre", studentDraftProblem({ fullName: "A", email: "a@b.mx" }) === "Falta el nombre");
  check("fila correcta: sin problema", studentDraftProblem({ fullName: "Ana López", email: "ANA@b.mx " }) === null);
}

async function aiChecks() {
  console.log("\n— OpenAI simulado");
  const walk = (s: Record<string, unknown>): boolean => {
    if (s.type === "object") {
      const props = Object.keys((s.properties as object) ?? {});
      const req = (s.required as string[]) ?? [];
      if (s.additionalProperties !== false || props.length !== req.length) return false;
      return Object.values(s.properties as Record<string, Record<string, unknown>>).every(walk);
    }
    if (s.type === "array") return walk(s.items as Record<string, unknown>);
    return true;
  };
  check("esquema estricto (todo obligatorio, sin propiedades extra)", walk(STUDENTS_SCHEMA as Record<string, unknown>));

  let sent: { text?: { format?: { name?: string } }; input?: { content: unknown }[] } = {};
  const drafts = await interpretStudentsChunk(
    "Nombre;Correo\nLÓPEZ PÉREZ, ANA;ana@empresa.mx",
    opts(fakeResponse({ students: [{ fullName: "Ana López Pérez", email: "ana@empresa.mx", group: "", issues: [] }] }, 200, (b) => (sent = b as typeof sent)))
  );
  check("un tramo → estudiantes", drafts.length === 1 && drafts[0].fullName === "Ana López Pérez");
  check("pide el esquema «estudiantes»", sent.text?.format?.name === "estudiantes");
  check("manda la instrucción de no inventar correos", JSON.stringify(sent.input?.[0]).includes("NUNCA inventes"));

  check("clave inválida → mensaje claro", await rejects(() => interpretStudentsChunk("x", opts(fakeResponse({}, 401))), "clave"));
  let calls = 0;
  const flaky = (async () => {
    calls++;
    const text = calls === 1 ? "{roto" : JSON.stringify({ students: [{ fullName: "Beto Ruiz", email: "beto@x.mx", group: "", issues: [] }] });
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text }] }] }), { status: 200 });
  }) as typeof fetch;
  const retried = await interpretStudentsChunkWithRetry("x", opts(flaky));
  check("respuesta rota: se reintenta una vez", calls === 2 && retried.length === 1);

  let visionBody: { input?: { content: { type: string; text?: string }[] }[] } = {};
  const img = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#fff" } }).png().toBuffer();
  const part = { kind: "image" as const, dataUrl: (await prepareImage(img, "lista.png")).dataUrl };
  await interpretStudentsVision([part, part], opts(fakeResponse({ students: [] }, 200, (b) => (visionBody = b as typeof visionBody))));
  const content = visionBody.input?.[1]?.content ?? [];
  check("visión: instrucción de lista + las 2 imágenes", content[0]?.text?.includes("lista de personas de estas 2 imágenes") === true && content.filter((c) => c.type === "input_image").length === 2);
}

async function importChecks() {
  console.log("\n— Validación e importación (mismas reglas que el CSV)");
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get();
  const course = db.select().from(coursesTable).where(like(coursesTable.title, "Uso y Manejo de Extintores%")).get();
  if (!teacher || !course) {
    check("datos demo disponibles (pnpm seed:demo)", false);
    return;
  }
  const stamp = Date.now().toString(36);
  const e = (n: string) => `ia-${n}-${stamp}@prueba.local`;
  const rows = [
    { fullName: "Ana López", email: e("ana"), group: "Grupo IA Turno A" },
    { fullName: "Beto Ruiz", email: e("beto"), group: "grupo ia turno a" }, // mismo grupo, otra capitalización
    { fullName: "Carla Díaz", email: e("carla"), group: "Grupo IA Turno B" },
    { fullName: "Dani Sin Grupo", email: e("dani"), group: "" },
    { fullName: "Repetida", email: e("ana"), group: "" },
    { fullName: "Personal", email: "maestro@empresa.local", group: "" },
    { fullName: "Laura Pérez", email: "estudiante@empresa.local", group: "Grupo IA Turno A" },
    { fullName: "X", email: "no-es-correo", group: "" },
  ];
  const { rows: checked } = validateStudentsCsv(studentRowsToCsv(rows));
  check("una revisión por fila, en orden", checked.length === rows.length);
  check("nuevas", checked.slice(0, 4).every((r) => r.status === "ok"));
  check("correo repetido en la lista", checked[4].status === "invalid" && checked[4].message.includes("repetido"));
  check("correo de personal no se toma como alumno", checked[5].status === "invalid" && checked[5].message.includes("personal"));
  check("alumno existente → ya existe", checked[6].status === "duplicate");
  check("correo inválido", checked[7].status === "invalid");
  const withComma = validateStudentsCsv(studentRowsToCsv([{ fullName: "López, Ana; hija", email: e("coma") }])).rows;
  check("nombres con coma o punto y coma no rompen el CSV", withComma[0].fullName === "López, Ana; hija" && withComma[0].status === "ok");

  const createdIds: string[] = [];
  let cohortIds: string[] = [];
  // Laura ya está matriculada en el curso demo: se anota su grupo para dejarlo igual
  const laura = db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get();
  const lauraEnrollment = laura
    ? db.select().from(enrollments).where(and(eq(enrollments.studentId, laura.id), eq(enrollments.courseId, course.id))).get()
    : undefined;
  try {
    const byEmail = cohortsForRows(course.id, rows, teacher.id);
    cohortIds = [...new Set(Object.values(byEmail))];
    check("grupos: se crean 2 (mismo nombre sin importar mayúsculas)", cohortIds.length === 2);
    const result = await importStudents({
      csvText: studentRowsToCsv(rows),
      createdBy: teacher.id,
      actorId: teacher.id,
      enrollCourseId: course.id,
      enrollDuplicates: true,
      cohortByEmail: byEmail,
      auditAction: "ai_import_students",
    });
    createdIds.push(
      ...db.select({ id: users.id }).from(users).where(like(users.email, `ia-%-${stamp}@prueba.local`)).all().map((u) => u.id)
    );
    check("crea las 4 nuevas; omite 3 con error y 1 que ya tenía cuenta", result.created === 4 && result.skipped === 4, JSON.stringify({ created: result.created, skipped: result.skipped }));
    check("matricula a las 4 nuevas (Laura ya estaba en el curso)", result.enrolled === 4, `matriculados=${result.enrolled}`);
    const cohortOf = (email: string) =>
      db
        .select({ c: enrollments.cohortId })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.studentId))
        .where(and(eq(users.email, email), eq(enrollments.courseId, course.id)))
        .get()?.c ?? null;
    check("Ana y Beto en el mismo grupo", !!cohortOf(e("ana")) && cohortOf(e("ana")) === cohortOf(e("beto")));
    check("Carla en otro grupo", !!cohortOf(e("carla")) && cohortOf(e("carla")) !== cohortOf(e("ana")));
    check("Dani sin grupo", cohortOf(e("dani")) === null);
    check("Laura (ya matriculada) pasa al grupo que dice la lista", !!lauraEnrollment && cohortOf("estudiante@empresa.local") === cohortOf(e("ana")));
    check("el CSV de resultados trae las contraseñas", result.resultCsv.split("\n").filter((l) => l.includes("Creado")).length === 4);
    check(
      "auditoría «ai_import_students»",
      !!db.select().from(auditLog).where(eq(auditLog.action, "ai_import_students")).all().find((a) => (a.detail as { created?: number })?.created === 4)
    );
  } finally {
    // Deja la base como estaba: alumnos de prueba, sus matrículas y los grupos creados
    if (createdIds.length) db.delete(users).where(inArray(users.id, createdIds)).run();
    if (lauraEnrollment) {
      db.update(enrollments).set({ cohortId: lauraEnrollment.cohortId }).where(eq(enrollments.id, lauraEnrollment.id)).run();
    }
    if (cohortIds.length) db.delete(cohorts).where(inArray(cohorts.id, cohortIds)).run();
    db.delete(auditLog).where(eq(auditLog.action, "ai_import_students")).run();
  }
}

async function liveChecks() {
  console.log("\n— OpenAI real (--live)");
  const key = getAiKey();
  if (!key) {
    check("hay clave de OpenAI en Configuración", false);
    return;
  }
  const live = { key, model: getAiSettings().model };
  const text = [
    "LISTA DE ASISTENCIA — CURSO DE EXTINTORES",
    "No.;Apellidos, Nombre;Correo;Turno;Teléfono",
    "1;GARCÍA HERNÁNDEZ, JOSÉ LUIS;JL.Garcia@Empresa.mx;Matutino;999 123 4567",
    "2;de la Cruz Pérez, María;maria.delacruz@empresa.mx;Vespertino;999 765 4321",
    "3;RAMÍREZ, PEDRO;;Matutino;999 000 1111",
  ].join("\n");
  const drafts = await interpretStudentsChunkWithRetry(text, live);
  console.log("    ", JSON.stringify(drafts.map(({ fullName, email, group, issues }) => ({ fullName, email, group, issues }))));
  check("lee las 3 personas", drafts.length === 3);
  check("reordena «Apellidos, Nombre»", drafts.some((d) => /^José Luis García Hernández$/i.test(d.fullName)));
  check("correo en minúsculas", drafts.some((d) => d.email === "jl.garcia@empresa.mx"));
  check("no inventa el correo que falta", drafts.some((d) => /pedro/i.test(d.fullName) && d.email === ""));
  check("toma el turno como grupo", drafts.some((d) => /matutino/i.test(d.group)));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260"><rect width="100%" height="100%" fill="white"/>
    <text x="30" y="60" font-family="Arial" font-size="30" font-weight="bold">Grupo B — Generación Octubre</text>
    <text x="30" y="130" font-family="Arial" font-size="28">Sofía Mendoza Ríos — sofia.mendoza@empresa.mx</text>
    <text x="30" y="190" font-family="Arial" font-size="28">Tomás Aguilar — tomas.aguilar@empresa.mx</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const vision = await interpretStudentsVision([{ kind: "image", dataUrl: (await prepareImage(png, "lista.png")).dataUrl }], live);
  console.log("    ", JSON.stringify(vision.map(({ fullName, email, group }) => ({ fullName, email, group }))));
  check("imagen: lee las 2 personas con su correo", vision.length === 2 && vision.some((d) => d.email === "sofia.mendoza@empresa.mx"));
  check("imagen: toma el grupo del título", vision.every((d) => /grupo b/i.test(d.group)));
}

async function main() {
  chunkChecks();
  normalizeChecks();
  await aiChecks();
  await importChecks();
  if (process.argv.includes("--live")) await liveChecks();
  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ IMPORTAR ESTUDIANTES CON IA OK");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
