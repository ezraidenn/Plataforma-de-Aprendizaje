/**
 * Preguntas sobre imagen (arrastrar y señalar): matemática pura, validación y
 * el recorrido completo contra la base (guardar, lo que recibe el alumno,
 * calificar, revisar). Datos con prefijo «zimg», borrados al final.
 *
 * Uso: pnpm smoke:image
 */
import { Readable } from "node:stream";
import sharp from "sharp";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../src/server/db";
import { attemptAnswers, auditLog, courses as coursesTable, files, notifications, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import { buildReview } from "../src/server/services/exam-review";
import { exportExamCsv, countImageQuestions } from "../src/server/services/exam-csv";
import { importQuestionInputs } from "../src/server/services/exam-import";
import { parseCsv } from "../src/server/services/csv-core";
import { deleteFile, saveStream } from "../src/server/services/storage";
import { buildRunnerQuestions } from "../src/components/student/lesson-data";
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import {
  PRECISION_RADIUS,
  SNAP_RADIUS,
  dragCopies,
  imageClickHits,
  imageClickProblem,
  imageClickScore,
  imageDragProblem,
  imageDragScore,
  nearestZone,
  parseClickAnswer,
  parseDragAnswer,
  isImageQuestionType,
  readImageClick,
  readImageDrag,
  relDistance,
  sanitizeImageConfig,
  type ImageClickConfig,
  type ImageDragConfig,
} from "../src/lib/image-questions";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const DRAG: ImageDragConfig = {
  aspect: 0.75,
  iconSize: "md",
  elements: [
    { id: "ext", kind: "icon", fileId: "f-ext" },
    { id: "sal", kind: "icon", fileId: "f-sal" },
    { id: "reu", kind: "text", text: "Punto de reunión" },
    { id: "reg", kind: "text", text: "Regadera" }, // distractor: sin lugar
  ],
  zones: [
    { x: 0.2, y: 0.3, elementId: "ext" },
    { x: 0.6, y: 0.3, elementId: "ext" },
    { x: 0.9, y: 0.8, elementId: "sal" },
    { x: 0.3, y: 0.8, elementId: "reu" },
  ],
};

const CLICK: ImageClickConfig = { aspect: 0.5, precision: "md", spots: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.6 }] };

