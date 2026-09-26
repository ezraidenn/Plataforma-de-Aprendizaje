/**
 * «Completar el texto» (cloze): un texto con huecos [[respuesta|variante|!incorrecta]].
 * La primera parte sin «!» es la respuesta canónica; las demás sin «!» son
 * variantes que se aceptan al escribir; las que empiezan con «!» son opciones
 * incorrectas para el modo lista. Puro (sin BD ni DOM): lo usan el servidor, el
 * navegador, el CSV, la IA y las pruebas.
 */

export type ClozeMode = "write" | "bank" | "select";
export type ClozeConfig = {
  text: string;
  mode: ClozeMode;
  /** Solo banco: palabras de más que no van en ningún hueco. */
  distractors?: string[];
  /** Solo escribir: distinguir mayúsculas (por defecto no). */
  matchCase?: boolean;
  /** Solo escribir: distinguir acentos (por defecto no; la ñ siempre cuenta). */
  matchAccents?: boolean;
};
export type ClozeBlank = { answers: string[]; wrong: string[] };
export type ClozePiece = { kind: "text"; text: string } | { kind: "blank"; index: number };

export const CLOZE_MODES: readonly ClozeMode[] = ["write", "bank", "select"];
export const MAX_BLANKS = 20;
export const MAX_CLOZE_TEXT = 3000;
export const MAX_BLANK_TEXT = 60;
export const MAX_DISTRACTORS = 10;

const BLANK_RE = /\[\[([^[\]]*?)\]\]/g;

/** Trozos del texto y los huecos, en orden. */
export function parseCloze(text: string): { pieces: ClozePiece[]; blanks: ClozeBlank[] } {
  const pieces: ClozePiece[] = [];
  const blanks: ClozeBlank[] = [];
  let last = 0;
  for (const m of text.matchAll(BLANK_RE)) {
    const at = m.index ?? 0;
    if (at > last) pieces.push({ kind: "text", text: text.slice(last, at) });
    const parts = m[1].split("|").map((s) => s.trim()).filter(Boolean);
    blanks.push({
      answers: parts.filter((s) => !s.startsWith("!")),
      wrong: parts.filter((s) => s.startsWith("!")).map((s) => s.slice(1).trim()).filter(Boolean),
    });
    pieces.push({ kind: "blank", index: blanks.length - 1 });
    last = at + m[0].length;
  }
  if (last < text.length) pieces.push({ kind: "text", text: text.slice(last) });
  return { pieces, blanks };
}

/** Para comparar lo escrito: espacios juntos y, salvo que se exija, sin mayúsculas ni acentos (la ñ se conserva). */
export function normalizeAnswer(s: string, opts: { matchCase?: boolean; matchAccents?: boolean }): string {
  let t = s.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!opts.matchAccents) {
    t = t
      .replace(/ñ/g, "\u0001")
      .replace(/Ñ/g, "\u0002")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/\u0001/g, "ñ")
      .replace(/\u0002/g, "Ñ");
  }
  if (!opts.matchCase) t = t.toLocaleLowerCase("es");
  return t;
}

/**
 * ¿Es correcto lo que se puso en el hueco `index`? `given` es el texto escrito
 * (escribir), la palabra del banco (banco) o la opción elegida (lista).
 */
export function blankCorrect(config: ClozeConfig, index: number, given: string | undefined): boolean {
  const blank = parseCloze(config.text).blanks[index];
  if (!blank || blank.answers.length === 0 || given === undefined || !given.trim()) return false;
  if (config.mode === "write") {
    const n = normalizeAnswer(given, config);
    return blank.answers.some((a) => normalizeAnswer(a, config) === n);
  }
  // Banco y lista: la palabra u opción es la canónica tal cual
  return given.trim() === blank.answers[0];
}

