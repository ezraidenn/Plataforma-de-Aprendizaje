/**
 * Importar preguntas con IA, sin gastar en la API: validación compartida,
 * clave cifrada, reglas de varios archivos, extracción de texto por formato,
 * imágenes, PDF escaneados, tramos, conversión de la respuesta de OpenAI
 * (simulada) e importación.
 *
 * Uso: pnpm smoke:ai          (todo simulado)
 *      pnpm smoke:ai --live   (además, una transcripción real de texto y de una imagen si hay clave)
 */
import { questionProblem } from "../src/lib/question-validation";
import {
  AI_ACCEPT,
  MAX_AI_FILE_BYTES,
  MAX_SCANNED_PAGES,
  addAiFiles,
  aiFileKind,
  scannedTooLongMessage,
} from "../src/lib/ai-import-files";
import { decryptSecret, encryptSecret, getAiKey, getAiSettings, maskKey, testAiConnection } from "../src/server/services/ai-settings";
import { ScannedPdfError, extractText, pdfPageCount } from "../src/server/services/text-extract";
import {
  AI_SCHEMA,
  SYSTEM_PROMPT,
  interpretChunk,
  interpretVision,
  interpretVisionWithRetry,
  splitIntoChunks,
  toDrafts,
} from "../src/server/services/ai-exam-import";
import { draftProblem, draftToInput, formatGroupLines, parseGroupLines, splitDistractors, type QuestionDraft } from "../src/lib/question-draft";
import { draftToPreview } from "../src/lib/preview-question";
import { importQuestionInputs } from "../src/server/services/exam-import";
import { inputsToCsv, validateExamCsv } from "../src/server/services/exam-csv";
import { csvRepresentable, csvWritable } from "../src/lib/csv-fit";
import { eq, like } from "drizzle-orm";
import { db } from "../src/server/db";
import { auditLog, courses as coursesTable, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { prepareImage } from "../src/server/services/image-prep";

const execFileAsync = promisify(execFile);

// LibreOffice: el de .env o el de la instalación estándar de Windows
const SOFFICE_DEFAULT = "C:/Program Files/LibreOffice/program/soffice.exe";
if (!process.env.SOFFICE_PATH && fs.existsSync(SOFFICE_DEFAULT)) process.env.SOFFICE_PATH = SOFFICE_DEFAULT;
const HAS_SOFFICE = !!process.env.SOFFICE_PATH && fs.existsSync(process.env.SOFFICE_PATH);

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function validationChecks() {
  console.log("\n— Validación compartida");
  const base = { promptMd: "¿2 + 2?", points: 1 };
  check(
    "Opción única válida",
    questionProblem({ ...base, type: "single_choice", options: [{ textMd: "4", isCorrect: true }, { textMd: "5", isCorrect: false }] }) === null
  );
  check(
    "Opción única sin correcta",
    questionProblem({ ...base, type: "single_choice", options: [{ textMd: "4", isCorrect: false }, { textMd: "5", isCorrect: false }] }) ===
      "Marca exactamente una opción correcta"
  );
  check("Sin enunciado", questionProblem({ type: "open_text", promptMd: " ", points: 1 }) === "La pregunta necesita un enunciado");
  check("Ordenar con 2 pasos", questionProblem({ ...base, type: "ordering", config: { steps: ["A", "B"] } }) === "Agrega al menos tres pasos para ordenar");
}

function cryptoChecks() {
  console.log("\n— Clave cifrada");
  const enc = encryptSecret("sk-proj-abcdef1234567890");
  check("No se guarda en claro", !enc.includes("sk-proj") && !enc.includes("1234567890"));
  check("Se descifra igual", decryptSecret(enc) === "sk-proj-abcdef1234567890");
  check("Un valor alterado no se descifra", decryptSecret(enc.slice(0, -4) + "AAAA") === null);
  check("Cada cifrado es distinto (IV aleatorio)", encryptSecret("sk-x-1234567890abcdef") !== encryptSecret("sk-x-1234567890abcdef"));
  check("Se muestra enmascarada", maskKey("sk-proj-abcdef1234567890") === "••••7890");
}

function fileRuleChecks() {
  console.log("\n— Varios archivos");
  const f = (name: string, size = 1000) => ({ name, size });
  check(
    "Imagen, documento y desconocido",
    aiFileKind("Foto.JPG") === "image" && aiFileKind("examen.docx") === "doc" && aiFileKind("virus.exe") === null
  );
  const five = ["a.txt", "b.pdf", "c.png", "d.jpg", "e.docx"].map((n) => f(n));
  const first = addAiFiles([], [...five, f("g.webp")]);
  check(
    "Toma 5 y avisa del sexto",
    first.files.length === 5 && first.rejected.join() === "Máximo 5 archivos: se omitió «g.webp».",
    first.rejected
  );
  const again = addAiFiles(first.files.slice(0, 2), [
    f("a.txt"),
    f("x.heic"),
    f("big.png", MAX_AI_FILE_BYTES + 1),
    f("raro.exe"),
    f("vacio.txt", 0),
  ]);
  check("No repite el mismo archivo", again.files.length === 2, again.files);
  check(
    "Rechaza HEIC, grandes, formatos raros y vacíos con su mensaje",
    again.rejected.length === 4 &&
      again.rejected[0].includes("HEIC") &&
      again.rejected[1].includes("10 MB") &&
      again.rejected[2].includes("formato no admitido") &&
      again.rejected[3].includes("vacío"),
    again.rejected
  );
  check("El selector acepta imágenes y HEIC (para avisar)", AI_ACCEPT.includes(".png") && AI_ACCEPT.includes(".heic") && AI_ACCEPT.includes(".docx"));
  check(
    "Mensaje de PDF escaneado largo",
    scannedTooLongMessage("x.pdf", 25).includes("25 páginas") && scannedTooLongMessage("x.pdf", 25).includes(`${MAX_SCANNED_PAGES}`)
  );
}

const QUIZ_TXT = [
  "1. ¿Qué extintor se usa en fuego eléctrico?",
  "a) Agua",
  "b) CO2 (correcta)",
  "c) Espuma",
  "",
  "2. El CO2 conduce electricidad. Verdadero o falso.",
  "Respuesta: Falso",
  "",
  "3. Ordena los pasos: jalar el seguro, apuntar, presionar, barrer.",
].join("\n");

async function soffice(filter: string, file: string, outDir: string) {
  await execFileAsync(process.env.SOFFICE_PATH!, ["--headless", "--norestore", "--convert-to", filter, "--outdir", outDir, file], {
    timeout: 120_000,
    windowsHide: true,
  });
}

async function extractChecks() {
  console.log("\n— Extracción de texto");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lms-ia-prueba-"));
  try {
    const txt = path.join(dir, "examen.txt");
    fs.writeFileSync(txt, QUIZ_TXT, "utf8");
    const fromTxt = await extractText(fs.readFileSync(txt), "examen.txt");
    check("TXT: lee la primera pregunta", fromTxt.format === "text" && fromTxt.text.includes("¿Qué extintor se usa en fuego eléctrico?"));

    const csv = path.join(dir, "examen.csv");
    fs.writeFileSync(csv, "pregunta,opcion_a,opcion_b,correcta\n¿Qué extintor se usa en fuego eléctrico?,Agua,CO2,b\n¿Cuál es el número de emergencias?,911,066,a\n", "utf8");
    const fromCsv = await extractText(fs.readFileSync(csv), "examen.csv");
    check("CSV: conserva las columnas", fromCsv.format === "text" && fromCsv.text.includes("Agua,CO2,b"));

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([595, 842]);
    page.drawText("1. ¿Qué extintor se usa en fuego eléctrico?", { x: 50, y: 780, size: 12, font });
    page.drawText("a) Agua   b) CO2   c) Espuma", { x: 50, y: 760, size: 12, font });
    const fromPdf = await extractText(Buffer.from(await pdfDoc.save()), "examen.pdf");
    check("PDF: lee el texto", fromPdf.format === "pdf" && fromPdf.text.includes("extintor") && fromPdf.text.includes("Espuma"), fromPdf.text.slice(0, 120));

    // PDF escaneado: una página con solo una imagen y otra en blanco, sin texto
    const scanned = await PDFDocument.create();
    const pagePng = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#eeeeee" } }).png().toBuffer();
    const pageImage = await scanned.embedPng(pagePng);
    scanned.addPage([595, 842]).drawImage(pageImage, { x: 50, y: 500, width: 400, height: 200 });
    scanned.addPage([595, 842]);
    let scannedErr: unknown = null;
    try {
      await extractText(Buffer.from(await scanned.save()), "escaneo.pdf");
    } catch (e) {
      scannedErr = e;
    }
    check(
      "PDF sin texto: se reconoce como escaneado, con sus páginas",
      scannedErr instanceof ScannedPdfError && scannedErr.pages === 2,
      String(scannedErr)
    );

    const long = await PDFDocument.create();
    for (let i = 0; i < 21; i++) long.addPage([595, 842]);
    check("Cuenta las páginas de un PDF", (await pdfPageCount(new Uint8Array(await long.save()))) === 21);

    let formatError = "";
    try {
      await extractText(Buffer.from("MZ"), "programa.exe");
    } catch (e) {
      formatError = e instanceof Error ? e.message : String(e);
    }
    check("Formato no admitido: lo dice", formatError.includes("Formato no admitido"), formatError);

    if (HAS_SOFFICE) {
      await soffice("docx", txt, dir);
      const fromDocx = await extractText(fs.readFileSync(path.join(dir, "examen.docx")), "examen.docx");
      check("Word: lee la primera pregunta", fromDocx.format === "word" && fromDocx.text.includes("fuego eléctrico"), fromDocx.text.slice(0, 120));

      await soffice("xlsx", csv, dir);
      const fromXlsx = await extractText(fs.readFileSync(path.join(dir, "examen.xlsx")), "examen.xlsx");
      check("Excel: conserva las filas y columnas", fromXlsx.format === "sheet" && fromXlsx.text.includes("Agua") && fromXlsx.text.includes("911"), fromXlsx.text.slice(0, 160));
    } else {
      console.log("  – Word y Excel omitidos: LibreOffice no está instalado");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function imageChecks() {
  console.log("\n— Imágenes");
  // Foto «de celular»: 4000×3000 guardada acostada, con la orientación en EXIF
  const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#d0d0d0" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const prepared = await prepareImage(photo, "foto.jpg");
  check("Foto del celular: se endereza y queda de 2048 px", prepared.width === 1536 && prepared.height === 2048, prepared.width + "×" + prepared.height);
  check("Sale como JPEG en data URL", prepared.dataUrl.startsWith("data:image/jpeg;base64,"));
  const meta = await sharp(Buffer.from(prepared.dataUrl.split(",")[1], "base64")).metadata();
  check("Sin metadatos de la foto", !meta.exif && !meta.orientation, { exif: !!meta.exif, orientation: meta.orientation });

  const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const small = await prepareImage(png, "captura.png");
  check("Una captura chica no se agranda", small.width === 800 && small.height === 600, small.width + "×" + small.height);

  const gif = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ffffff" } }).gif().toBuffer();
  check("GIF: se lee", (await prepareImage(gif, "anim.gif")).width === 300);
  check("HEIC: pide JPG o PNG", (await errorOf(() => prepareImage(photo, "IMG_0001.HEIC"))).includes("HEIC"));
  check("Imagen dañada: lo dice", (await errorOf(() => prepareImage(Buffer.from("no soy imagen"), "rota.jpg"))).includes("No se pudo leer la imagen"));
}

/** Respuesta simulada de OpenAI (Responses API) con un JSON dentro. */
function fakeResponse(payload: unknown, status = 200) {
  return async () =>
    new Response(
      JSON.stringify(
        status === 200
          ? { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }] }
          : { error: { message: "fallo" } }
      ),
      { status, headers: { "Content-Type": "application/json" } }
    );
}

const SEVEN = {
  questions: [
    { type: "single_choice", prompt: "¿Extintor para fuego eléctrico?", points: 2, options: [{ text: "Agua", correct: false }, { text: "CO2", correct: true }], accepted: [], pairs: [], steps: [], issues: [] },
    { type: "multiple_choice", prompt: "Elementos del triángulo del fuego", points: null, options: [{ text: "Oxígeno", correct: true }, { text: "Calor", correct: true }, { text: "Arena", correct: false }], accepted: [], pairs: [], steps: [], issues: [] },
    { type: "true_false", prompt: "El CO2 conduce electricidad", points: null, options: [{ text: "V", correct: false }, { text: "F", correct: true }], accepted: [], pairs: [], steps: [], issues: [] },
    { type: "short_text", prompt: "Número de emergencias", points: null, options: [], accepted: ["911"], pairs: [], steps: [], issues: [] },
    { type: "matching", prompt: "Relaciona clase y extintor", points: null, options: [], accepted: [], pairs: [{ left: "Clase A", right: "Agua" }, { left: "Clase C", right: "CO2" }], steps: [], issues: [] },
    { type: "ordering", prompt: "Ordena la técnica PASS", points: null, options: [], accepted: [], pairs: [], steps: ["Jalar", "Apuntar", "Presionar", "Barrer"], issues: [] },
    { type: "open_text", prompt: "Describe la evacuación", points: 5, options: [], accepted: [], pairs: [], steps: [], issues: [] },
  ],
};

/** Clasificar y completar, con sus campos (SEVEN, sin ellos, es la respuesta de antes y debe seguir leyéndose). */
const NONE = { options: [], accepted: [], pairs: [], steps: [], groups: [], clozeText: "", clozeMode: "write", distractors: [], issues: [] };
const TWO = {
  questions: [
    { ...NONE, type: "categorize", prompt: "Clasifica los materiales", points: 3, groups: [{ name: "Clase A", cards: ["Madera", " Papel ", ""] }, { name: "Clase B", cards: ["Gasolina"] }, { name: " ", cards: [] }] },
    { ...NONE, type: "cloze", prompt: "Completa la técnica", points: null, clozeText: "Jala el [[seguro]] y apunta a la [[base]].", clozeMode: "bank", distractors: ["manguera"] },
  ],
};

async function chunkAndConvertChecks() {
  console.log("\n— Tramos y conversión");
  const questions = Array.from({ length: 40 }, (_, i) => `${i + 1}. Pregunta número ${i + 1} sobre extintores ${"con bastante texto de relleno ".repeat(22)}\na) Uno\nb) Dos\nc) Tres`);
  const text = questions.join("\n\n");
  const chunks = splitIntoChunks(text);
  check("Un texto largo se parte en varios tramos", chunks.length > 1, chunks.length);
  check("Ningún tramo pasa de 1.5 × 12 000", chunks.every((c) => c.length <= 18_000), chunks.map((c) => c.length));
  check("Cada tramo empieza con una pregunta", chunks.every((c) => /^\d{1,3}\./.test(c.trimStart())), chunks.map((c) => c.slice(0, 12)));
  check("No se pierde ni se parte ninguna pregunta", questions.every((q) => chunks.some((c) => c.includes(q))));
  check("Un texto corto queda en un solo tramo", splitIntoChunks("1. ¿Hola?\na) Sí\nb) No").length === 1);

  const drafts = toDrafts(SEVEN);
  check("Los 7 tipos se convierten", drafts.length === 7 && drafts.map((d) => d.type).join() === "single_choice,multiple_choice,true_false,short_text,matching,ordering,open_text");
  check("Los 7 quedan válidos y sin avisos", drafts.every((d) => draftProblem(d) === null && d.issues.length === 0), drafts.map((d) => [d.type, draftProblem(d), d.issues]));
  check("Puntos que no dice el documento: 1", drafts[1].points === 1 && drafts[0].points === 2);
  const tf = drafts[2];
  check("Verdadero/falso queda como «Verdadero» y «Falso» con la correcta", tf.options.map((o) => `${o.text}:${o.correct}`).join() === "Verdadero:false,Falso:true", tf.options);
  check("Cada borrador tiene su clave local", new Set(drafts.map((d) => d.key)).size === 7);

  const missing = toDrafts({ questions: [{ ...SEVEN.questions[0], options: [{ text: "Agua", correct: false }, { text: "CO2", correct: false }], issues: ["No se indica la respuesta correcta"] }] })[0];
  check("Conserva el aviso de la IA", missing.issues.includes("No se indica la respuesta correcta"));
  check("…y se calcula el problema que impide importarla", draftProblem(missing) === "Marca exactamente una opción correcta");

  const two = toDrafts(TWO);
  check("Clasificar y completar se convierten, válidos", two.map((d) => d.type).join() === "categorize,cloze" && two.every((d) => draftProblem(d) === null), two.map((d) => [d.type, draftProblem(d)]));
  check(
    "Clasificar: grupos limpios y su config con claves g1…, c1…, solo texto",
    JSON.stringify(draftToInput(two[0]).config) ===
      JSON.stringify({
        groups: [{ id: "g1", name: "Clase A" }, { id: "g2", name: "Clase B" }],
        cards: [
          { id: "c1", kind: "text", text: "Madera", groupId: "g1" },
          { id: "c2", kind: "text", text: "Papel", groupId: "g1" },
          { id: "c3", kind: "text", text: "Gasolina", groupId: "g2" },
        ],
      }),
    draftToInput(two[0]).config
  );
  check("Completar: texto, modo y distractores del banco", JSON.stringify(draftToInput(two[1]).config) === JSON.stringify({ text: "Jala el [[seguro]] y apunta a la [[base]].", mode: "bank", distractors: ["manguera"] }), draftToInput(two[1]).config);
  const odd = toDrafts({ questions: [{ ...TWO.questions[1], clozeMode: "dictado" }] })[0];
  check("Completar: un modo desconocido queda en escribir, sin distractores", odd.clozeMode === "write" && JSON.stringify(draftToInput(odd).config) === JSON.stringify({ text: "Jala el [[seguro]] y apunta a la [[base]].", mode: "write" }));
  check("La respuesta de antes (sin los campos nuevos) sigue leyéndose", drafts[0].groups.length === 0 && drafts[0].clozeText === "" && drafts[0].clozeMode === "write" && drafts[0].distractors.length === 0);
  check(
    "Revisión: los grupos como líneas «Grupo: a; b», y de vuelta",
    formatGroupLines(two[0].groups) === "Clase A: Madera; Papel\nClase B: Gasolina" &&
      JSON.stringify(parseGroupLines("Clase A: Madera; Papel\n\n Clase B : Gasolina ;\nSin tarjetas")) ===
        JSON.stringify([{ name: "Clase A", cards: ["Madera", "Papel"] }, { name: "Clase B", cards: ["Gasolina"] }, { name: "Sin tarjetas", cards: [] }])
  );
  check("Revisión: un grupo sin tarjetas lo dice", draftProblem({ ...two[0], groups: parseGroupLines("A: x; y\nB") }) === "El grupo «B» no tiene tarjetas");
  const shown = two.map(draftToPreview);
  check("Ver como alumno: las tarjetas y el banco (dos respuestas y un distractor)", shown[0].categorize?.cards.length === 3 && shown[1].cloze?.mode === "bank" && shown[1].cloze?.words?.length === 3, shown);
  check(
    "El esquema y la instrucción los piden",
    ["groups", "clozeText", "clozeMode", "distractors"].every((k) => JSON.stringify(AI_SCHEMA).includes(`"${k}"`)) &&
      SYSTEM_PROMPT.includes("- categorize: clasificar en grupos; en `groups`") &&
      SYSTEM_PROMPT.includes("- cloze: completar el texto; en `clozeText`") &&
      SYSTEM_PROMPT.includes("Si es una sola respuesta sin texto alrededor, short_text; si son huecos dentro de un texto, cloze.")
  );
  check("Revisión: los distractores se separan con «|», como en el Excel", JSON.stringify(splitDistractors(" manguera | etiqueta|")) === JSON.stringify(["manguera", "etiqueta"]));
  const piped = toDrafts({ questions: [{ ...TWO.questions[1], distractors: ["manguera|etiqueta"] }] })[0];
  check("Un distractor con «|» se marca para corregirlo", draftProblem(piped) === "Un distractor no puede llevar «|»", draftProblem(piped));

  const ok = await interpretChunk("1. ¿Hola?", { key: "sk-test", model: "gpt-x", fetchImpl: fakeResponse(SEVEN) });
  check("interpretChunk: devuelve los borradores", ok.length === 7);

  const refusal = async () =>
    new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }] }), { status: 200 });
  check("interpretChunk: una negativa se informa", (await errorOf(() => interpretChunk("x", { key: "k", model: "m", fetchImpl: refusal }))).includes("se negó"));
  check("interpretChunk: clave inválida", (await errorOf(() => interpretChunk("x", { key: "k", model: "m", fetchImpl: fakeResponse({}, 401) }))).includes("rechazó la clave"));
  const broken = async () =>
    new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "{no es json" }] }] }), { status: 200 });
  check("interpretChunk: JSON roto se marca como mal formado", (await errorOf(() => interpretChunk("x", { key: "k", model: "m", fetchImpl: broken }))).includes("mal formada"));

  // El esquema cumple las reglas de «strict»
  const problems: string[] = [];
  const walk = (node: Record<string, unknown>, at: string) => {
    if (node.type === "object" || (Array.isArray(node.type) && node.type.includes("object"))) {
      const props = Object.keys((node.properties as object) ?? {});
      const required = (node.required as string[]) ?? [];
      if (node.additionalProperties !== false) problems.push(`${at}: falta additionalProperties:false`);
      if (props.some((p) => !required.includes(p))) problems.push(`${at}: no todo es required`);
      for (const [k, v] of Object.entries((node.properties as Record<string, Record<string, unknown>>) ?? {})) walk(v, `${at}.${k}`);
    }
    if (node.items) walk(node.items as Record<string, unknown>, `${at}[]`);
  };
  walk(AI_SCHEMA as unknown as Record<string, unknown>, "raíz");
  check("El esquema cumple «strict» (additionalProperties y required)", problems.length === 0, problems);
}

