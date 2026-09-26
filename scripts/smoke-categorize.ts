/**
 * «Clasificar en grupos»: validación, puntaje, CSV y saneo (puro), y el
 * recorrido contra la base (guardar, la vista previa del maestro, lo que
 * recibe el alumno sin la respuesta, calificar, revisar). Datos con prefijo
 * «zcat», borrados al final.
 *
 * Uso: pnpm smoke:categorize
 */
import { Readable } from "node:stream";
import sharp from "sharp";
import { eq, inArray, like, or } from "drizzle-orm";
import { db } from "../src/server/db";
import { auditLog, courses as coursesTable, files, notifications, questions, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import * as answers from "../src/server/services/exam-answers";
import { boardAnswerSummary, buildReview } from "../src/server/services/exam-review";
import { countNotInCsv, exportExamCsv, importExamCsv, validateExamCsv } from "../src/server/services/exam-csv";
import { parseCsv } from "../src/server/services/csv-core";
import { csvRepresentable } from "../src/lib/csv-fit";
import { deleteFile, getFileRecord, saveStream } from "../src/server/services/storage";
import { contentDisposition } from "../src/lib/inline-mime";
import { neutralImageName } from "../src/lib/image-processing";
import { buildRunnerQuestions } from "../src/components/student/lesson-data";
import { questionsToPreview } from "../src/lib/preview-question";
import { questionProblem } from "../src/lib/question-validation";
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import {
  MAX_CARDS,
  categorizeBoard,
  categorizeCardView,
  categorizeCsvRepresentable,
  categorizeFileIds,
  categorizeHits,
  categorizeProblem,
  categorizeScore,
  categorizeSolutionText,
  categorizeView,
  formatGroupsCsv,
  parseGroupsCsv,
  readCategorize,
  sanitizeCategorize,
  type CategorizeConfig,
} from "../src/lib/categorize";
import { initialCategorizeValue, newCategorizeId } from "../src/lib/categorize-editor-value";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const C: CategorizeConfig = {
  groups: [{ id: "g1", name: "Frutas" }, { id: "g2", name: "Verduras" }],
  cards: [
    { id: "c1", kind: "text", text: "Manzana", groupId: "g1" },
    { id: "c2", kind: "text", text: "Pera", groupId: "g1" },
    { id: "c3", kind: "text", text: "Zanahoria", groupId: "g2" },
    { id: "c4", kind: "icon", fileId: "f-apio", ratio: 1, groupId: "g2" },
  ],
};

function pureChecks() {
  console.log("\n— Validación");
  check("Válida", categorizeProblem(C) === null, categorizeProblem(C));
  check("Config ilegible", categorizeProblem(null) === "Configura los grupos y las tarjetas");
  check("Un solo grupo", categorizeProblem({ ...C, groups: [C.groups[0]], cards: C.cards.filter((c) => c.groupId === "g1") }) === "Crea al menos dos grupos");
  check("Siete grupos", categorizeProblem({ groups: Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, name: `G${i}` })), cards: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, kind: "text" as const, text: `T${i}`, groupId: `g${i}` })) }) === "Usa como máximo seis grupos");
  check("Grupo sin nombre", categorizeProblem({ ...C, groups: [{ id: "g1", name: " " }, C.groups[1]] }) === "Hay un grupo sin nombre");
  check("Nombres repetidos", categorizeProblem({ ...C, groups: [C.groups[0], { id: "g2", name: "frutas" }] }) === "Hay dos grupos con el mismo nombre");
  check("Grupo vacío", categorizeProblem({ ...C, cards: C.cards.filter((c) => c.groupId === "g1") }) === "El grupo «Verduras» no tiene tarjetas");
  check("Tarjeta de un grupo que no existe", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "X", groupId: "g9" }] }) === "Hay una tarjeta de un grupo que ya no existe");
  check("Tarjeta sin texto", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "", groupId: "g1" }] }) === "Hay una tarjeta sin texto");
  check("Ícono sin archivo", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "icon", groupId: "g1" }] }) === "Hay una tarjeta sin imagen");
  check("Tarjetas que se ven igual", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "manzana", groupId: "g2" }] }) === "Hay dos tarjetas iguales: el alumno no las distinguiría");
  check("Demasiadas tarjetas", categorizeProblem({ ...C, cards: Array.from({ length: MAX_CARDS + 1 }, (_, i) => ({ id: `c${i}`, kind: "text" as const, text: `T${i}`, groupId: i % 2 ? "g1" : "g2" })) }) === `Usa como máximo ${MAX_CARDS} tarjetas`);
  check("Texto de tarjeta largo", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "x".repeat(81), groupId: "g1" }] }) === "Las tarjetas deben tener como máximo 80 caracteres");

  console.log("\n— Puntaje");
  check("Todo bien: 1", categorizeScore(C, { c1: "g1", c2: "g1", c3: "g2", c4: "g2" }) === 1);
  check("Parcial por tarjeta", categorizeScore(C, { c1: "g1", c2: "g2", c3: "g2" }) === 0.5);
  check("Nada puesto: 0", categorizeScore(C, {}) === 0);
  check("Aciertos por tarjeta, en su orden", categorizeHits(C, { c1: "g1", c2: "g2", c3: "g2" }).join() === "true,false,true,false");

  console.log("\n— CSV");
  check("Solo texto cabe en el CSV", !categorizeCsvRepresentable(C) && categorizeCsvRepresentable({ ...C, cards: C.cards.slice(0, 3) }));
  const text = formatGroupsCsv({ ...C, cards: C.cards.slice(0, 3) });
  check("Formatear grupos", text === "Frutas: Manzana; Pera | Verduras: Zanahoria", text);
  const back = parseGroupsCsv(text);
  check("Leer grupos", !("error" in back) && back.groups.length === 2 && back.cards.length === 3 && back.cards[2].groupId === back.groups[1].id, back);
  check("Leer grupos: sin «:» es error", "error" in parseGroupsCsv("Frutas Manzana | Verduras: Zanahoria"));
  check("Leer grupos: formato tolerante a espacios", !("error" in parseGroupsCsv("  Frutas :Manzana ;  Pera|Verduras:Zanahoria ")));
  check("Cabe en el CSV: solo texto sí; con un ícono, o sobre imagen, no; lo demás, siempre",
    csvRepresentable({ type: "categorize", config: { ...C, cards: C.cards.slice(0, 3) } }) && !csvRepresentable({ type: "categorize", config: C }) &&
      !csvRepresentable({ type: "categorize", config: null }) && !csvRepresentable({ type: "image_drag", config: {} }) &&
      csvRepresentable({ type: "cloze", config: null }) && csvRepresentable({ type: "open_text" }));
  // Una fila de «clasificar» con error dice qué falta, con los mismos textos que el editor
  const row = (grupos: string) => validateExamCsv(`tipo,pregunta,puntos,grupos\r\nclasificar,Clasifica,1,"${grupos}"`).rows[0];
  check("Fila sin grupos: lo dice", row("").status === "invalid" && row("").message.includes('"grupos"'), row("").message);
  check("Fila con grupos sin «:»: el formato", row("Frutas Manzana | Verduras: Zanahoria").message.includes("Grupo: tarjeta"), row("Frutas Manzana | Verduras: Zanahoria").message);
  check("Fila con un solo grupo: «Crea al menos dos grupos»", row("Frutas: Manzana; Pera").message === "Crea al menos dos grupos", row("Frutas: Manzana; Pera").message);
  check("Fila con un grupo vacío: lo nombra", row("Frutas: Manzana; Pera | Verduras:").message === "El grupo «Verduras» no tiene tarjetas", row("Frutas: Manzana; Pera | Verduras:").message);
  check("Fila buena: lista, con su etiqueta", row("Frutas: Manzana | Verduras: Zanahoria").status === "ok" && row("Frutas: Manzana | Verduras: Zanahoria").typeLabel === "Clasificar en grupos");

  console.log("\n— Saneo");
  const s = sanitizeCategorize({ groups: [{ id: "g1", name: " Frutas ", x: 1 }], cards: [{ id: "c1", kind: "icon", fileId: "f", text: "no", ratio: 2, groupId: "g1" }, { id: "c2", kind: "text", text: " Pera ", fileId: "x", groupId: "g1" }] }) as CategorizeConfig;
  check("Saneo: recorta, quita lo que no corresponde a cada clase", JSON.stringify(s) === JSON.stringify({ groups: [{ id: "g1", name: "Frutas" }], cards: [{ id: "c1", kind: "icon", fileId: "f", ratio: 2, groupId: "g1" }, { id: "c2", kind: "text", text: "Pera", groupId: "g1" }] }), s);

  console.log("\n— Lectura, vista del alumno, tablero y solución");
  check("Leer: la válida tal cual; la incompleta, null", readCategorize({ config: C }) === C && readCategorize({ config: { ...C, groups: [] } }) === null);
  check("Validación de la pregunta completa: usa la de clasificar",
    questionProblem({ type: "categorize", promptMd: "¿?", points: 1, config: { ...C, cards: [] } }) === "Agrega al menos dos tarjetas" &&
      questionProblem({ type: "categorize", promptMd: "¿?", points: 1, config: C }) === null);
  check("Cara de una tarjeta: sin id ni grupo",
    JSON.stringify(categorizeCardView(C.cards[0])) === '{"kind":"text","text":"Manzana"}' &&
      JSON.stringify(categorizeCardView(C.cards[3])) === '{"kind":"icon","fileId":"f-apio","ratio":1}');
  const reversed = <T,>(items: T[]) => [...items].reverse();
  const view = categorizeView(C, { group: (id) => `G:${id}`, card: (id) => `K:${id}` }, reversed);
  check("Vista: grupos en su orden con su ficha y nombre", JSON.stringify(view.groups) === '[{"token":"G:g1","name":"Frutas"},{"token":"G:g2","name":"Verduras"}]', view.groups);
  check("Vista: tarjetas revueltas con su ficha, sin grupo", view.cards.map((k) => k.token).join() === "K:c4,K:c3,K:c2,K:c1" && !JSON.stringify(view).includes("groupId"), view.cards);
  const solution = categorizeBoard(C);
  check("Tablero sin respuesta = la solución: cada tarjeta en su grupo, nada sin poner",
    solution.groups.map((g) => `${g.name}:${g.cards.map((k) => k.view.text ?? k.view.fileId).join("+")}`).join("|") === "Frutas:Manzana+Pera|Verduras:Zanahoria+f-apio" &&
      solution.groups.every((g) => g.cards.every((k) => k.correct && !k.expectedGroup)) && solution.unplaced.length === 0, solution);
  const mine = categorizeBoard(C, { c1: "g1", c2: "g2", c4: "g9" });
  check("Tablero con respuesta: lo puesto, si acertó, a dónde iba y lo que quedó sin poner",
    JSON.stringify(mine) ===
      JSON.stringify({
        kind: "categorize",
        groups: [
          { name: "Frutas", cards: [{ view: { kind: "text", text: "Manzana" }, correct: true }] },
          { name: "Verduras", cards: [{ view: { kind: "text", text: "Pera" }, correct: false, expectedGroup: "Frutas" }] },
        ],
        unplaced: [
          { view: { kind: "text", text: "Zanahoria" }, expectedGroup: "Verduras" },
          { view: { kind: "icon", fileId: "f-apio", ratio: 1 }, expectedGroup: "Verduras" },
        ],
      }),
    mine);
  check("Solución en texto, con los íconos numerados", categorizeSolutionText(C) === "Frutas: Manzana, Pera · Verduras: Zanahoria, Ícono 1", categorizeSolutionText(C));

  console.log("\n— Editor");
  const fresh = initialCategorizeValue(null);
  check("Pregunta nueva: dos grupos vacíos, sin tarjetas", fresh.groups.length === 2 && fresh.groups.every((g) => g.name === "") && fresh.cards.length === 0 && fresh.groups[0].id !== fresh.groups[1].id, fresh);
  check("Abrir lo guardado: tal cual", JSON.stringify(initialCategorizeValue(C)) === JSON.stringify(C), initialCategorizeValue(C));
  const messy = initialCategorizeValue({
    groups: [{ id: "g1", name: "A" }, { id: "g1", name: "B" }, { name: "sin clave" }, { id: "g2" }],
    cards: [{ id: "c1", kind: "text", text: "x", groupId: "g1" }, { id: "c2", kind: "text", text: "y", groupId: "nada" }, { id: "c3", kind: "icon", groupId: "g2" }],
  });
  check("Abrir: sin grupos repetidos ni tarjetas de grupos que no existen o sin archivo",
    JSON.stringify(messy) === JSON.stringify({ groups: [{ id: "g1", name: "A" }, { id: "g2", name: "" }], cards: [{ id: "c1", kind: "text", text: "x", groupId: "g1" }] }), messy);
  const id = newCategorizeId("c", [{ id: "c1" }]);
  check("Clave nueva: con su prefijo y distinta", /^c[a-z0-9]+$/.test(id) && id !== "c1" && id.length <= 64, id);
}

