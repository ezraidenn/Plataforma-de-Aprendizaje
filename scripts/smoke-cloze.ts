/**
 * «Completar el texto»: huecos [[...]], normalización, calificación, validación
 * y saneo (puro), y el recorrido contra la base en los tres modos (guardar, la
 * vista previa del maestro, lo que recibe el alumno sin la respuesta,
 * calificar, revisar). Datos con prefijo «zclz», borrados al final.
 *
 * Uso: pnpm smoke:cloze
 */
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../src/server/db";
import { auditLog, courses as coursesTable, notifications, questions, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import * as answers from "../src/server/services/exam-answers";
import { clozeQuestionsWithAnswers } from "../src/server/services/exam-results";
import { boardAnswerSummary, buildReview } from "../src/server/services/exam-review";
import { buildRunnerQuestions } from "../src/components/student/lesson-data";
import { questionsToPreview } from "../src/lib/preview-question";
import { questionProblem } from "../src/lib/question-validation";
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import { exportExamCsv, inputsToCsv, validateExamCsv } from "../src/server/services/exam-csv";
import { parseCsv } from "../src/server/services/csv-core";
import { toDrafts } from "../src/server/services/ai-exam-import";
import { draftToInput } from "../src/lib/question-draft";
import {
  MAX_BLANKS,
  MAX_WRONG_OPTIONS,
  blankCorrect,
  clozeBankWords,
  clozeBoard,
  clozeHits,
  clozeOptions,
  clozeProblem,
  clozeScore,
  clozeSolutionText,
  clozeView,
  normalizeAnswer,
  parseCloze,
  readCloze,
  sanitizeCloze,
  type ClozeBoard,
  type ClozeConfig,
  clozeBlankSpans,
  formatBlank,
  lfOnly,
} from "../src/lib/cloze";
import {
  blankPartProblem,
  clozeConfigOf,
  clozeModeLock,
  CLOZE_MODE_LOCKED,
  distractorProblem,
  initialClozeValue,
  makeBlank,
  replaceBlank,
} from "../src/lib/cloze-editor-value";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function pureChecks() {
  console.log("\n— Huecos");
  const p = parseCloze("La capital de Francia es [[París|Paris|!Londres]] y la de Italia es [[ Roma ]].");
  check("Dos huecos", p.blanks.length === 2, p);
  check("Respuestas y variantes", JSON.stringify(p.blanks[0]) === JSON.stringify({ answers: ["París", "Paris"], wrong: ["Londres"] }), p.blanks[0]);
  check("Espacios recortados", p.blanks[1].answers[0] === "Roma");
  check("Trozos en orden", p.pieces.map((x) => (x.kind === "text" ? "t" : `b${x.index}`)).join() === "t,b0,t,b1,t", p.pieces);
  check("Texto sin huecos: ninguno", parseCloze("Nada").blanks.length === 0);
  check("Hueco vacío cuenta como hueco sin respuesta", parseCloze("a [[ ]] b").blanks[0].answers.length === 0);

  console.log("\n— Normalización");
  check("Sin mayúsculas ni acentos por defecto", normalizeAnswer("  ÁRBOL  grande ", {}) === "arbol grande");
  check("La ñ no es un acento", normalizeAnswer("Año", {}) !== normalizeAnswer("Ano", {}));
  check("Distinguir mayúsculas", normalizeAnswer("Roma", { matchCase: true }) !== normalizeAnswer("roma", { matchCase: true }));
  check("Distinguir acentos", normalizeAnswer("París", { matchAccents: true }) !== normalizeAnswer("Paris", { matchAccents: true }));
  check("Forma descompuesta igual a la compuesta", normalizeAnswer("París", { matchAccents: true }) === normalizeAnswer("París", { matchAccents: true }));

  console.log("\n— Acierto por hueco");
  const W: ClozeConfig = { text: "La capital de Francia es [[París|Paris|!Londres]].", mode: "write" };
  check("Escribir: la canónica", blankCorrect(W, 0, "parís"));
  check("Escribir: una variante", blankCorrect(W, 0, "PARIS"));
  check("Escribir: una incorrecta no cuenta", !blankCorrect(W, 0, "Londres"));
  check("Escribir: vacío no cuenta", !blankCorrect(W, 0, "  ") && !blankCorrect(W, 0, undefined));
  check("Escribir con acentos exigidos", !blankCorrect({ ...W, matchAccents: true, text: "[[París]]" }, 0, "Paris"));
  const B: ClozeConfig = { text: "[[París|Paris]] y [[Roma]]", mode: "bank", distractors: ["Madrid"] };
  check("Banco: la palabra canónica exacta", blankCorrect(B, 0, "París"));
  check("Banco: una variante no es la palabra del banco", !blankCorrect(B, 0, "Paris"));
  check("Banco: un distractor no cuenta", !blankCorrect(B, 1, "Madrid"));
  const S: ClozeConfig = { text: "[[París|!Londres|!Roma]]", mode: "select" };
  check("Lista: la canónica", blankCorrect(S, 0, "París"));
  check("Lista: una incorrecta", !blankCorrect(S, 0, "Roma"));
  check("Hueco inexistente: no cuenta", !blankCorrect(S, 3, "París"));

  console.log("\n— Validación");
  check("Válida", clozeProblem(W) === null, clozeProblem(W));
  check("Sin texto", clozeProblem({ mode: "write" }) === "Escribe el texto con sus huecos");
  check("Sin modo", clozeProblem({ text: "[[a]]" }) === "Elige cómo se contesta");
  check("Sin huecos", clozeProblem({ text: "Hola", mode: "write" }) === "Marca al menos un hueco con [[ ]]");
  check("Hueco sin cerrar", clozeProblem({ text: "Hola [[mundo", mode: "write" }) === "Hay un hueco sin cerrar: usa [[ y ]]");
  check("Hueco sin respuesta", clozeProblem({ text: "a [[!b]] c", mode: "write" }) === "El hueco 1 no tiene respuesta");
  check("Lista sin incorrectas", clozeProblem({ text: "[[a]]", mode: "select" }) === "Al hueco 1 le falta al menos una opción incorrecta (!opción)");
  check("Lista con incorrecta igual a la respuesta", clozeProblem({ text: "[[París|!paris]]", mode: "select" }) === "En el hueco 1 una opción incorrecta es igual a la respuesta");
  const wrongs = (n: number) => Array.from({ length: n }, (_, i) => `!x${i}`).join("|");
  check("Lista: hasta 6 incorrectas por hueco", clozeProblem({ text: `[[a|${wrongs(MAX_WRONG_OPTIONS)}]]`, mode: "select" }) === null);
  check("Lista: más de 6 incorrectas en un hueco, no",
    clozeProblem({ text: `[[a|!b]] y [[a|${wrongs(MAX_WRONG_OPTIONS + 1)}]]`, mode: "select" }) === "Usa como máximo 6 opciones incorrectas por hueco");
  check("Demasiados huecos", clozeProblem({ text: Array.from({ length: MAX_BLANKS + 1 }, (_, i) => `[[p${i}]]`).join(" "), mode: "write" }) === `Usa como máximo ${MAX_BLANKS} huecos`);
  check("Respuesta demasiado larga", clozeProblem({ text: `[[${"x".repeat(61)}]]`, mode: "write" }) === "El hueco 1 es demasiado largo (máximo 60 caracteres)");
  check("Distractores repetidos", clozeProblem({ ...B, distractors: ["Madrid", "madrid"] }) === "Hay distractores repetidos");
  check("Distractor igual a una respuesta", clozeProblem({ ...B, distractors: ["Roma"] }) === "Un distractor es igual a la respuesta de un hueco");
  check("Texto demasiado largo", clozeProblem({ text: `[[a]] ${"x".repeat(3000)}`, mode: "write" }) === "El texto debe tener como máximo 3000 caracteres");

  console.log("\n— Saneo");
  const s = sanitizeCloze({ text: "[[a]]", mode: "bank", distractors: [" b ", "", 3, "c"], matchCase: "sí", extra: 1 }) as ClozeConfig;
  check("Saneo: solo lo conocido, distractores recortados y sin basura", JSON.stringify(s) === JSON.stringify({ text: "[[a]]", mode: "bank", distractors: ["b", "c"] }), s);
  check("Saneo: banderas solo si son booleanas", (sanitizeCloze({ text: "[[a]]", mode: "write", matchCase: true }) as ClozeConfig).matchCase === true);

  console.log("\n— Lectura, vista del alumno, tablero y solución");
  check("Leer: la válida tal cual; la incompleta, null", readCloze({ config: W }) === W && readCloze({ config: { text: "Hola", mode: "write" } }) === null);
  check("Validación de la pregunta completa: usa la de completar",
    questionProblem({ type: "cloze", promptMd: "¿?", points: 1, config: { text: "[[a]]", mode: "select" } }) === "Al hueco 1 le falta al menos una opción incorrecta (!opción)" &&
      questionProblem({ type: "cloze", promptMd: "¿?", points: 1, config: W }) === null);
  check("Banco: la respuesta de cada hueco (aunque se repita) y los distractores, con su clave",
    JSON.stringify(clozeBankWords({ text: "[[uno]] y [[uno|1]]", mode: "bank", distractors: ["dos"] })) ===
      '[{"key":"b0","text":"uno"},{"key":"b1","text":"uno"},{"key":"d0","text":"dos"}]');
  check("Opciones de un hueco: la canónica primero y las incorrectas", clozeOptions(parseCloze(S.text).blanks[0]).join() === "París,Londres,Roma");
  const reversed = <T,>(items: T[]) => [...items].reverse();
  const tokens = { blank: (i: number) => `H${i}`, word: (key: string) => `P:${key}`, option: (i: number, k: number) => `O${i}-${k}` };
  const vw = clozeView(W, tokens, reversed);
  check("Vista al escribir: solo los trozos, con una ficha por hueco",
    JSON.stringify(vw) === '{"mode":"write","pieces":[{"kind":"text","text":"La capital de Francia es "},{"kind":"blank","token":"H0"},{"kind":"text","text":"."}]}', vw);
  const vb = clozeView(B, tokens, reversed);
  check("Vista del banco: las palabras revueltas, sin variantes", JSON.stringify(vb.words) === '[{"token":"P:d0","text":"Madrid"},{"token":"P:b1","text":"Roma"},{"token":"P:b0","text":"París"}]' && !vb.options, vb);
  const vs = clozeView(S, tokens, reversed);
  check("Vista de lista: por ficha de hueco, las opciones revueltas", JSON.stringify(vs.options) === '{"H0":[{"token":"O0-2","text":"Roma"},{"token":"O0-1","text":"Londres"},{"token":"O0-0","text":"París"}]}' && !vs.words, vs);
  check("Aciertos y fracción por hueco", clozeHits(B, ["París", "Madrid"]).join() === "true,false" && clozeScore(B, ["París", "Madrid"]) === 0.5 && clozeScore(B, []) === 0);
  const sol = clozeBoard(B);
  check("Tablero sin respuesta = la solución", sol.pieces.every((p) => p.kind === "text" || (p.correct && p.given === p.expected)) && sol.pieces.filter((p) => p.kind === "blank").length === 2, sol);
  const mine = clozeBoard(B, [undefined, "Madrid"]);
  check("Tablero con respuesta: lo puesto, si acertó y la respuesta",
    JSON.stringify(mine) ===
      JSON.stringify({
        kind: "cloze",
        pieces: [
          { kind: "blank", given: null, correct: false, expected: "París" },
          { kind: "text", text: " y " },
          { kind: "blank", given: "Madrid", correct: false, expected: "Roma" },
        ],
      }),
    mine);
  check("Solución en texto", clozeSolutionText(B) === "Hueco 1: París · Hueco 2: Roma", clozeSolutionText(B));

  console.log("\n— Editor: el texto es la fuente de los huecos");
  const T = "Francia: [[París|Paris|!Londres]]. Italia: [[Roma]].";
  check("Dónde está cada hueco", JSON.stringify(clozeBlankSpans(T)) === JSON.stringify([{ start: 9, end: 33 }, { start: 43, end: 51 }]), clozeBlankSpans(T));
  check("Hueco como marcador: respuestas y luego incorrectas", formatBlank({ answers: ["a", "b"], wrong: ["c"] }) === "[[a|b|!c]]");
  const hole = makeBlank("La capital es París.", 14, 20);
  check("Hacer hueco: envuelve la selección tal cual, con el cursor al final del hueco", "text" in hole && hole.text === "La capital es [[París.]]" && hole.caret === 22, hole);
  const word = makeBlank("La capital es París .", 13, 20);
  check("Hacer hueco: los espacios de las orillas quedan fuera", "text" in word && word.text === "La capital es [[París]] ." && word.caret === 21, word);
  const empty = makeBlank("Hola ", 5, 5);
  check("Hacer hueco sin selección: [[]] con el cursor dentro", "text" in empty && empty.text === "Hola [[]]" && empty.caret === 7, empty);
  check("Hacer hueco dentro de otro: no", "error" in makeBlank(T, 12, 12) && "error" in makeBlank(T, 5, 15));
  check("Hacer hueco junto a otro: sí", "text" in makeBlank(T, 33, 33));
  check("Hacer hueco con corchetes o saltos de línea: no", "error" in makeBlank("a [b] c", 0, 7) && "error" in makeBlank("uno\ndos", 0, 7));
  const rewritten = replaceBlank(T, 1, { answers: ["Roma", "Rome"], wrong: ["Milán"] });
  check("Reescribir un hueco: solo su marcador cambia", rewritten === "Francia: [[París|Paris|!Londres]]. Italia: [[Roma|Rome|!Milán]].", rewritten);
  check("Reescribir un hueco que no existe: nada", replaceBlank(T, 5, { answers: ["x"], wrong: [] }) === T);
  const b0 = parseCloze(T).blanks[0];
  check("Variante: sin marcas ni repetida", blankPartProblem("a|b", b0, "variant") !== null && blankPartProblem("Paris", b0, "variant") !== null && blankPartProblem("!x", b0, "variant") !== null);
  check("Variante que ya se acepta (solo cambian mayúsculas o acentos y no se distinguen): lo dice",
    blankPartProblem("PARIS", b0, "variant") === "Ya se acepta: no se distinguen mayúsculas ni acentos" &&
      blankPartProblem("PARIS", b0, "variant", { matchAccents: true }) === "Ya se acepta: no se distinguen mayúsculas" &&
      blankPartProblem("PARIS", b0, "variant", { matchCase: true }) === null,
    blankPartProblem("PARIS", b0, "variant"));
  const ny = { answers: ["Nueva York"], wrong: [] };
  check("Variante igual salvo los espacios: lo dice (también si se distingue todo)",
    blankPartProblem("Nueva  York", ny, "variant") === "Ya se acepta (solo cambian los espacios)" &&
      blankPartProblem("Nueva  York", ny, "variant", { matchCase: true, matchAccents: true }) === "Ya se acepta (solo cambian los espacios)",
    blankPartProblem("Nueva  York", ny, "variant", { matchCase: true, matchAccents: true }));
  check("Incorrecta: ni la respuesta ni repetida", blankPartProblem("paris", b0, "wrong") === "Es la respuesta correcta" && blankPartProblem("londres", b0, "wrong") === "Ya está en la lista" && blankPartProblem("Berlín", b0, "wrong") === null);
  check("Distractor: ni repetido ni una respuesta, sin «|»", distractorProblem("madrid", ["Madrid"], ["Roma"]) !== null && distractorProblem("roma", [], ["Roma"]) !== null && distractorProblem("a|b", [], []) !== null && distractorProblem("Lisboa", ["Madrid"], ["Roma"]) === null);
  check("Abrir: los saltos de línea de Windows quedan en «\\n»", initialClozeValue({ text: "a\r\n[[b]]\rc", mode: "write" }).text === "a\n[[b]]\nc");
  check("Forma de contestar: bloqueada solo si la pregunta tiene respuestas y cambia de forma",
    clozeModeLock(true, "write", "bank") === CLOZE_MODE_LOCKED && clozeModeLock(false, "write", "bank") === null &&
      clozeModeLock(true, "write", "write") === null && clozeModeLock(true, null, "bank") === null);
  check("El servidor usa el mismo mensaje", examsSvc.CLOZE_MODE_LOCKED === CLOZE_MODE_LOCKED);
  const opened = initialClozeValue({ text: "[[a]]", mode: "bank", distractors: ["b"], matchCase: true });
  check("Abrir: todo lo guardado; sin nada, escribir", opened.mode === "bank" && opened.distractors[0] === "b" && opened.matchCase && initialClozeValue(null).mode === "write" && initialClozeValue(null).text === "");
  check("Guardar: solo lo de su forma de contestar",
    JSON.stringify(clozeConfigOf(opened)) === '{"text":"[[a]]","mode":"bank","distractors":["b"]}' &&
      JSON.stringify(clozeConfigOf({ ...opened, mode: "write" })) === '{"text":"[[a]]","mode":"write","matchCase":true}' &&
      JSON.stringify(clozeConfigOf({ ...opened, mode: "select" })) === '{"text":"[[a]]","mode":"select"}');

  console.log("\n— Saltos de línea: solo «\\n» (si no, «Hacer hueco» se descuadra en el editor)");
  check("lfOnly: \\r\\n y \\r sueltos → \\n", lfOnly("uno\r\ndos\rtres\n[[cuatro]]") === "uno\ndos\ntres\n[[cuatro]]");
  check("Saneo: el texto sale con \\n", (sanitizeCloze({ text: "Uno\r\n[[dos]]\rtres", mode: "write" }) as ClozeConfig).text === "Uno\n[[dos]]\ntres");
  const [fromAi] = toDrafts({ questions: [{ type: "cloze", prompt: "Completa", points: null, clozeText: "Uno\r\n[[dos]]", clozeMode: "write" }] });
  check("IA: el texto llega con \\n", fromAi?.clozeText === "Uno\n[[dos]]" && (draftToInput(fromAi).config as ClozeConfig).text === "Uno\n[[dos]]", fromAi);
  const fromCsv = validateExamCsv('tipo,pregunta,puntos,texto\r\ncompletar,Completa,1,"Uno\r[[dos]]"').rows[0];
  check("CSV: el texto llega con \\n", (fromCsv?.input?.config as ClozeConfig | undefined)?.text === "Uno\n[[dos]]", fromCsv);

  console.log("\n— CSV/Excel");
  const csv = inputsToCsv([WRITE, BANK, SELECT].map((config, i) => ({ type: "cloze" as const, promptMd: `Pregunta ${i + 1}`, points: i + 1, config })));
  const sheet = parseCsv(csv, { maxRows: 10 });
  const cells = (name: string) => sheet.rows.map((r) => r.cells[sheet.headers.indexOf(name)]);
  check("Exportar: tipo «completar», el texto con sus huecos y el modo en español",
    cells("tipo").join() === "completar,completar,completar" && cells("texto").join("\n") === [WRITE, BANK, SELECT].map((c) => c.text).join("\n") &&
      cells("modo").join() === "escribir,banco,lista", sheet.rows);
  check("Exportar: los distractores solo en el banco, con «|»", cells("distractores").join() === ",cinco | zclzSeis,", cells("distractores"));
  const back = validateExamCsv(csv);
  check("Ida y vuelta: las tres vuelven iguales",
    back.ok === 3 && JSON.stringify(back.rows.map((r) => r.input?.config)) === JSON.stringify([WRITE, BANK, SELECT]) && back.rows.every((r) => r.typeLabel === "Completar el texto"),
    back.rows);
  const row = (texto: string, modo = "", distractores = "") =>
    validateExamCsv(`tipo,pregunta,puntos,texto,modo,distractores\r\ncompletar,Completa,1,"${texto}",${modo},"${distractores}"`).rows[0];
  check("Fila sin texto: lo dice", row("").status === "invalid" && row("").message.includes('"texto"'), row("").message);
  check("Modo vacío: escribir; en mayúsculas también vale", (row("[[a]]").input?.config as ClozeConfig).mode === "write" && (row("[[a]]", "LISTA").message.includes("hueco 1")), [row("[[a]]"), row("[[a]]", "LISTA").message]);
  check("Modo desconocido: lo dice", row("[[a]]", "dictado").message.includes('"modo"'), row("[[a]]", "dictado").message);
  check("Distractores fuera del banco: lo dice", row("[[a]]", "escribir", "b").message.includes("modo banco"), row("[[a]]", "escribir", "b").message);
  check("Sin huecos: el mensaje del editor", row("Sin huecos").message === "Marca al menos un hueco con [[ ]]", row("Sin huecos").message);
  check("Lista sin incorrectas: el mensaje del editor", row("[[a]]", "lista").message === "Al hueco 1 le falta al menos una opción incorrecta (!opción)", row("[[a]]", "lista").message);
  check("Distractor igual a una respuesta: el mensaje del editor", row("[[a]]", "banco", "A | b").message === "Un distractor es igual a la respuesta de un hueco", row("[[a]]", "banco", "A | b").message);
}

// ─── Recorrido contra la base ────────────────────────────────────────────────

const P = "zclz";
const email = (key: string) => `${P}-${key}@test.local`;
// Textos inconfundibles: si aparecen en lo que recibe el alumno, se filtró la respuesta
const WRITE: ClozeConfig = { text: "Capital de Francia: [[París|Paris|zclzLutecia]]. Capital de Italia: [[zclzRoma]].", mode: "write" };
const BANK: ClozeConfig = { text: "[[uno]] más [[uno]] es [[dos]]; [[tres]] es impar.", mode: "bank", distractors: ["cinco", "zclzSeis"] };
const SELECT: ClozeConfig = { text: "El agua hierve a [[100|zclzCien|!90|!80]] grados y se congela a [[0|!10|!-5]] grados.", mode: "select" };

function makeUser(key: string, role: "teacher" | "student", createdBy: string | null): string {
  const id = `${P}-${key}-${Date.now().toString(36)}`;
  db.insert(users).values({ id, email: email(key), passwordHash: "x", fullName: `${P} ${key}`, role, createdBy }).run();
  return id;
}

/** Borra todo lo zclz: cursos (en cascada, preguntas e intentos), avisos, auditoría y cuentas. */
function cleanupDb() {
  const userIds = db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%@test.local`)).all().map((u) => u.id);
  const courseIds = db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P} %`)).all().map((c) => c.id);
  cleanupSmokeNotifications(courseIds);
  if (courseIds.length) db.delete(coursesTable).where(inArray(coursesTable.id, courseIds)).run();
  if (userIds.length) {
    db.delete(notifications).where(inArray(notifications.userId, userIds)).run();
    db.delete(auditLog).where(inArray(auditLog.userId, userIds)).run();
    db.delete(users).where(inArray(users.id, userIds)).run();
  }
}