async function visionChecks() {
  console.log("\n— Lectura de imágenes y PDF escaneados");
  type Sent = { input?: { role: string; content: unknown }[]; text?: { format?: { strict?: boolean } } };
  let sent: Sent = {};
  const capture: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body)) as Sent;
    return fakeResponse(SEVEN)();
  };
  const img = await prepareImage(await sharp({ create: { width: 900, height: 600, channels: 3, background: "#ffffff" } }).png().toBuffer(), "hoja.png");

  const drafts = await interpretVision(
    [
      { kind: "image", dataUrl: img.dataUrl },
      { kind: "image", dataUrl: img.dataUrl },
    ],
    { key: "sk-test", model: "gpt-x", fetchImpl: capture }
  );
  check("Imágenes: devuelve los borradores", drafts.length === 7);
  const content = sent.input?.[1]?.content as { type: string; text?: string; image_url?: string; detail?: string }[];
  check("Imágenes: el mensaje dice cuántas y en orden", content?.[0]?.type === "input_text" && /2 imágenes, en orden/.test(content[0].text ?? ""), content?.[0]);
  check(
    "Imágenes: van como input_image JPEG con detalle alto",
    content?.length === 3 && content.slice(1).every((c) => c.type === "input_image" && c.image_url?.startsWith("data:image/jpeg;base64,") && c.detail === "high"),
    content?.map((c) => c.type)
  );
  check("Mismo esquema estricto y el mismo prompt de sistema", sent.text?.format?.strict === true && sent.input?.[0]?.role === "system");

  const pdfUrl = `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`;
  await interpretVision([{ kind: "pdf", fileName: "escaneo.pdf", dataUrl: pdfUrl }], { key: "sk-test", model: "gpt-x", fetchImpl: capture });
  const pdfContent = sent.input?.[1]?.content as { type: string; text?: string; filename?: string; file_data?: string }[];
  check(
    "PDF escaneado: va como input_file con su nombre",
    pdfContent?.[1]?.type === "input_file" && pdfContent[1].filename === "escaneo.pdf" && pdfContent[1].file_data === pdfUrl,
    pdfContent?.map((c) => c.type)
  );
  check("PDF escaneado: el mensaje lo dice", /PDF escaneado/.test(pdfContent?.[0]?.text ?? ""));

  let calls = 0;
  const flaky: typeof fetch = async () =>
    ++calls === 1
      ? new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "{roto" }] }] }), { status: 200 })
      : fakeResponse(SEVEN)();
  const retried = await interpretVisionWithRetry([{ kind: "image", dataUrl: img.dataUrl }], { key: "k", model: "m", fetchImpl: flaky });
  check("Respuesta mal formada: reintenta una vez", retried.length === 7 && calls === 2, calls);

  await interpretChunk("1. ¿Hola?", { key: "k", model: "m", fetchImpl: capture });
  check("Texto: sigue mandándose como texto plano", sent.input?.[1]?.content === "1. ¿Hola?");
}

