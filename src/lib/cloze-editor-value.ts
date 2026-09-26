/**
 * Valor del editor de «Completar el texto»: lo que se abre, lo que se guarda y
 * los cambios que el editor hace sobre el texto, que es la única fuente de
 * verdad de los huecos: «Hacer hueco» y reescribir un hueco desde sus fichas
 * (variantes e incorrectas). Puro (sin DOM): lo prueba `pnpm smoke:cloze`.
 */
import {
  MAX_BLANK_TEXT,
  clozeBlankSpans,
  formatBlank,
  normalizeAnswer,
  sanitizeCloze,
  type ClozeBlank,
  type ClozeConfig,
  type ClozeMode,
} from "./cloze";

/**
 * Lo que edita el maestro: todo junto, aunque cada forma de contestar use una
 * parte (los distractores, el banco; las banderas, escribir). Así cambiar de
 * forma y volver no pierde nada; lo que se guarda es `clozeConfigOf`.
 */
export type ClozeEditorValue = {
  text: string;
  mode: ClozeMode;
  distractors: string[];
  matchCase: boolean;
  matchAccents: boolean;
};

/**
 * Lo guardado → valor del editor. Sin nada guardado: texto vacío y «Escribir».
 * Los saltos de línea de Windows (de un Excel o de la IA) quedan en «\n», como
 * los da el campo de texto: si no, las posiciones de la selección no cuadrarían
 * con las del texto al hacer un hueco.
 */
export function initialClozeValue(raw: unknown): ClozeEditorValue {
  const c = sanitizeCloze(raw) as Partial<ClozeConfig>;
  return {
    text: (c.text ?? "").replace(/\r\n?/g, "\n"),
    mode: c.mode ?? "write",
    distractors: c.distractors ?? [],
    matchCase: c.matchCase ?? false,
    matchAccents: c.matchAccents ?? false,
  };
}

/**
 * Lo que dice el servidor al cambiar la forma de contestar de una pregunta con
 * respuestas guardadas (`updateQuestion`). Vive aquí para que el editor lo diga
 * antes, con las mismas palabras.
 */
export const CLOZE_MODE_LOCKED =
  "Ya hay respuestas guardadas: no se puede cambiar la forma de contestar. Duplica la pregunta y cámbiala en la copia.";

/**
 * Por qué no se puede guardar con la forma `mode` una pregunta guardada con
 * `savedMode` (null: sí se puede). `answered`: «in_progress», esta pregunta
 * tiene respuestas en un intento en curso; «attempts», el examen ya tiene
 * intentos enviados (casi siempre con respuestas de esta pregunta).
 */
export function clozeModeLock(
  answered: "attempts" | "in_progress" | null,
  savedMode: ClozeMode | null,
  mode: ClozeMode
): string | null {
  if (answered === null || savedMode === null || mode === savedMode) return null;
  return answered === "in_progress"
    ? CLOZE_MODE_LOCKED
    : "El examen ya tiene intentos: no se puede cambiar la forma de contestar. Duplica la pregunta y cámbiala en la copia.";
}

/** Lo que se guarda (y se valida y se previsualiza): solo lo de la forma elegida. */
export function clozeConfigOf(v: ClozeEditorValue): ClozeConfig {
  return {
    text: v.text,
    mode: v.mode,
    ...(v.mode === "bank" && v.distractors.length > 0 ? { distractors: v.distractors } : {}),
    ...(v.mode === "write" && v.matchCase ? { matchCase: true } : {}),
    ...(v.mode === "write" && v.matchAccents ? { matchAccents: true } : {}),
  };
}

/**
 * «Hacer hueco» con la selección [start, end) del texto: la envuelve en
 * «[[ ]]», sin los espacios de las orillas (quedan fuera, como al hacer doble
 * clic en una palabra); sin selección, pone «[[]]». Devuelve el texto nuevo y
 * dónde dejar el cursor (dentro del hueco, tras la respuesta), o por qué no se puede.
 */