function mathChecks() {
  console.log("\n— Matemática");
  const copies = dragCopies(DRAG);
  check("Copias: el extintor va dos veces, los demás una, el distractor una", copies.length === 5 &&
    copies.filter((c) => c.elementId === "ext").length === 2 &&
    copies.filter((c) => c.elementId === "reg").length === 1, copies);

  check("Todo bien puesto: 1", imageDragScore(DRAG, ["ext", "ext", "sal", "reu"]) === 1);
  check("Un distractor cuenta como error", imageDragScore(DRAG, ["reg", "ext", "sal", "reu"]) === 0.75);
  check("Lugar vacío cuenta cero", imageDragScore(DRAG, [undefined, "ext", undefined, "reu"]) === 0.5);
  check("Sin lugares: 0", imageDragScore({ ...DRAG, zones: [] }, []) === 0);

  check("Distancia corrige la proporción", Math.abs(relDistance({ x: 0, y: 0 }, { x: 0, y: 1 }, 0.5) - 0.5) < 1e-9);
  const r = PRECISION_RADIUS.md;
  check("Marca dentro del radio acierta", imageClickScore(CLICK, [{ x: 0.2 + r * 0.9, y: 0.2 }, { x: 0.8, y: 0.6 }]) === 1);
  check("Marca fuera del radio no acierta", imageClickScore(CLICK, [{ x: 0.2 + r * 1.2, y: 0.2 }, { x: 0.8, y: 0.6 }]) === 0.5);
  check("Dos marcas en el mismo punto solo acreditan uno", imageClickScore(CLICK, [{ x: 0.2, y: 0.2 }, { x: 0.21, y: 0.2 }]) === 0.5);
  check("Marcas de más se ignoran", imageClickScore(CLICK, [{ x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 0.2, y: 0.2 }]) === 0);
  check("Sin marcas: 0", imageClickScore(CLICK, []) === 0);
  check("Aciertos por punto", JSON.stringify(imageClickHits(CLICK, [{ x: 0.8, y: 0.6 }, { x: 0, y: 0 }])) === "[false,true]");
  // Emparejamiento: la marca A alcanza los dos puntos, la B solo el primero; con
  // reparto ingenuo A se queda el primero y B no suma. Bien hecho, suman los dos.
  const NEAR: ImageClickConfig = { aspect: 1, precision: "lg", spots: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }] };
  check("Emparejamiento máximo", imageClickScore(NEAR, [{ x: 0.55, y: 0.5 }, { x: 0.45, y: 0.5 }]) === 1);

  const zones = DRAG.zones.map(({ x, y }) => ({ x, y }));
  check("Encaje: la sombra más cercana dentro del radio", nearestZone(zones, { x: 0.22, y: 0.31 }, DRAG.aspect, () => true) === 0);
  check("Encaje: lejos de todas, ninguna", nearestZone(zones, { x: 0.45, y: 0.55 }, DRAG.aspect, () => true) === null);
  check("Encaje: salta las ocupadas", nearestZone(zones, { x: 0.22, y: 0.31 }, DRAG.aspect, (i) => i !== 0) === null);
  check("Radio de encaje razonable", SNAP_RADIUS > 0 && SNAP_RADIUS < 0.2);

  check("Respuesta de arrastre ilegible: vacía", Object.keys(parseDragAnswer("{no json")).length === 0);
  check("Respuesta de arrastre solo con textos", JSON.stringify(parseDragAnswer('{"a":"b","c":3}')) === '{"a":"b"}');
  check("Respuesta de clic: recorta al máximo y descarta basura", parseClickAnswer('[{"x":0.1,"y":0.2},{"x":"a","y":1},{"x":0.5,"y":0.5},{"x":0.9,"y":0.9}]', 2).length === 2);
  check("Respuesta de clic: fuera de 0–1 se descarta", parseClickAnswer('[{"x":1.5,"y":0.2}]', 5).length === 0);
}

function validationChecks() {
  console.log("\n— Validación");
  check("Arrastre válido", imageDragProblem(DRAG, true) === null, imageDragProblem(DRAG, true));
  check("Sin foto", imageDragProblem(DRAG, false) === "Sube la foto de la pregunta");
  check("Sin lugares", imageDragProblem({ ...DRAG, zones: [] }, true) === "Coloca al menos un elemento en la foto");
  check("Ícono sin archivo", imageDragProblem({ ...DRAG, elements: [...DRAG.elements, { id: "x", kind: "icon" }] }, true) === "Hay un ícono sin imagen");
  check("Texto vacío", imageDragProblem({ ...DRAG, elements: [...DRAG.elements, { id: "y", kind: "text", text: "  " }] }, true) === "Hay una etiqueta sin texto");
  check("Lugar de un elemento que no existe", imageDragProblem({ ...DRAG, zones: [{ x: 0.1, y: 0.1, elementId: "nada" }] }, true) !== null);
  check("Coordenadas fuera de la foto", imageDragProblem({ ...DRAG, zones: [{ x: 1.2, y: 0.1, elementId: "ext" }] }, true) !== null);
  check("Demasiados elementos", imageDragProblem({ ...DRAG, elements: Array.from({ length: 21 }, (_, i) => ({ id: `e${i}`, kind: "text" as const, text: "t" })) }, true) !== null);
  check("Config ilegible", imageDragProblem(null, true) !== null);
  const odd = (e: unknown) => {
    try {
      return imageDragProblem({ ...DRAG, elements: [...DRAG.elements, e] }, true);
    } catch {
      return "lanzó";
    }
  };
  check("Etiqueta con texto que no es texto: problema, sin lanzar", odd({ id: "n", kind: "text", text: 123 }) === "Hay una etiqueta sin texto", odd({ id: "n", kind: "text", text: 123 }));
  check("Ícono con archivo que no es texto: problema, sin lanzar", odd({ id: "m", kind: "icon", fileId: 5 }) === "Hay un ícono sin imagen", odd({ id: "m", kind: "icon", fileId: 5 }));
  check("Señalar válido", imageClickProblem(CLICK, true) === null, imageClickProblem(CLICK, true));
  check("Señalar sin puntos", imageClickProblem({ ...CLICK, spots: [] }, true) === "Marca al menos un punto en la foto");
  check("Señalar con 11 puntos", imageClickProblem({ ...CLICK, spots: Array.from({ length: 11 }, () => ({ x: 0.5, y: 0.5 })) }, true) === "Usa como máximo diez puntos");
  check("Proporción inválida", imageClickProblem({ ...CLICK, aspect: 0 }, true) !== null);
}