// ─── Recorrido contra la base ────────────────────────────────────────────────

const P = "zcat";
const email = (key: string) => `${P}-${key}@test.local`;
// Ids de grupo y de tarjeta inconfundibles: si aparecen en lo que recibe el
// alumno, es que se filtró a qué grupo va cada tarjeta
const G = { fr: "zcatGrupoFrutas", ve: "zcatGrupoVerduras" };
const K = { man: "zcatTarjetaManzana", per: "zcatTarjetaPera", zan: "zcatTarjetaZanahoria", api: "zcatTarjetaApio" };

function makeUser(key: string, role: "teacher" | "student" | "admin", createdBy: string | null): string {
  const id = `${P}-${key}-${Date.now().toString(36)}`;
  db.insert(users).values({ id, email: email(key), passwordHash: "x", fullName: `${P} ${key}`, role, createdBy }).run();
  return id;
}

async function upload(color: { r: number; g: number; b: number }, name: string, userId: string, kind: "editor_image" | "attachment" = "editor_image") {
  const bytes = await sharp({ create: { width: 40, height: 60, channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer();
  const { id } = await saveStream({ stream: Readable.from(bytes), originalName: `${P}-${name}.png`, mimeType: "image/png", kind, uploadedBy: userId });
  return id;
}

/** Borra todo lo zcat: cursos (en cascada, preguntas e intentos), avisos, auditoría, archivos y cuentas. */
async function cleanupDb() {
  const userIds = db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%@test.local`)).all().map((u) => u.id);
  const courseIds = db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P} %`)).all().map((c) => c.id);
  cleanupSmokeNotifications(courseIds);
  // Sin deleteCourse: encolaría el retiro de archivos para el worker; aquí se borran a mano
  if (courseIds.length) db.delete(coursesTable).where(inArray(coursesTable.id, courseIds)).run();
  if (userIds.length) {
    db.delete(notifications).where(inArray(notifications.userId, userIds)).run();
    db.delete(auditLog).where(inArray(auditLog.userId, userIds)).run();
  }
  // Los archivos van después de las preguntas (las apuntan) y antes de las cuentas (quien los subió)
  const fileIds = db
    .select({ id: files.id })
    .from(files)
    .where(or(like(files.originalName, `${P}-%`), userIds.length ? inArray(files.uploadedBy, userIds) : undefined))
    .all()
    .map((f) => f.id);
  for (const id of fileIds) await deleteFile(id);
  if (userIds.length) db.delete(users).where(inArray(users.id, userIds)).run();
}

/** Un curso con un examen de una sola pregunta, publicado y con el alumno inscrito (cada examen en su curso: la secuencia obligatoria bloquearía el segundo). */
function examWith(teacher: string, student: string, title: string, config: unknown, points: number) {
  const course = courses.createCourse({ ownerId: teacher, title: `${P} ${title}` });
  const exam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: `${P} Examen ${title}` });
  const qId = examsSvc.createQuestion(exam.id, { type: "categorize", promptMd: "Clasifica cada alimento", points, config });
  courses.publishCourse(course.id);
  courses.enrollStudents(course.id, [student], teacher);
  return { course, exam, qId };
}