const PREFIX = "Curso demo — Importar con IA";

function importChecks() {
  console.log("\n— Importación común");
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
  for (const c of db.select().from(coursesTable).where(like(coursesTable.title, `${PREFIX}%`)).all()) courses.deleteCourse(c.id);
  const course = courses.createCourse({ ownerId: teacher.id, title: PREFIX });
  const exam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: "Examen IA" });

  const drafts = toDrafts(SEVEN);
  const inputs = drafts.slice(0, 3).map(draftToInput);
  const invalid = draftToInput(toDrafts({ questions: [{ ...SEVEN.questions[0], options: [{ text: "Agua", correct: false }, { text: "CO2", correct: false }] }] })[0]);

  const appended = importQuestionInputs({ actorId: teacher.id, examItemId: exam.id, inputs: [...inputs, invalid], mode: "append", source: "ai" });
  check("Agregar: 3 importadas y 1 omitida", appended.imported === 3 && appended.skipped === 1, appended);

  const replaced = importQuestionInputs({ actorId: teacher.id, examItemId: exam.id, inputs: drafts.slice(3, 5).map(draftToInput), mode: "replace", source: "ai" });
  check("Reemplazar: quedan solo las 2 nuevas", replaced.imported === 2 && examsSvc.listQuestions(exam.id).length === 2, replaced);

  let noneError = "";
  try {
    importQuestionInputs({ actorId: teacher.id, examItemId: exam.id, inputs: [invalid], mode: "replace", source: "ai" });
  } catch (e) {
    noneError = e instanceof Error ? e.message : String(e);
  }
  check("Reemplazar sin válidas: error y no se borra nada", noneError.includes("No hay preguntas válidas") && examsSvc.listQuestions(exam.id).length === 2, noneError);

  const csv = inputsToCsv([...drafts, ...toDrafts(TWO)].map(draftToInput));
  const back = validateExamCsv(csv);
  check("CSV desde borradores: las 9 filas son válidas", back.ok === 9 && back.invalid === 0, { ok: back.ok, invalid: back.invalid, rows: back.rows.filter((r) => r.status !== "ok") });

  // Borradores a medio corregir: justo los que el maestro quiere arreglar en Excel. Van al
  // CSV con lo que tengan (antes se perdían sin aviso) y, al volver, su fila dice qué falta
  const needsFix = toDrafts({
    questions: [
      { ...NONE, type: "categorize", prompt: "Clasifica (un grupo sin tarjetas)", points: 2, groups: [{ name: "Frutas", cards: ["Manzana", "Pera"] }, { name: "Verduras", cards: [] }] },
      { ...NONE, type: "cloze", prompt: "Completa (lista sin incorrectas)", points: 1, clozeText: "El agua hierve a [[100]] grados.", clozeMode: "select" },
      { ...NONE, type: "cloze", prompt: "Completa (sin huecos)", points: 1, clozeText: "Todavía sin huecos.", clozeMode: "write" },
    ],
  });
  const fixInputs = needsFix.map(draftToInput);
  check("Borradores a medio corregir: no se pueden importar, pero sí escribir en el CSV",
    needsFix.length === 3 && needsFix.every((d) => draftProblem(d) !== null) && fixInputs.every((q) => !csvRepresentable(q) && csvWritable(q)),
    needsFix.map((d) => draftProblem(d)));
  const fixCsv = inputsToCsv(fixInputs);
  const fixBack = validateExamCsv(fixCsv);
  check("…van al CSV con lo que tienen y su fila dice qué falta (el mensaje del editor)",
    fixBack.rows.length === 3 && fixBack.invalid === 3 &&
      fixCsv.includes("Frutas: Manzana; Pera | Verduras: ") && fixCsv.includes("Todavía sin huecos.") &&
      fixBack.rows.map((r) => r.message).join(" | ") ===
        "El grupo «Verduras» no tiene tarjetas | Al hueco 1 le falta al menos una opción incorrecta (!opción) | Marca al menos un hueco con [[ ]]",
    fixBack.rows.map((r) => r.message));
  check("…y como ninguno va sobre imagen ni lleva íconos, no se omite ninguno (el aviso de omitidos no sale)",
    [...drafts, ...toDrafts(TWO), ...needsFix].map(draftToInput).every(csvWritable));

  const logged = db.select().from(auditLog).where(eq(auditLog.entityId, exam.id)).all();
  const first = logged.find((r) => (r.detail as { mode?: string } | null)?.mode === "append");
  check(
    "Auditoría «ai_import_exam» con modo, importadas y omitidas",
    logged.length === 2 && logged.every((r) => r.action === "ai_import_exam") && JSON.stringify(first?.detail) === JSON.stringify({ mode: "append", imported: 3, skipped: 1, kept: 0 }),
    logged.map((r) => [r.action, r.detail])
  );

  const twoImported = importQuestionInputs({ actorId: teacher.id, examItemId: exam.id, inputs: toDrafts(TWO).map(draftToInput), mode: "append", source: "ai" });
  const types = examsSvc.listQuestions(exam.id).map((q) => q.type);
  check("Clasificar y completar de la IA se importan", twoImported.imported === 2 && types.slice(-2).join() === "categorize,cloze", types);

  // Sin rastro en la bitácora del admin: solo los registros de este examen de prueba
  db.delete(auditLog).where(eq(auditLog.entityId, exam.id)).run();
  cleanupSmokeNotifications([course.id]);
  courses.deleteCourse(course.id);
}