function sanitizeChecks() {
  console.log("\n— Lo que llega del navegador");
  const long = "x".repeat(65);
  const raw = {
    aspect: 0.75,
    iconSize: "md",
    isCorrect: true, // basura: no se guarda
    elements: [
      { id: "ext", kind: "icon", fileId: "f-ext", text: "no va", extra: 1 },
      { id: "reu", kind: "text", text: "  Punto de reunión  ", fileId: "no-va" },
      { id: long, kind: "text", text: "id largo" },
    ],
    zones: [
      { x: 0.2, y: 0.3, elementId: "ext", correct: "reu" },
      { x: Infinity, y: NaN, elementId: 7 },
    ],
  };
  const clean = sanitizeImageConfig("image_drag", raw) as ImageDragConfig & Record<string, unknown>;
  check("Descarta los campos desconocidos", !("isCorrect" in clean) && !("extra" in clean.elements[0]) && !("correct" in clean.zones[0]));
  check("El ícono pierde su texto; la etiqueta, su archivo", !("text" in clean.elements[0]) && !("fileId" in clean.elements[1]), clean.elements);
  check("Recorta el texto de la etiqueta", clean.elements[1].text === "Punto de reunión");
  check("Ids de más de 64 caracteres fuera", !("id" in clean.elements[2]));
  check("Números no finitos y ids que no son texto fuera", JSON.stringify(clean.zones[1]) === "{}", clean.zones[1]);
  check("Lo limpio de una config buena queda igual", JSON.stringify(sanitizeImageConfig("image_drag", DRAG)) === JSON.stringify(DRAG));
  check("Señalar: solo proporción, precisión y puntos",
    JSON.stringify(sanitizeImageConfig("image_click", { ...CLICK, spots: [{ x: 0.1, y: 0.2, z: 3 }], precision: "xl", hint: "aquí" })) ===
      JSON.stringify({ aspect: 0.5, spots: [{ x: 0.1, y: 0.2 }] }));
  check("Basura total: queda vacía y la validación la rechaza",
    JSON.stringify(sanitizeImageConfig("image_click", "hola")) === '{"spots":[]}' && imageClickProblem(sanitizeImageConfig("image_click", "hola"), true) !== null);

  check("Leer arrastrar: completa", readImageDrag({ imageFileId: "foto", config: DRAG })?.image === "foto");
  check("Leer arrastrar: sin foto, null", readImageDrag({ imageFileId: null, config: DRAG }) === null);
  check("Leer arrastrar: config dañada, null", readImageDrag({ imageFileId: "foto", config: { ...DRAG, zones: "x" } }) === null);
  check("Leer señalar: completa y sin foto", readImageClick({ imageFileId: "foto", config: CLICK })?.config === CLICK && readImageClick({ imageFileId: null, config: CLICK }) === null);
}

// ─── Recorrido contra la base ────────────────────────────────────────────────