/** null = válida; si no, el primer problema (texto que ve el maestro). */
export function clozeProblem(config: unknown): string | null {
  const c = config as Partial<ClozeConfig> | null;
  if (!c || typeof c.text !== "string" || !c.text.trim()) return "Escribe el texto con sus huecos";
  if (!CLOZE_MODES.includes(c.mode as ClozeMode)) return "Elige cómo se contesta";
  if (c.text.length > MAX_CLOZE_TEXT) return `El texto debe tener como máximo ${MAX_CLOZE_TEXT} caracteres`;
  const { pieces, blanks } = parseCloze(c.text);
  const outside = pieces.map((p) => (p.kind === "text" ? p.text : " ")).join("");
  if (outside.includes("[[") || outside.includes("]]")) return "Hay un hueco sin cerrar: usa [[ y ]]";
  if (blanks.length === 0) return "Marca al menos un hueco con [[ ]]";
  if (blanks.length > MAX_BLANKS) return `Usa como máximo ${MAX_BLANKS} huecos`;
  for (const [i, b] of blanks.entries()) {
    const n = i + 1;
    if (b.answers.length === 0) return `El hueco ${n} no tiene respuesta`;
    if ([...b.answers, ...b.wrong].some((a) => a.length > MAX_BLANK_TEXT)) {
      return `El hueco ${n} es demasiado largo (máximo ${MAX_BLANK_TEXT} caracteres)`;
    }
    if (c.mode === "select") {
      if (b.wrong.length === 0) return `Al hueco ${n} le falta al menos una opción incorrecta (!opción)`;
      const right = normalizeAnswer(b.answers[0], {});
      if (b.wrong.some((w) => normalizeAnswer(w, {}) === right)) {
        return `En el hueco ${n} una opción incorrecta es igual a la respuesta`;
      }
    }
  }
  if (c.distractors !== undefined) {
    if (!Array.isArray(c.distractors) || c.distractors.some((d) => typeof d !== "string" || !d.trim())) {
      return "Hay un distractor vacío";
    }
    if (c.distractors.length > MAX_DISTRACTORS) return `Usa como máximo ${MAX_DISTRACTORS} distractores`;
    if (c.distractors.some((d) => d.length > MAX_BLANK_TEXT)) {
      return `Los distractores deben tener como máximo ${MAX_BLANK_TEXT} caracteres`;
    }
    const seen = new Set(c.distractors.map((d) => normalizeAnswer(d, {})));
    if (seen.size !== c.distractors.length) return "Hay distractores repetidos";
    if (blanks.some((b) => seen.has(normalizeAnswer(b.answers[0], {})))) {
      return "Un distractor es igual a la respuesta de un hueco";
    }
  }
  return null;
}

/** Config que llega del navegador → solo los campos conocidos, con su tipo. */
export function sanitizeCloze(raw: unknown): unknown {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  if (typeof c.text === "string") out.text = c.text;
  if (typeof c.mode === "string" && CLOZE_MODES.includes(c.mode as ClozeMode)) out.mode = c.mode;
  if (Array.isArray(c.distractors)) {
    out.distractors = c.distractors
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.trim())
      .filter(Boolean);
  }
  if (typeof c.matchCase === "boolean") out.matchCase = c.matchCase;
  if (typeof c.matchAccents === "boolean") out.matchAccents = c.matchAccents;
  return out;
}

/**
 * Pregunta guardada → su config, o null si no está completa. Es el único
 * criterio para lo que ve el alumno, la calificación y la revisión (como
 * `readImageDrag`): usa las mismas reglas que al guardar.
 */
export function readCloze(q: { config: unknown }): ClozeConfig | null {
  return clozeProblem(q.config) === null ? (q.config as ClozeConfig) : null;
}

/**
 * Palabras del banco: la respuesta canónica de cada hueco (clave `b{i}`, una
 * por hueco aunque se repita) y los distractores (clave `d{j}`). De la clave
 * sale su ficha; el alumno y la calificación usan esta misma lista.
 */
export function clozeBankWords(config: ClozeConfig): { key: string; text: string }[] {
  const { blanks } = parseCloze(config.text);
  return [
    ...blanks.map((b, i) => ({ key: `b${i}`, text: b.answers[0] })),
    ...(config.distractors ?? []).map((d, j) => ({ key: `d${j}`, text: d })),
  ];
}