/** Los huecos del tablero de una revisión. */
const blanksOf = (board: ClozeBoard | undefined) => (board?.pieces ?? []).flatMap((p) => (p.kind === "blank" ? [p] : []));

async function endToEnd() {
  console.log("\n— Recorrido contra la base");
  cleanupDb(); // restos de una corrida que se cortó
  try {
    const teacher = makeUser("maestro", "teacher", null);
    const student = makeUser("alumno", "student", teacher);

    // Guardar: lo que manda el navegador pasa por el saneo y la validación
    const raw = { ...BANK, distractors: [" cinco ", "", "zclzSeis"], matchCase: "no", extra: 1 };
    const saved = sanitizeCloze(raw);
    check("Guardar: el saneo deja la config limpia y válida", JSON.stringify(saved) === JSON.stringify(BANK) && questionProblem({ type: "cloze", promptMd: "¿?", points: 1, config: saved }) === null, saved);
    check("Las tres configs de prueba son válidas", [WRITE, BANK, SELECT].every((c) => clozeProblem(c) === null), [WRITE, BANK, SELECT].map(clozeProblem));

    const course = courses.createCourse({ ownerId: teacher, title: `${P} Completar` });
    const exam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: `${P} Examen` });
    const qW = examsSvc.createQuestion(exam.id, { type: "cloze", promptMd: "Escribe las capitales", points: 2, config: WRITE });
    const qB = examsSvc.createQuestion(exam.id, { type: "cloze", promptMd: "Completa con el banco", points: 4, config: BANK });
    const qS = examsSvc.createQuestion(exam.id, { type: "cloze", promptMd: "Elige en cada hueco", points: 3, config: SELECT });
    let invalid = "";
    try {
      examsSvc.createQuestion(exam.id, { type: "cloze", promptMd: "Mal", points: 1, config: { text: "[[a]]", mode: "select" } });
    } catch (e) {
      invalid = (e as Error).message;
    }
    check("Guardar una incompleta se niega con el mensaje del editor", invalid === "Al hueco 1 le falta al menos una opción incorrecta (!opción)", invalid);
    const exported = validateExamCsv(exportExamCsv(exam.id));
    check("CSV del examen: las tres salen y vuelven iguales",
      exported.ok === 3 && JSON.stringify(exported.rows.map((r) => r.input?.config)) === JSON.stringify([WRITE, BANK, SELECT]), exported.rows);

    // «Ver como alumno» del maestro: fichas locales, la solución en texto y como tablero
    const preview = questionsToPreview(examsSvc.listQuestions(exam.id));
    const [pw, pb, ps] = [qW, qB, qS].map((id) => preview.find((q) => q.id === id));
    check("Vista previa: los tres modos, con sus trozos", pw?.cloze?.mode === "write" && pb?.cloze?.mode === "bank" && ps?.cloze?.mode === "select" && preview.every((q) => q.categorize === null));
    check("Vista previa: banco con sus 6 palabras y lista con opciones por hueco",
      pb?.cloze?.words?.length === 6 && Object.values(ps?.cloze?.options ?? {}).map((o) => o.length).join() === "3,3", { words: pb?.cloze?.words, options: ps?.cloze?.options });
    check("Vista previa: la solución en texto y como tablero",
      pw?.answerText === "Hueco 1: París · Hueco 2: zclzRoma" && pw.answerBoard?.kind === "cloze" && blanksOf(pw.answerBoard).every((b) => b.correct && b.given === b.expected) && !pw.solution,
      pw);

    courses.publishCourse(course.id);
    courses.enrollStudents(course.id, [student], teacher);

    // ─── Lo que recibe el alumno ───────────────────────────────────────────────
    const attempt = examsSvc.startAttempt({ courseId: course.id, studentId: student, examItemId: exam.id });
    const runner = buildRunnerQuestions(attempt);
    const json = JSON.stringify(runner);
    const [rw, rb, rs] = [qW, qB, qS].map((id) => runner.find((q) => q.id === id)!);
    check("El alumno no recibe las variantes aceptadas", ["Paris", "zclzLutecia", "zclzCien"].every((v) => !json.includes(v)), ["Paris", "zclzLutecia", "zclzCien"].filter((v) => json.includes(v)));
    check("…ni, al escribir, la respuesta", !JSON.stringify(rw).includes("París") && !JSON.stringify(rw).includes("zclzRoma"));
    check("…ni la marca de las incorrectas", !json.includes("!90") && !json.includes("!-5") && !json.includes('"!'));
    check("…ni el texto con sus huecos ni la configuración",
      !json.includes("[[") && !json.includes("config") && !json.includes("distractors") && !json.includes("wrong") && !json.includes("answers") && !json.includes("matchCase"));
    check("Escribir: solo los trozos, con una ficha por hueco",
      Object.keys(rw.cloze ?? {}).sort().join() === "mode,pieces" && rw.cloze?.pieces.filter((p) => p.kind === "blank").length === 2);
    const hex = (t: string) => /^[0-9a-f]{16}$/.test(t);
    check("Banco: 6 palabras (la de cada hueco, aunque se repita, y los distractores), solo texto y ficha",
      rb.cloze?.words?.length === 6 &&
        rb.cloze.words.every((w) => Object.keys(w).sort().join() === "text,token" && hex(w.token)) &&
        rb.cloze.words.map((w) => w.text).sort().join() === ["uno", "uno", "dos", "tres", "cinco", "zclzSeis"].sort().join() &&
        !rb.cloze.options,
      rb.cloze?.words);
    const optionLists = Object.entries(rs.cloze?.options ?? {});
    check("Lista: por cada ficha de hueco, sus opciones con solo texto y ficha",
      optionLists.length === 2 &&
        optionLists.every(([blank, opts]) => rs.cloze!.pieces.some((p) => p.kind === "blank" && p.token === blank) && opts.every((o) => Object.keys(o).sort().join() === "text,token" && hex(o.token))) &&
        optionLists.map(([, opts]) => opts.map((o) => o.text).sort().join("/")).join() === "100/80/90,-5/0/10" &&
        !rs.cloze?.words,
      rs.cloze?.options);
    const allTokens = runner.flatMap((q) => [
      ...(q.cloze?.pieces.flatMap((p) => (p.kind === "blank" ? [p.token] : [])) ?? []),
      ...(q.cloze?.words ?? []).map((w) => w.token),
      ...Object.values(q.cloze?.options ?? {}).flat().map((o) => o.token),
    ]);
    check("Fichas opacas y distintas", allTokens.length === 2 + 4 + 6 + 2 + 6 && new Set(allTokens).size === allTokens.length && allTokens.every(hex), allTokens.length);
    check("Las demás claves quedan en null", runner.every((q) => q.categorize === null && q.imageDrag === null && q.matching === null && q.ordering === null));

    // ─── Calificar: mitad bien en cada modo ────────────────────────────────────
    const blank = (q: string, i: number) => answers.clozeBlankToken(attempt.id, q, i);
    const word = (key: string) => answers.clozeWordToken(attempt.id, qB, key);
    const option = (i: number, k: number) => answers.clozeOptionToken(attempt.id, qS, i, k);
    check("Las fichas calculadas son las que recibió el alumno",
      [0, 1].every((i) => rw.cloze!.pieces.some((p) => p.kind === "blank" && p.token === blank(qW, i))) &&
        ["b0", "b1", "b2", "b3", "d0", "d1"].every((k) => rb.cloze!.words!.some((w) => w.token === word(k))) &&
        [0, 1, 2].every((k) => rs.cloze!.options![blank(qS, 0)].some((o) => o.token === option(0, k))));
    // Escribir: «paris» vale (sin mayúsculas ni acentos, y es una variante); «Milán» no
    const writeAnswer = { [blank(qW, 0)]: "  paris ", [blank(qW, 1)]: "Milán" };
    // Banco: la palabra del hueco 1 («uno») en el hueco 0 vale (iguales, intercambiables); la
    // MISMA ficha otra vez en el hueco 1 no cuenta; un distractor en el 2, mal; «tres» en el 3, bien
    const bankAnswer = { [blank(qB, 0)]: word("b1"), [blank(qB, 1)]: word("b1"), [blank(qB, 2)]: word("d0"), [blank(qB, 3)]: word("b3") };
    // Lista: la canónica en el primero; en el segundo, una incorrecta
    const selectAnswer = { [blank(qS, 0)]: option(0, 0), [blank(qS, 1)]: answers.clozeOptionToken(attempt.id, qS, 1, 2) };
    check("Escribir: lo puesto en cada hueco", JSON.stringify(answers.clozePlacement(WRITE, JSON.stringify(writeAnswer), attempt.id, qW)) === '["paris","Milán"]');
    const bankGiven = answers.clozePlacement(BANK, JSON.stringify(bankAnswer), attempt.id, qB);
    check("Banco: una misma ficha usada en dos huecos cuenta una vez (en el primero)", JSON.stringify(bankGiven) === '["uno",null,"cinco","tres"]', bankGiven);
    check("Banco: dos palabras iguales son intercambiables", clozeScore(BANK, bankGiven) === 0.5);
    check("Banco: fichas inventadas o de otro intento no cuentan",
      answers.clozePlacement(BANK, JSON.stringify({ [blank(qB, 0)]: "0123456789abcdef", [blank(qB, 1)]: answers.clozeWordToken("otro", qB, "b1"), [blank(qB, 2)]: "dos" }), attempt.id, qB).every((g) => g === undefined));
    check("Lista: una opción de otro hueco no cuenta",
      answers.clozePlacement(SELECT, JSON.stringify({ [blank(qS, 1)]: option(0, 0) }), attempt.id, qS).every((g) => g === undefined));
    check("Escribir: lo vacío o no escrito como texto no cuenta",
      answers.clozePlacement(WRITE, JSON.stringify({ [blank(qW, 0)]: "   ", [blank(qW, 1)]: 3 }), attempt.id, qW).every((g) => g === undefined));
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: qW, answerText: JSON.stringify(writeAnswer) });
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: qB, answerText: JSON.stringify(bankAnswer) });
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: qS, answerText: JSON.stringify(selectAnswer) });
    const graded = examsSvc.submitAttempt({ courseId: course.id, studentId: student, attemptId: attempt.id });
    check("Calificado: 1 de 2 (2 pts) + 2 de 4 (4 pts) + 1 de 2 (3 pts) = 1 + 2 + 1.5 = 4.5",
      graded.status === "graded" && graded.finalScore === 4.5, { status: graded.status, score: graded.finalScore });

    // ─── Revisión ──────────────────────────────────────────────────────────────
    const review = buildReview(graded);
    const [vw, vb, vs] = [qW, qB, qS].map((id) => review.find((e) => e.questionId === id)!);
    check("Revisión: puntos por pregunta", vw.earnedPoints === 1 && vb.earnedPoints === 2 && vs.earnedPoints === 1.5 && [vw, vb, vs].every((e) => e.result === "partial"), review.map((e) => e.earnedPoints));
    check("Revisión: «N de M huecos bien» y la solución en texto",
      vw.yourAnswer === "1 de 2 huecos bien" && vb.yourAnswer === "2 de 4 huecos bien" && vs.yourAnswer === "1 de 2 huecos bien" &&
        vw.correctAnswer === "Hueco 1: París · Hueco 2: zclzRoma" && vs.correctAnswer === "Hueco 1: 100 · Hueco 2: 0",
      review.map((e) => [e.yourAnswer, e.correctAnswer]));
    check("Revisión de escribir: el texto con lo escrito, si acertó y la respuesta",
      vw.answerBoard?.kind === "cloze" && !vw.board &&
        JSON.stringify(vw.answerBoard.pieces) ===
          JSON.stringify([
            { kind: "text", text: "Capital de Francia: " },
            { kind: "blank", given: "paris", correct: true, expected: "París" },
            { kind: "text", text: ". Capital de Italia: " },
            { kind: "blank", given: "Milán", correct: false, expected: "zclzRoma" },
            { kind: "text", text: "." },
          ]),
      vw.answerBoard);
    check("Revisión del banco: la ficha repetida deja el segundo hueco vacío",
      JSON.stringify(blanksOf(vb.answerBoard?.kind === "cloze" ? vb.answerBoard : undefined).map((b) => [b.given, b.correct, b.expected])) ===
        '[["uno",true,"uno"],[null,false,"uno"],["cinco",false,"dos"],["tres",true,"tres"]]',
      vb.answerBoard);
    check("Revisión de lista: la opción elegida en cada hueco",
      JSON.stringify(blanksOf(vs.answerBoard?.kind === "cloze" ? vs.answerBoard : undefined).map((b) => [b.given, b.correct])) === '[["100",true],["-5",false]]',
      vs.answerBoard);
    const rows = examsSvc.listQuestions(exam.id);
    check("El maestro al calificar lee el mismo resumen",
      boardAnswerSummary(rows.find((q) => q.id === qB)!, JSON.stringify(bankAnswer), attempt.id) === "2 de 4 huecos bien" &&
        boardAnswerSummary(rows.find((q) => q.id === qW)!, "{}", attempt.id) === "Sin respuesta");

    // ─── Cambiar la forma de contestar con respuestas guardadas ───────────────
    const tryUpdate = (id: string, config: ClozeConfig) => {
      try {
        examsSvc.updateQuestion(id, { type: "cloze", promptMd: "Editada", points: 4, config });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    const modeOf = (id: string) => readCloze(examsSvc.listQuestions(exam.id).find((q) => q.id === id)!)?.mode;
    check("Con respuestas guardadas, la forma de contestar no cambia (y la pregunta queda igual)",
      tryUpdate(qB, { ...BANK, mode: "select", text: SELECT.text }) === examsSvc.CLOZE_MODE_LOCKED && modeOf(qB) === "bank" &&
        tryUpdate(qS, { ...SELECT, mode: "write" }) === examsSvc.CLOZE_MODE_LOCKED && modeOf(qS) === "select",
      [modeOf(qB), modeOf(qS)]);
    check("…el mensaje dice qué hacer", examsSvc.CLOZE_MODE_LOCKED === "Ya hay respuestas guardadas: no se puede cambiar la forma de contestar. Duplica la pregunta y cámbiala en la copia.");
    check("…pero el texto y las variantes sí (mismo modo)",
      tryUpdate(qW, { ...WRITE, text: WRITE.text.replace("]]", "|Lutecia]]") }) === null && modeOf(qW) === "write");
    // Sin respuestas guardadas (su copia), el modo se cambia
    const qCopy = examsSvc.duplicateQuestion(exam.id, qB);
    check("Sin respuestas guardadas (la copia), el modo sí cambia", tryUpdate(qCopy, { ...BANK, mode: "write" }) === null && modeOf(qCopy) === "write", modeOf(qCopy));
    // Lo que el editor bloquea antes: el mismo criterio que el servidor
    const withAnswers = clozeQuestionsWithAnswers(exam.id);
    check("Las de completar con respuestas (el editor las bloquea): las respondidas sí, la copia sin respuestas no",
      withAnswers.includes(qB) && withAnswers.includes(qS) && !withAnswers.includes(qCopy), withAnswers);

    // ─── Config inválida: vale 0 sin tumbar el envío ──────────────────────────
    // En su propio curso: con la secuencia obligatoria, un segundo examen aquí quedaría bloqueado
    const brokenCourse = courses.createCourse({ ownerId: teacher, title: `${P} Rota` });
    const brokenExam = tree.createItem({ courseId: brokenCourse.id, parentId: null, kind: "exam", title: `${P} Examen roto` });
    const qBroken = examsSvc.createQuestion(brokenExam.id, { type: "cloze", promptMd: "Rota", points: 2, config: WRITE });
    courses.publishCourse(brokenCourse.id);
    courses.enrollStudents(brokenCourse.id, [student], teacher);
    const brokenAttempt = examsSvc.startAttempt({ courseId: brokenCourse.id, studentId: student, examItemId: brokenExam.id });
    examsSvc.saveAnswer({
      studentId: student,
      attemptId: brokenAttempt.id,
      questionId: qBroken,
      answerText: JSON.stringify({ [answers.clozeBlankToken(brokenAttempt.id, qBroken, 0)]: "París" }),
    });
    // Algo guardado mal (a mano, fuera del editor): sin huecos
    db.update(questions).set({ config: { text: "Sin huecos", mode: "write" } }).where(eq(questions.id, qBroken)).run();
    check("Config inválida: el alumno no la recibe", buildRunnerQuestions(brokenAttempt)[0]?.cloze === null);
    const brokenGraded = examsSvc.submitAttempt({ courseId: brokenCourse.id, studentId: student, attemptId: brokenAttempt.id });
    check("Config inválida: el envío pasa y vale 0", brokenGraded.status === "graded" && brokenGraded.finalScore === 0, { status: brokenGraded.status, score: brokenGraded.finalScore });
    const [brokenEntry] = buildReview(brokenGraded);
    check("Config inválida: la revisión dice «Sin respuesta», sin tablero", brokenEntry.yourAnswer === "Sin respuesta" && !brokenEntry.answerBoard, brokenEntry);
  } finally {
    cleanupDb();
    const left =
      db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%@test.local`)).all().length +
      db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P} %`)).all().length;
    check("Limpieza: no quedan cuentas ni cursos zclz", left === 0, left);
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