const P = "zimg";
const email = (key: string) => `${P}-${key}@test.local`;
// Ids de elemento y coordenadas de puntos inconfundibles: si aparecen en lo que
// recibe el alumno, es que se filtró la solución
const EL = { ext: "zimgElExtintor", sal: "zimgElSalida", reu: "zimgElReunion", reg: "zimgElRegadera" };
const SPOTS = [
  { x: 0.237, y: 0.614 },
  { x: 0.781, y: 0.352 },
];

function makeUser(key: string, role: "teacher" | "student" | "admin", createdBy: string | null): string {
  const id = `${P}-${key}-${Date.now().toString(36)}`;
  db.insert(users).values({ id, email: email(key), passwordHash: "x", fullName: `${P} ${key}`, role, createdBy }).run();
  return id;
}

async function png(color: { r: number; g: number; b: number }, width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer();
}

async function upload(bytes: Buffer, name: string, userId: string, kind: "editor_image" | "attachment" = "editor_image") {
  const { id } = await saveStream({
    stream: Readable.from(bytes),
    originalName: `${P}-${name}.png`,
    mimeType: "image/png",
    kind,
    uploadedBy: userId,
  });
  return id;
}

/** Borra todo lo zimg: cursos (en cascada, preguntas e intentos), avisos, archivos y cuentas. */
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