/** Opciones de un hueco en modo lista: la canónica y las incorrectas (la ficha de cada una sale de su índice aquí). */
export function clozeOptions(blank: ClozeBlank): string[] {
  return [blank.answers[0], ...blank.wrong];
}

/**
 * Lo que recibe el alumno: el texto en trozos con una ficha por hueco y, según
 * el modo, las palabras del banco (revueltas) o las opciones de cada hueco
 * (revueltas, por ficha de hueco). Nunca las variantes aceptadas ni cuál
 * opción es la correcta. Respuesta: `{ fichaDeHueco: texto }` al escribir,
 * `{ fichaDeHueco: fichaDePalabra | fichaDeOpción }` en banco y lista.
 */
export type ClozeView = {
  mode: ClozeMode;
  pieces: ({ kind: "text"; text: string } | { kind: "blank"; token: string })[];
  words?: { token: string; text: string }[];
  options?: Record<string, { token: string; text: string }[]>;
};

/** La vista del alumno con las fichas que dan `tokens` (el servidor: HMAC por intento; la vista previa: locales). */
export function clozeView(
  config: ClozeConfig,
  tokens: { blank: (index: number) => string; word: (key: string) => string; option: (blank: number, k: number) => string },
  shuffle: <T>(items: T[]) => T[]
): ClozeView {
  const { pieces, blanks } = parseCloze(config.text);
  const view: ClozeView = {
    mode: config.mode,
    pieces: pieces.map((p) => (p.kind === "text" ? { kind: "text", text: p.text } : { kind: "blank", token: tokens.blank(p.index) })),
  };
  if (config.mode === "bank") {
    view.words = shuffle(clozeBankWords(config).map((w) => ({ token: tokens.word(w.key), text: w.text })));
  }
  if (config.mode === "select") {
    view.options = Object.fromEntries(
      blanks.map((b, i) => [tokens.blank(i), shuffle(clozeOptions(b).map((text, k) => ({ token: tokens.option(i, k), text })))])
    );
  }
  return view;
}

/** Qué huecos quedaron bien, en orden. `given[i]` = lo puesto en el hueco i (lo escrito, la palabra o la opción). */
export function clozeHits(config: ClozeConfig, given: (string | undefined)[]): boolean[] {
  const { blanks } = parseCloze(config.text);
  return blanks.map((_, i) => blankCorrect(config, i, given[i]));
}

/** Fracción 0–1 de huecos bien. */
export function clozeScore(config: ClozeConfig, given: (string | undefined)[]): number {
  const hits = clozeHits(config, given);
  return hits.length === 0 ? 0 : hits.filter(Boolean).length / hits.length;
}

/**
 * Tablero de revisión (solo viaja con resultados visibles): el texto con lo
 * puesto en cada hueco, si quedó bien y la respuesta canónica.
 */
export type ClozeBoard = {
  kind: "cloze";
  pieces: ({ kind: "text"; text: string } | { kind: "blank"; given: string | null; correct: boolean; expected: string })[];
};

/**
 * Sin `given`, la solución: cada hueco con su respuesta (la vista previa del
 * maestro). Con `given` (lo puesto en cada hueco), lo del alumno y si acertó.
 */
export function clozeBoard(config: ClozeConfig, given?: (string | undefined)[]): ClozeBoard {
  const { pieces, blanks } = parseCloze(config.text);
  const hits = given ? clozeHits(config, given) : null;
  return {
    kind: "cloze",
    pieces: pieces.map((p) => {
      if (p.kind === "text") return { kind: "text", text: p.text };
      const expected = blanks[p.index].answers[0];
      if (!given || !hits) return { kind: "blank", given: expected, correct: true, expected };
      return { kind: "blank", given: given[p.index] ?? null, correct: hits[p.index], expected };
    }),
  };
}

/** La solución en texto: «Hueco 1: París · Hueco 2: Roma». */
export function clozeSolutionText(config: ClozeConfig): string {
  return parseCloze(config.text)
    .blanks.map((b, i) => `Hueco ${i + 1}: ${b.answers[0]}`)
    .join(" · ");
}