/** Un examen corto con los 7 tipos, para la prueba real contra OpenAI. */
const LIVE_TXT = [
  "1. ¿Qué extintor se usa en fuego eléctrico?",
  "a) Agua  b) CO2 (correcta)  c) Espuma",
  "2. ¿Cuáles forman el triángulo del fuego? (varias correctas)",
  "a) Oxígeno ✔  b) Calor ✔  c) Arena  d) Combustible ✔",
  "3. El CO2 conduce electricidad. Verdadero o falso. Respuesta: Falso",
  "4. ¿Qué número marcas en una emergencia en México? Respuesta: 911",
  "5. Relaciona: Clase A → Agua; Clase B → Espuma; Clase C → CO2",
  "6. Ordena los pasos de la técnica PASS: 1) Jalar el seguro 2) Apuntar a la base 3) Presionar la palanca 4) Barrer de lado a lado",
  "7. Describe con tus palabras cómo evacuarías tu área. (respuesta abierta)",
].join("\n");

/** Solo con --live: una transcripción real con la clave guardada en Configuración. */
async function liveChecks() {
  console.log("\n— OpenAI real (--live)");
  // La clave se cifró con el APP_SECRET del .env (el que usa el servidor)
  const envFile = path.join(process.cwd(), ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const settings = getAiSettings();
  const key = getAiKey();
  if (settings.unreadable) {
    check("La clave guardada se puede leer", false, "APP_SECRET distinto al del servidor: vuelve a guardar la clave");
    return;
  }
  if (!key) {
    console.log("  (no hay clave configurada en Administración → Configuración: se omite)");
    return;
  }
  console.log(`  modelo ${settings.model}, clave ${settings.masked}`);
  const test = await testAiConnection(key, settings.model);
  check("Probar conexión", "ok" in test, test);
  if (!("ok" in test)) return;

  const started = Date.now();
  let drafts: Awaited<ReturnType<typeof interpretChunk>> = [];
  try {
    drafts = await interpretChunk(LIVE_TXT, { key, model: settings.model });
  } catch (e) {
    check("La IA responde", false, e instanceof Error ? e.message : String(e));
    return;
  }
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  const expected = ["single_choice", "multiple_choice", "true_false", "short_text", "matching", "ordering", "open_text"];
  check("Transcribe las 7 preguntas", drafts.length === 7, drafts.map((d) => d.type));
  check("Con el tipo correcto cada una", JSON.stringify(drafts.map((d) => d.type)) === JSON.stringify(expected), drafts.map((d) => d.type));
  const problems = drafts.map((d) => draftProblem(d)).filter(Boolean);
  check("Ninguna necesita corrección", problems.length === 0, problems);
  const single = drafts.find((d) => d.type === "single_choice");
  check("Opción única: CO2 es la correcta", single?.options.find((o) => o.correct)?.text.includes("CO2") === true, single?.options);
  const ordering = drafts.find((d) => d.type === "ordering");
  check("Ordenar: 4 pasos, «Jalar el seguro» primero", ordering?.steps.length === 4 && /jalar/i.test(ordering.steps[0] ?? ""), ordering?.steps);

  // Una imagen con preguntas escritas (generada con sharp), leída por la API real
  const lines = [
    "1. ¿Qué extintor se usa en fuego eléctrico?",
    "a) Agua   b) CO2 (correcta)   c) Espuma",
    "2. El CO2 conduce electricidad. Respuesta: Falso",
    "3. Ordena los pasos: 1) Jalar el seguro 2) Apuntar a la base 3) Presionar la palanca 4) Barrer",
  ];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="330"><rect width="100%" height="100%" fill="#fff"/>` +
    lines.map((l, i) => `<text x="30" y="${60 + i * 70}" font-family="Arial, sans-serif" font-size="30" fill="#111">${l}</text>`).join("") +
    `</svg>`;
  const sheet = await prepareImage(await sharp(Buffer.from(svg)).png().toBuffer(), "examen.png");
  const t0 = Date.now();
  let fromImage: QuestionDraft[] = [];
  try {
    fromImage = await interpretVision([{ kind: "image", dataUrl: sheet.dataUrl }], { key, model: settings.model });
  } catch (e) {
    check("Imagen: la IA responde", false, e instanceof Error ? e.message : String(e));
    return;
  }
  console.log(`  (imagen: ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  check(
    "Imagen: lee las 3 preguntas con su tipo",
    JSON.stringify(fromImage.map((d) => d.type)) === JSON.stringify(["single_choice", "true_false", "ordering"]),
    fromImage.map((d) => d.type)
  );
  check("Imagen: CO2 es la correcta", fromImage[0]?.options.find((o) => o.correct)?.text.includes("CO2") === true, fromImage[0]?.options);
}

async function main() {
  validationChecks();
  cryptoChecks();
  fileRuleChecks();
  await extractChecks();
  await imageChecks();
  await chunkAndConvertChecks();
  await visionChecks();
  importChecks();
  if (process.argv.includes("--live")) await liveChecks();

  // exitCode y no process.exit(): en Windows (Node 24), salir a la fuerza
  // justo después de un fetch real revienta libuv (UV_HANDLE_CLOSING)
  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ IMPORTAR CON IA OK");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