async function endToEnd() {
  console.log("\n— Recorrido contra la base");
  await cleanupDb(); // restos de una corrida que se cortó
  try {
    const teacher = makeUser("maestro", "teacher", null);
    const other = makeUser("otro", "teacher", null);
    const student = makeUser("alumno", "student", teacher);

    const photo = await upload(await png({ r: 90, g: 160, b: 90 }, 400, 300), "foto", teacher);
    const iconExt = await upload(await png({ r: 220, g: 40, b: 40 }), "extintor", teacher);
    const iconSal = await upload(await png({ r: 40, g: 160, b: 60 }), "salida", teacher);
    const otherPhoto = await upload(await png({ r: 10, g: 10, b: 10 }), "ajena", other);
    const notEditor = await upload(await png({ r: 10, g: 10, b: 200 }), "adjunto", teacher, "attachment");

    const drag: ImageDragConfig = {
      aspect: 0.75,
      iconSize: "md",
      elements: [
        { id: EL.ext, kind: "icon", fileId: iconExt },
        { id: EL.sal, kind: "icon", fileId: iconSal },
        { id: EL.reu, kind: "text", text: "Punto de reunión" },
        { id: EL.reg, kind: "text", text: "Regadera" }, // distractor
      ],
      zones: [
        { x: 0.2, y: 0.3, elementId: EL.ext },
        { x: 0.6, y: 0.3, elementId: EL.ext },
        { x: 0.9, y: 0.8, elementId: EL.sal },
        { x: 0.3, y: 0.8, elementId: EL.reu },
      ],
    };
    const click: ImageClickConfig = { aspect: 0.5, precision: "md", spots: SPOTS };

    const u = { id: teacher, role: "teacher" };
    check("Archivos: los suyos valen", examsSvc.imageQuestionFilesProblem(u, photo, drag) === null);
    check("Archivos: una foto de otro maestro no", examsSvc.imageQuestionFilesProblem(u, otherPhoto, drag) === "Una de las imágenes no es válida; vuelve a subirla.");
    check("Archivos: un ícono de otro maestro no", examsSvc.imageQuestionFilesProblem(u, photo, { ...drag, elements: [{ id: "x", kind: "icon", fileId: otherPhoto }] }) !== null);
    check("Archivos: un archivo que no es imagen del editor no", examsSvc.imageQuestionFilesProblem(u, notEditor, drag) !== null);
    check("Archivos: un id inventado no", examsSvc.imageQuestionFilesProblem(u, "no-existe", drag) !== null);
    check("Archivos: el admin puede usar cualquiera", examsSvc.imageQuestionFilesProblem({ id: "admin", role: "admin" }, otherPhoto, drag) === null);

    const course = courses.createCourse({ ownerId: teacher, title: `${P} Preguntas sobre imagen` });
    const exam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: `${P} Examen` });
    let noPhoto = "";
    try {
      examsSvc.createQuestion(exam.id, { type: "image_drag", promptMd: "Sin foto", points: 1, config: drag, imageFileId: null });
    } catch (e) {
      noPhoto = (e as Error).message;
    }
    check("Guardar sin foto se niega", noPhoto === "Sube la foto de la pregunta", noPhoto);
    const qDrag = examsSvc.createQuestion(exam.id, { type: "image_drag", promptMd: "Coloca cada señal", points: 4, config: drag, imageFileId: photo });
    const qClick = examsSvc.createQuestion(exam.id, { type: "image_click", promptMd: "Señala los extintores", points: 2, config: click, imageFileId: photo });
    check("Al editar, los archivos que la pregunta ya tenía siguen valiendo", examsSvc.imageQuestionFilesProblem({ id: other, role: "teacher" }, photo, drag, qDrag) === null);
    check("…sin la pregunta, no", examsSvc.imageQuestionFilesProblem({ id: other, role: "teacher" }, photo, drag) !== null);
    courses.publishCourse(course.id);
    courses.enrollStudents(course.id, [student], teacher);

    const attempt = examsSvc.startAttempt({ courseId: course.id, studentId: student, examItemId: exam.id });
    const runner = buildRunnerQuestions(attempt);
    const json = JSON.stringify(runner);
    const rd = runner.find((q) => q.id === qDrag)!;
    const rc = runner.find((q) => q.id === qClick)!;
    check("El alumno no recibe elementId", !json.includes("elementId"));
    check("…ni los ids de los elementos", Object.values(EL).every((id) => !json.includes(id)), Object.values(EL).filter((id) => json.includes(id)));
    check("…ni los puntos correctos", !json.includes("spots") && SPOTS.every((s) => !json.includes(String(s.x)) && !json.includes(String(s.y))));
    check("…ni la configuración", !json.includes("config") && !json.includes("precision"));
    check("Arrastrar: 5 fichas en el banco y 4 lugares", rd.imageDrag?.items.length === 5 && rd.imageDrag?.zones.length === 4, { items: rd.imageDrag?.items.length, zones: rd.imageDrag?.zones.length });
    check("Arrastrar: lleva la foto, la proporción y el tamaño", rd.image === photo && rd.imageDrag?.aspect === 0.75 && rd.imageDrag?.iconSize === "md");
    check("Arrastrar: fichas opacas y distintas", new Set([...rd.imageDrag!.zones, ...rd.imageDrag!.items].map((t) => t.token)).size === 9 &&
      [...rd.imageDrag!.zones, ...rd.imageDrag!.items].every((t) => /^[0-9a-f]{16}$/.test(t.token)));
    check("Arrastrar: los lugares no traen tamaño ni elemento", rd.imageDrag!.zones.every((z) => Object.keys(z).sort().join() === "token,x,y"));
    check("Señalar: solo la foto y cuántas marcas", rc.image === photo && JSON.stringify(rc.imageClick) === JSON.stringify({ aspect: 0.5, marks: 2 }));
    check("Las demás claves nuevas quedan en null", rd.imageClick === null && rc.imageDrag === null && rd.matching === null && rd.ordering === null);

    // Respuesta correcta calculada con las mismas fichas que el servidor, con
    // los dos extintores cruzados (copia 1 en el primer lugar, copia 0 en el
    // segundo): da igual qué copia vaya en cuál
    const [z0, z1, z2, z3] = drag.zones.map((_, i) => examsSvc.imageZoneToken(attempt.id, qDrag, i));
    const item = (elementId: string, copy: number) => examsSvc.imageItemToken(attempt.id, qDrag, elementId, copy);
    const ext0 = item(EL.ext, 0);
    const answer: Record<string, string> = { [z0]: item(EL.ext, 1), [z1]: ext0, [z2]: item(EL.sal, 0), [z3]: item(EL.reu, 0) };
    check("Las fichas de la respuesta están en lo que recibe el alumno",
      Object.entries(answer).every(([z, it]) => rd.imageDrag!.zones.some((x) => x.token === z) && rd.imageDrag!.items.some((x) => x.token === it)));

    // La misma ficha en dos lugares solo cuenta una vez; una ficha inventada no cuenta
    const twice = examsSvc.imageDragPlacement(drag, JSON.stringify({ [z0]: ext0, [z1]: ext0, [z2]: answer[z2], [z3]: answer[z3] }), attempt.id, qDrag);
    check("La misma ficha en dos lugares cuenta una vez", imageDragScore(drag, twice) === 0.75, twice);
    const forged = examsSvc.imageDragPlacement(drag, JSON.stringify({ [z0]: "0123456789abcdef", [z1]: EL.ext }), attempt.id, qDrag);
    check("Fichas inventadas o ids de elemento no cuentan", forged.every((p) => p === undefined), forged);

    const r = PRECISION_RADIUS.md;
    const marks = [
      { x: SPOTS[0].x + r * 0.5, y: SPOTS[0].y }, // dentro del radio
      { x: SPOTS[1].x + r * 3, y: SPOTS[1].y }, // fuera
    ];
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: qDrag, answerText: JSON.stringify(answer) });
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: qClick, answerText: JSON.stringify(marks) });
    const graded = examsSvc.submitAttempt({ courseId: course.id, studentId: student, attemptId: attempt.id });
    check("Calificado: 4 de 4 en arrastrar + 1 de 2 en señalar = 5", graded.status === "graded" && graded.finalScore === 5, { status: graded.status, score: graded.finalScore });

    const review = buildReview(graded);
    const vd = review.find((e) => e.questionId === qDrag)!;
    const vc = review.find((e) => e.questionId === qClick)!;
    check("Revisión de arrastrar: texto", vd.yourAnswer === "4 de 4 lugares correctos" && vd.correctAnswer === "Mira la imagen con la solución" && vd.result === "correct", vd);
    const bd = vd.board?.kind === "drag" ? vd.board : null;
    check("Revisión de arrastrar: tablero con cada lugar bien y la solución",
      !!bd && bd.image === photo && bd.zones.length === 4 && bd.zones.every((z) => z.correct && z.placed !== null) &&
      bd.zones[0].expected.fileId === iconExt && bd.zones[3].expected.text === "Punto de reunión", bd);
    check("Revisión de señalar: texto", vc.yourAnswer === "1 de 2 puntos señalados" && vc.result === "partial" && vc.earnedPoints === 1, vc);
    const bc = vc.board?.kind === "click" ? vc.board : null;
    check("Revisión de señalar: puntos acertados y marcas",
      !!bc && bc.radius === r && JSON.stringify(bc.spots.map((s) => s.hit)) === "[true,false]" && bc.marks.length === 2, bc);

    // Una respuesta sin ninguna colocación válida se lee como «Sin respuesta», igual que en señalar
    db.update(attemptAnswers)
      .set({ answerText: JSON.stringify({ [z0]: "0123456789abcdef" }) })
      .where(and(eq(attemptAnswers.attemptId, attempt.id), eq(attemptAnswers.questionId, qDrag)))
      .run();
    const empty = buildReview(graded).find((e) => e.questionId === qDrag)!;
    check("Revisión de arrastrar sin colocaciones válidas: «Sin respuesta»",
      empty.yourAnswer === "Sin respuesta" && empty.board?.kind === "drag" && empty.board.zones.every((z) => z.placed === null), empty);

    const copyId = examsSvc.duplicateQuestion(exam.id, qDrag);
    const copied = examsSvc.listQuestions(exam.id).find((q) => q.id === copyId);
    check("Duplicar dentro del examen comparte la foto", copied?.imageFileId === photo && JSON.stringify(copied?.config) === JSON.stringify(drag));

    // ─── Copiar la lección/examen: la foto y los íconos se comparten (Tarea 3) ─
    const examCopy = await tree.duplicateItem({
      sourceItemId: exam.id,
      targetCourseId: course.id,
      parentId: null,
      index: 99,
      uploadedBy: teacher,
    });
    const copiedQs = examsSvc.listQuestions(examCopy.item.id);
    const copiedDrag = copiedQs.find((q) => q.type === "image_drag" && q.promptMd === "Coloca cada señal");
    const copiedClick = copiedQs.find((q) => q.type === "image_click");
    check("Copiar el examen: la copia tiene las 3 preguntas (arrastrar, señalar y su copia)", copiedQs.length === 3, copiedQs.length);
    check("Copiar el examen: arrastrar conserva la foto y la config", copiedDrag?.imageFileId === photo && JSON.stringify(copiedDrag?.config) === JSON.stringify(drag), copiedDrag);
    check("Copiar el examen: señalar conserva la foto y la config", copiedClick?.imageFileId === photo && JSON.stringify(copiedClick?.config) === JSON.stringify(click), copiedClick);
    check("Copiar el examen: el alumno puede ver la copia de arrastrar (readImageDrag no nulo)", !!copiedDrag && readImageDrag(copiedDrag) !== null);
    check("Copiar el examen: el alumno puede ver la copia de señalar (readImageClick no nulo)", !!copiedClick && readImageClick(copiedClick) !== null);
    check("Copiar el examen: no faltó ningún archivo", examCopy.missingFiles === 0, examCopy.missingFiles);

    // La copia a OTRO curso del mismo maestro también comparte la foto
    const course2 = courses.createCourse({ ownerId: teacher, title: `${P} Curso destino` });
    const examCopy2 = await tree.duplicateItem({
      sourceItemId: exam.id,
      targetCourseId: course2.id,
      parentId: null,
      index: 0,
      uploadedBy: teacher,
    });
    const copiedQs2 = examsSvc.listQuestions(examCopy2.item.id);
    check("Copiar a otro curso también comparte la foto", copiedQs2.length === 3 && copiedQs2.every((q) => q.imageFileId === photo), copiedQs2.map((q) => q.imageFileId));

    // ─── CSV: las preguntas sobre imagen no caben — se omiten y se cuentan ────
    check("countImageQuestions cuenta las 3 preguntas sobre imagen", countImageQuestions(exam.id) === 3, countImageQuestions(exam.id));
    const csvExport = exportExamCsv(exam.id);
    check("exportExamCsv las omite (CSV sin filas)", parseCsv(csvExport, { maxRows: 10 }).rows.length === 0, csvExport);

    // ─── Reemplazar por CSV: borra solo lo que el CSV puede representar ───────
    examsSvc.createQuestion(exam.id, {
      type: "single_choice",
      promptMd: `${P} Pregunta de opción`,
      points: 1,
      options: [
        { textMd: "A", isCorrect: true },
        { textMd: "B", isCorrect: false },
      ],
    });
    const csvWithChoice = parseCsv(exportExamCsv(exam.id), { maxRows: 10 });
    check(
      "exportExamCsv con una pregunta exportable: exactamente 1 fila opcion_unica",
      csvWithChoice.rows.length === 1 && csvWithChoice.rows[0].cells[0] === "opcion_unica",
      csvWithChoice.rows
    );
    check("Antes de reemplazar: 4 preguntas (3 de imagen + 1 de opción)", examsSvc.listQuestions(exam.id).length === 4);
    const replaced = importQuestionInputs({
      actorId: teacher,
      examItemId: exam.id,
      inputs: [
        {
          type: "single_choice",
          promptMd: `${P} Pregunta nueva`,
          points: 2,
          options: [
            { textMd: "X", isCorrect: true },
            { textMd: "Y", isCorrect: false },
          ],
        },
      ],
      mode: "replace",
      source: "csv",
    });
    check("Reemplazar conserva las 3 preguntas sobre imagen (kept)", replaced.kept === 3, replaced);
    check("Reemplazar importa la nueva sin saltarse ninguna", replaced.imported === 1 && replaced.skipped === 0, replaced);
    const afterReplace = examsSvc.listQuestions(exam.id);
    check("Después de reemplazar: 4 preguntas (3 de imagen + la nueva)", afterReplace.length === 4, afterReplace.length);
    check("La pregunta de opción vieja ya no está", !afterReplace.some((q) => q.promptMd === `${P} Pregunta de opción`));
    check(
      "Las preguntas sobre imagen siguen con su foto tras reemplazar",
      afterReplace.filter((q) => isImageQuestionType(q.type)).every((q) => q.imageFileId === photo)
    );

    // ─── Reemplazar conserva el ORDEN: cada imagen vuelve a su índice, las
    // nuevas llenan los huecos en su orden y las que sobran van al final ─────
    const orderExam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: `${P} Orden` });
    const choiceInput = (n: string) => ({
      type: "single_choice" as const,
      promptMd: `${P} ${n}`,
      points: 1,
      options: [
        { textMd: "A", isCorrect: true },
        { textMd: "B", isCorrect: false },
      ],
    });
    const p1 = examsSvc.createQuestion(orderExam.id, choiceInput("P1"));
    const imgId = examsSvc.createQuestion(orderExam.id, {
      type: "image_click",
      promptMd: `${P} IMG`,
      points: 1,
      config: click,
      imageFileId: photo,
    });
    const p2 = examsSvc.createQuestion(orderExam.id, choiceInput("P2"));
    const p3 = examsSvc.createQuestion(orderExam.id, choiceInput("P3"));
    check(
      "Orden inicial intercalado: P1, IMG, P2, P3",
      examsSvc.listQuestions(orderExam.id).map((q) => q.id).join() === [p1, imgId, p2, p3].join()
    );

    // Menos nuevas (2) que huecos (3): las que sobran se compactan y la
    // imagen vuelve a su índice original (1)
    const r1 = importQuestionInputs({
      actorId: teacher,
      examItemId: orderExam.id,
      inputs: [choiceInput("N1"), choiceInput("N2")],
      mode: "replace",
      source: "csv",
    });
    check("Menos nuevas que huecos: kept = 1 (la imagen)", r1.kept === 1, r1);
    const afterR1 = examsSvc.listQuestions(orderExam.id);
    check(
      "Orden tras reemplazar con menos: [nueva, IMG, nueva] y la imagen es la misma pregunta de antes",
      afterR1.length === 3 && afterR1[1].id === imgId && afterR1.map((q) => q.type).join() === "single_choice,image_click,single_choice",
      afterR1.map((q) => ({ id: q.id, type: q.type }))
    );
    check("La imagen conserva su foto y config tras reordenar", afterR1[1].imageFileId === photo && readImageClick(afterR1[1]) !== null);

    // Más nuevas (4) que huecos (2): las que sobran van al final, la imagen
    // sigue en su índice
    const r2 = importQuestionInputs({
      actorId: teacher,
      examItemId: orderExam.id,
      inputs: [choiceInput("M1"), choiceInput("M2"), choiceInput("M3"), choiceInput("M4")],
      mode: "replace",
      source: "csv",
    });
    check("Reemplazar de nuevo: kept sigue siendo 1 (la imagen)", r2.kept === 1, r2);
    const afterR2 = examsSvc.listQuestions(orderExam.id);
    check(
      "Orden tras reemplazar con más: la imagen sigue en el índice 1 y las que sobran van al final",
      afterR2.length === 5 &&
        afterR2[1].id === imgId &&
        afterR2.map((q) => q.type).join() === "single_choice,image_click,single_choice,single_choice,single_choice",
      afterR2.map((q) => q.type)
    );
  } finally {
    await cleanupDb();
    const left =
      db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%@test.local`)).all().length +
      db.select({ id: files.id }).from(files).where(like(files.originalName, `${P}-%`)).all().length +
      db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P} %`)).all().length;
    check("Limpieza: no quedan cuentas, archivos ni cursos zimg", left === 0, left);
  }
}

async function main() {
  mathChecks();
  validationChecks();
  sanitizeChecks();
  await endToEnd();
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
