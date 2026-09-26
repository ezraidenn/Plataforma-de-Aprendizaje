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