async function endToEnd() {
  console.log("\n— Recorrido contra la base");
  await cleanupDb(); // restos de una corrida que se cortó
  try {
    const teacher = makeUser("maestro", "teacher", null);
    const other = makeUser("otro", "teacher", null);
    const student = makeUser("alumno", "student", teacher);
    const iconApio = await upload({ r: 60, g: 180, b: 60 }, "apio", teacher);
    const otherIcon = await upload({ r: 10, g: 10, b: 10 }, "ajeno", other);
    const notEditor = await upload({ r: 10, g: 10, b: 200 }, "adjunto", teacher, "attachment");

    const config: CategorizeConfig = {
      groups: [{ id: G.fr, name: "Frutas" }, { id: G.ve, name: "Verduras" }],
      cards: [
        { id: K.man, kind: "text", text: "Manzana", groupId: G.fr },
        { id: K.per, kind: "text", text: "Pera", groupId: G.fr },
        { id: K.zan, kind: "text", text: "Zanahoria", groupId: G.ve },
        { id: K.api, kind: "icon", fileId: iconApio, ratio: 1.5, groupId: G.ve },
      ],
    };
    const withIcon = (fileId: string): CategorizeConfig => ({ ...config, cards: config.cards.map((k) => (k.kind === "icon" ? { ...k, fileId } : k)) });

    // Guardar: lo que manda el navegador pasa por el saneo y la validación; los íconos, por la comprobación de archivos
    const raw = { ...config, extra: "x", cards: config.cards.map((k) => ({ ...k, text: k.text ? ` ${k.text} ` : undefined, sobra: 1 })) };
    const saved = sanitizeCategorize(raw);
    check("Guardar: el saneo deja la config limpia y válida", JSON.stringify(saved) === JSON.stringify(config) && questionProblem({ type: "categorize", promptMd: "¿?", points: 1, config: saved }) === null, saved);
    const u = { id: teacher, role: "teacher" };
    const filesProblem = (user: { id: string; role: string }, cfg: CategorizeConfig, questionId?: string) =>
      examsSvc.questionFilesProblem(user, { type: "categorize", imageFileId: null, config: cfg }, questionId);
    check("Archivos: cada tarjeta de ícono nombra su archivo", JSON.stringify(categorizeFileIds(config)) === JSON.stringify([iconApio]) && categorizeFileIds(null).length === 0);
    check("Archivos: los íconos propios valen", filesProblem(u, config) === null);
    check("Archivos: un ícono de otro maestro no", filesProblem(u, withIcon(otherIcon)) === "Una de las imágenes no es válida; vuelve a subirla.");
    check("Archivos: un archivo que no es imagen del editor no", filesProblem(u, withIcon(notEditor)) !== null);
    check("Archivos: un id inventado no", filesProblem(u, withIcon("no-existe")) !== null);
    check("Archivos: el admin puede usar cualquiera", filesProblem({ id: "admin", role: "admin" }, withIcon(otherIcon)) === null);
    check("Archivos: solo texto, nada que revisar", filesProblem({ id: "nadie", role: "teacher" }, { ...config, cards: config.cards.slice(0, 3) }) === null);
    check("Archivos: cada tipo revisa lo que usa su config (completar no tiene archivos)",
      examsSvc.questionFilesProblem(u, { type: "cloze", config: withIcon(otherIcon) }) === null);

    // Servir un ícono: el alumno conoce su id, así que su nombre original («zcat-apio.png») no debe salir
    const iconRecord = getFileRecord(iconApio)!;
    const attachmentRecord = getFileRecord(notEditor)!;
    check("Servir: el ícono se ve sin su nombre original",
      iconRecord.kind === "editor_image" && contentDisposition(iconRecord, true) === 'inline; filename="imagen.png"', contentDisposition(iconRecord, true));
    check("Servir: …y al descargarlo tampoco", contentDisposition(iconRecord, false) === 'attachment; filename="imagen.png"' && !contentDisposition(iconRecord, false).includes("apio"));
    check("Servir: una imagen del editor de tipo raro, sin nombre", contentDisposition({ ...iconRecord, mimeType: "application/octet-stream" }, false) === "attachment");
    check("Servir: los demás archivos conservan su nombre", contentDisposition(attachmentRecord, false) === `attachment; filename*=UTF-8''${encodeURIComponent(`${P}-adjunto.png`)}`, contentDisposition(attachmentRecord, false));
    const neutral = [neutralImageName("icono", "image/png"), neutralImageName("icono", "image/jpeg"), neutralImageName("foto", "", "verduras-apio.WEBP")];
    check("Subir: los íconos y fotos del editor llevan un nombre neutro",
      /^icono-[a-z0-9]+\.png$/.test(neutral[0]) && /^icono-[a-z0-9]+\.jpg$/.test(neutral[1]) && /^foto-[a-z0-9]+\.webp$/.test(neutral[2]) && neutral[0] !== neutralImageName("icono", "image/png"),
      neutral);

    const main = examWith(teacher, student, "Clasificar", config, 3);
    check("Al editar, los íconos que la pregunta ya tenía siguen valiendo", filesProblem({ id: other, role: "teacher" }, config, main.qId) === null);
    check("…sin la pregunta, no", filesProblem({ id: other, role: "teacher" }, config) !== null);
    let invalid = "";
    try {
      examsSvc.createQuestion(main.exam.id, { type: "categorize", promptMd: "Mal", points: 1, config: { ...config, groups: [config.groups[0]] } });
    } catch (e) {
      invalid = (e as Error).message;
    }
    check("Guardar una incompleta se niega con el mensaje del editor", invalid === "Crea al menos dos grupos", invalid);

    // «Ver como alumno» del maestro: fichas locales, la solución en texto y como tablero
    const [pv] = questionsToPreview(examsSvc.listQuestions(main.exam.id));
    check("Vista previa: grupos y tarjetas, sin grupo por tarjeta",
      pv?.categorize?.groups.length === 2 && pv.categorize.cards.length === 4 && !JSON.stringify(pv.categorize).includes("groupId") && pv.cloze === null, pv?.categorize);
    check("Vista previa: la solución en texto y como tablero",
      pv?.answerText === "Frutas: Manzana, Pera · Verduras: Zanahoria, Ícono 1" && pv.answerBoard?.kind === "categorize" && pv.answerBoard.unplaced.length === 0 && !pv.solution, pv);

    // ─── Lo que recibe el alumno ───────────────────────────────────────────────
    const attempt = examsSvc.startAttempt({ courseId: main.course.id, studentId: student, examItemId: main.exam.id });
    const runner = buildRunnerQuestions(attempt);
    const json = JSON.stringify(runner);
    const rq = runner.find((q) => q.id === main.qId)!;
    check("El alumno no recibe groupId", !json.includes("groupId"));
    check("…ni los ids de los grupos ni de las tarjetas", [...Object.values(G), ...Object.values(K)].every((id) => !json.includes(id)), [...Object.values(G), ...Object.values(K)].filter((id) => json.includes(id)));
    check("…ni la configuración", !json.includes("config") && !json.includes('"cards":[{"id"'));
    check("Grupos en su orden, con su nombre y una ficha opaca",
      rq.categorize?.groups.map((g) => g.name).join() === "Frutas,Verduras" && rq.categorize.groups.every((g) => /^[0-9a-f]{16}$/.test(g.token)), rq.categorize?.groups);
    // Lista blanca: una clave nueva en las tarjetas debe pensarse (¿delata algo?) y agregarse aquí
    check("Cada tarjeta trae solo su cara y su ficha",
      rq.categorize?.cards.length === 4 &&
        rq.categorize.cards.every((k) => Object.keys(k).sort().join() === (k.kind === "icon" ? "fileId,kind,ratio,token" : "kind,text,token") && /^[0-9a-f]{16}$/.test(k.token)),
      rq.categorize?.cards);
    const allTokens = [...(rq.categorize?.groups ?? []), ...(rq.categorize?.cards ?? [])].map((t) => t.token);
    check("Fichas distintas", new Set(allTokens).size === 6, allTokens);
    check("Las demás claves quedan en null", rq.cloze === null && rq.imageDrag === null && rq.imageClick === null && rq.matching === null && rq.ordering === null && rq.image === null);

    // ─── Calificar: mitad bien ─────────────────────────────────────────────────
    const card = (id: string) => answers.categorizeCardToken(attempt.id, main.qId, id);
    const group = (id: string) => answers.categorizeGroupToken(attempt.id, main.qId, id);
    check("Las fichas calculadas son las que recibió el alumno",
      Object.values(K).every((id) => rq.categorize!.cards.some((k) => k.token === card(id))) && Object.values(G).every((id) => rq.categorize!.groups.some((g) => g.token === group(id))));
    // Manzana y Zanahoria bien; Pera en Verduras (mal); Apio sin poner; una ficha inventada y un id de grupo no cuentan
    const answer = { [card(K.man)]: group(G.fr), [card(K.per)]: group(G.ve), [card(K.zan)]: group(G.ve), "0123456789abcdef": group(G.fr) };
    const placed = answers.categorizePlacement(config, JSON.stringify({ ...answer, [card(K.api)]: G.ve }), attempt.id, main.qId);
    check("Colocación: por cada tarjeta, su grupo; lo inventado no cuenta",
      JSON.stringify({ ...placed }) === JSON.stringify({ [K.man]: G.fr, [K.per]: G.ve, [K.zan]: G.ve }), placed);
    check("Colocación: una respuesta ilegible no pone nada", Object.keys(answers.categorizePlacement(config, "{no json", attempt.id, main.qId)).length === 0);
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: main.qId, answerText: JSON.stringify(answer) });
    const graded = examsSvc.submitAttempt({ courseId: main.course.id, studentId: student, attemptId: attempt.id });
    check("Calificado: 2 de 4 tarjetas de 3 puntos = 1.5", graded.status === "graded" && graded.finalScore === 1.5, { status: graded.status, score: graded.finalScore });

    // ─── Revisión ──────────────────────────────────────────────────────────────
    const [entry] = buildReview(graded);
    check("Revisión: texto, solución y resultado parcial",
      entry.yourAnswer === "2 de 4 tarjetas bien" && entry.correctAnswer === "Frutas: Manzana, Pera · Verduras: Zanahoria, Ícono 1" &&
        entry.result === "partial" && entry.earnedPoints === 1.5 && !entry.board, entry);
    const b = entry.answerBoard?.kind === "categorize" ? entry.answerBoard : null;
    check("Revisión: tablero con lo puesto, si acertó y a dónde iba cada tarjeta",
      !!b &&
        JSON.stringify(b.groups) ===
          JSON.stringify([
            { name: "Frutas", cards: [{ view: { kind: "text", text: "Manzana" }, correct: true }] },
            {
              name: "Verduras",
              cards: [
                { view: { kind: "text", text: "Pera" }, correct: false, expectedGroup: "Frutas" },
                { view: { kind: "text", text: "Zanahoria" }, correct: true },
              ],
            },
          ]) &&
        JSON.stringify(b.unplaced) === JSON.stringify([{ view: { kind: "icon", fileId: iconApio, ratio: 1.5 }, expectedGroup: "Verduras" }]),
      b);
    const qRow = examsSvc.listQuestions(main.exam.id)[0];
    check("El maestro al calificar lee el mismo resumen", boardAnswerSummary(qRow, JSON.stringify(answer), attempt.id) === "2 de 4 tarjetas bien");
    check("Resumen: «{}» o una respuesta de otro intento se leen «Sin respuesta»",
      boardAnswerSummary(qRow, "{}", attempt.id) === "Sin respuesta" && boardAnswerSummary(qRow, JSON.stringify(answer), "otro-intento") === "Sin respuesta");

    // ─── Config inválida: vale 0 sin tumbar el envío ──────────────────────────
    const broken = examWith(teacher, student, "Rota", config, 2);
    const brokenAttempt = examsSvc.startAttempt({ courseId: broken.course.id, studentId: student, examItemId: broken.exam.id });
    const brokenCard = (id: string) => answers.categorizeCardToken(brokenAttempt.id, broken.qId, id);
    const brokenGroup = (id: string) => answers.categorizeGroupToken(brokenAttempt.id, broken.qId, id);
    examsSvc.saveAnswer({ studentId: student, attemptId: brokenAttempt.id, questionId: broken.qId, answerText: JSON.stringify({ [brokenCard(K.man)]: brokenGroup(G.fr) }) });
    // Algo guardado mal (a mano, fuera del editor): sin grupos
    db.update(questions).set({ config: { ...config, groups: [] } }).where(eq(questions.id, broken.qId)).run();
    check("Config inválida: el alumno no la recibe", buildRunnerQuestions(brokenAttempt)[0]?.categorize === null);
    const brokenGraded = examsSvc.submitAttempt({ courseId: broken.course.id, studentId: student, attemptId: brokenAttempt.id });
    check("Config inválida: el envío pasa y vale 0", brokenGraded.status === "graded" && brokenGraded.finalScore === 0, { status: brokenGraded.status, score: brokenGraded.finalScore });
    const [brokenEntry] = buildReview(brokenGraded);
    check("Config inválida: la revisión dice «Sin respuesta», sin tablero", brokenEntry.yourAnswer === "Sin respuesta" && !brokenEntry.answerBoard && brokenEntry.result === "incorrect", brokenEntry);

    // ─── Duplicar: la config viaja y los íconos se comparten ──────────────────
    const copyId = examsSvc.duplicateQuestion(main.exam.id, main.qId);
    const copied = examsSvc.listQuestions(main.exam.id).find((q) => q.id === copyId);
    check("Duplicar: la copia trae la misma config", JSON.stringify(copied?.config) === JSON.stringify(config) && copied?.imageFileId === null);

    // ─── CSV: con un ícono no cabe (se cuenta, se omite y se conserva); solo texto, ida y vuelta ─
    check("CSV: las de ícono se cuentan como que no caben", countNotInCsv(main.exam.id) === 2, countNotInCsv(main.exam.id));
    check("CSV: exportar las omite", parseCsv(exportExamCsv(main.exam.id), { maxRows: 10 }).rows.length === 0);
    const textOnly: CategorizeConfig = { ...config, cards: config.cards.slice(0, 3) };
    const textId = examsSvc.createQuestion(main.exam.id, { type: "categorize", promptMd: `${P} Solo texto`, points: 2, config: textOnly });
    // Entre las dos de ícono, para ver que cada una vuelve a su lugar
    examsSvc.reorderQuestions(main.exam.id, [main.qId, textId, copyId]);
    check("CSV: la de solo texto sí cabe", countNotInCsv(main.exam.id) === 2 && csvRepresentable({ type: "categorize", config: textOnly }));
    const csv = exportExamCsv(main.exam.id);
    const sheet = parseCsv(csv, { maxRows: 10 });
    const cell = (name: string) => sheet.rows[0]?.cells[sheet.headers.indexOf(name)];
    check("CSV: sale como «clasificar» con sus grupos", sheet.rows.length === 1 && cell("tipo") === "clasificar" && cell("puntos") === "2" && cell("grupos") === "Frutas: Manzana; Pera | Verduras: Zanahoria", sheet.rows);
    const back = validateExamCsv(csv);
    const backConfig = back.rows[0]?.input?.config as CategorizeConfig | undefined;
    check("CSV: vuelve igual, con claves nuevas g1…, c1…",
      back.ok === 1 && back.rows[0].typeLabel === "Clasificar en grupos" && !!backConfig &&
        categorizeSolutionText(backConfig) === categorizeSolutionText(textOnly) &&
        backConfig.groups.map((g) => g.id).join() === "g1,g2" && backConfig.cards.map((k) => `${k.id}:${k.groupId}`).join() === "c1:g1,c2:g1,c3:g2",
      back.rows);
    const replaced = importExamCsv({ actorId: teacher, examItemId: main.exam.id, csvText: csv, mode: "replace" });
    const afterReplace = examsSvc.listQuestions(main.exam.id);
    check("CSV: «reemplazar» conserva las de ícono en su lugar y cambia la de texto por la del archivo",
      replaced.kept === 2 && replaced.imported === 1 && afterReplace.length === 3 &&
        afterReplace[0].id === main.qId && afterReplace[2].id === copyId &&
        afterReplace[1].id !== textId && afterReplace[1].promptMd === `${P} Solo texto` && csvRepresentable(afterReplace[1]),
      { replaced, order: afterReplace.map((q) => q.promptMd) });
  } finally {
    await cleanupDb();
    const left =
      db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%@test.local`)).all().length +
      db.select({ id: files.id }).from(files).where(like(files.originalName, `${P}-%`)).all().length +
      db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P} %`)).all().length;
    check("Limpieza: no quedan cuentas, archivos ni cursos zcat", left === 0, left);
  }
}

async function main() {
  pureChecks();
  await endToEnd();
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
