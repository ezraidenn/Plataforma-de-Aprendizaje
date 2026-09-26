/**
 * «Completar el texto»: huecos [[...]], normalización, calificación, validación
 * y saneo (puro); en tareas siguientes, el recorrido contra la base. Datos con
 * prefijo «zclz», borrados al final.
 *
 * Uso: pnpm smoke:cloze
 */
import {
  MAX_BLANKS,
  blankCorrect,
  clozeProblem,
  normalizeAnswer,
  parseCloze,
  sanitizeCloze,
  type ClozeConfig,
} from "../src/lib/cloze";

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
  check("Demasiados huecos", clozeProblem({ text: Array.from({ length: MAX_BLANKS + 1 }, (_, i) => `[[p${i}]]`).join(" "), mode: "write" }) === `Usa como máximo ${MAX_BLANKS} huecos`);
  check("Respuesta demasiado larga", clozeProblem({ text: `[[${"x".repeat(61)}]]`, mode: "write" }) === "El hueco 1 es demasiado largo (máximo 60 caracteres)");
  check("Distractores repetidos", clozeProblem({ ...B, distractors: ["Madrid", "madrid"] }) === "Hay distractores repetidos");
  check("Distractor igual a una respuesta", clozeProblem({ ...B, distractors: ["Roma"] }) === "Un distractor es igual a la respuesta de un hueco");
  check("Texto demasiado largo", clozeProblem({ text: `[[a]] ${"x".repeat(3000)}`, mode: "write" }) === "El texto debe tener como máximo 3000 caracteres");

  console.log("\n— Saneo");
  const s = sanitizeCloze({ text: "[[a]]", mode: "bank", distractors: [" b ", "", 3, "c"], matchCase: "sí", extra: 1 }) as ClozeConfig;
  check("Saneo: solo lo conocido, distractores recortados y sin basura", JSON.stringify(s) === JSON.stringify({ text: "[[a]]", mode: "bank", distractors: ["b", "c"] }), s);
  check("Saneo: banderas solo si son booleanas", (sanitizeCloze({ text: "[[a]]", mode: "write", matchCase: true }) as ClozeConfig).matchCase === true);
}

async function main() {
  pureChecks();
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