export function makeBlank(text: string, start: number, end: number): { text: string; caret: number } | { error: string } {
  let from = Math.max(0, Math.min(start, end, text.length));
  let to = Math.min(text.length, Math.max(start, end));
  const selected = text.slice(from, to);
  if (!selected.trim()) {
    // Solo espacios (o nada): el hueco vacío va donde termina la selección
    from = to;
  } else {
    from += selected.length - selected.trimStart().length;
    to -= selected.length - selected.trimEnd().length;
  }
  if (clozeBlankSpans(text).some((s) => from < s.end && to > s.start)) {
    return { error: from === to ? "El cursor está dentro de un hueco: ponlo fuera de los [[ ]]" : "La selección toca un hueco: elige texto fuera de los [[ ]]" };
  }
  const inner = text.slice(from, to);
  if (/[[\]]/.test(inner)) return { error: "La selección tiene «[» o «]»: elige solo el texto del hueco" };
  if (/[\r\n]/.test(inner)) return { error: "Un hueco va en una sola línea: elige menos texto" };
  return { text: `${text.slice(0, from)}[[${inner}]]${text.slice(to)}`, caret: to + 2 };
}

/** El texto con el hueco `index` reescrito como `blank`; el resto, tal cual. */
export function replaceBlank(text: string, index: number, blank: ClozeBlank): string {
  const span = clozeBlankSpans(text)[index];
  return span ? `${text.slice(0, span.start)}${formatBlank(blank)}${text.slice(span.end)}` : text;
}

/** Lo que no puede ir en una variante o incorrecta: marcaría otro hueco u otra parte. */
const MARKER_CHARS = /[[\]|]/;

/**
 * Por qué no se puede agregar `value` a un hueco como variante o como opción
 * incorrecta (null: se puede). Las mismas reglas que al guardar, más lo que el
 * marcador no puede escribir. Una variante que ya cuenta sin agregarla (solo
 * cambian mayúsculas o acentos y, según `opts`, no se distinguen) tampoco.
 */
export function blankPartProblem(
  value: string,
  blank: ClozeBlank,
  kind: "variant" | "wrong",
  opts: { matchCase?: boolean; matchAccents?: boolean } = {}
): string | null {
  const v = value.trim();
  if (!v) return null;
  if (MARKER_CHARS.test(v)) return "Sin «[», «]» ni «|»: marcan los huecos";
  if (v.startsWith("!")) return "No empieces con «!»";
  if (v.length > MAX_BLANK_TEXT) return `Como máximo ${MAX_BLANK_TEXT} caracteres`;
  if (kind === "variant") {
    if (blank.answers.includes(v)) return "Ya está en el hueco";
    const n = normalizeAnswer(v, opts);
    if (!blank.answers.some((a) => normalizeAnswer(a, opts) === n)) return null;
    const loose = [!opts.matchCase && "mayúsculas", !opts.matchAccents && "acentos"].filter(Boolean);
    return `Ya se acepta: no se distinguen ${loose.join(" ni ")}`;
  }
  const n = normalizeAnswer(v, {});
  if (blank.answers[0] !== undefined && normalizeAnswer(blank.answers[0], {}) === n) return "Es la respuesta correcta";
  return blank.wrong.some((w) => normalizeAnswer(w, {}) === n) ? "Ya está en la lista" : null;
}

/** Por qué no se puede agregar `value` como distractor del banco (null: se puede). */
export function distractorProblem(value: string, distractors: string[], answers: string[]): string | null {
  const v = value.trim();
  if (!v) return null;
  // «|» separa los distractores en el Excel/CSV
  if (v.includes("|")) return "Sin «|»";
  if (v.length > MAX_BLANK_TEXT) return `Como máximo ${MAX_BLANK_TEXT} caracteres`;
  const n = normalizeAnswer(v, {});
  if (distractors.some((d) => normalizeAnswer(d, {}) === n)) return "Ya está en la lista";
  return answers.some((a) => normalizeAnswer(a, {}) === n) ? "Es la respuesta de un hueco" : null;
}
