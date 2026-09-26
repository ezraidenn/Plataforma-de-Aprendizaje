import { questionProblem, type QuestionShape } from "./question-validation";
import type { ImageQuestionType } from "./image-questions";
import type { CategorizeCard } from "./categorize";
import { lfOnly, type ClozeMode } from "./cloze";

/**
 * Pregunta interpretada (por la IA) que el maestro revisa antes de importar.
 * Puro: lo usan el servidor y el diálogo. Sin las preguntas sobre imagen:
 * necesitan foto y posiciones, y la IA no las crea. Por lo mismo, en
 * «Clasificar en grupos» las tarjetas son solo de texto (nunca de ícono).
 */
export type DraftType = Exclude<QuestionShape["type"], ImageQuestionType>;

export type QuestionDraft = {
  /** Id local (no es de la BD) */
  key: string;
  type: DraftType;
  prompt: string;
  points: number;
  /** single/multiple/true_false */
  options: { text: string; correct: boolean }[];
  /** short_text */
  accepted: string[];
  /** matching */
  pairs: { left: string; right: string }[];
  /** ordering, en el orden correcto */
  steps: string[];
  /** categorize: cada grupo con su nombre y sus tarjetas (texto) */
  groups: { name: string; cards: string[] }[];
  /** cloze: el texto con cada hueco entre [[ ]] */
  clozeText: string;
  /** cloze: cómo se contesta */
  clozeMode: ClozeMode;
  /** cloze en modo banco: palabras de más */
  distractors: string[];
  /** Avisos («no se indica la respuesta correcta», …) */
  issues: string[];
  /**
   * Archivo de donde salió (solo con varios archivos). Vive en el navegador para
   * revisar: no se guarda ni sale en el CSV (cleanDrafts lo descarta).
   */
  source?: string;
};

/** Etiquetas de cada tipo, iguales a las del editor. */
export const DRAFT_TYPE_LABEL: Record<DraftType, string> = {
  single_choice: "Opción única",
  multiple_choice: "Opción múltiple",
  true_false: "Verdadero/Falso",
  short_text: "Respuesta corta",
  matching: "Relacionar columnas",
  ordering: "Ordenar pasos",
  categorize: "Clasificar en grupos",
  cloze: "Completar el texto",
  open_text: "Texto abierto",
};

/** Borrador → entrada del servicio (misma forma que el editor y el CSV). */
export function draftToInput(d: QuestionDraft): QuestionShape {
  const base = { type: d.type, promptMd: d.prompt.trim(), points: d.points };
  switch (d.type) {
    case "single_choice":
    case "multiple_choice":
    case "true_false":
      return {
        ...base,
        options: d.options
          .filter((o) => o.text.trim())
          .map((o) => ({ textMd: o.text.trim(), isCorrect: o.correct })),
      };
    case "short_text":
      return { ...base, config: { accepted: d.accepted.map((a) => a.trim()).filter(Boolean) } };
    case "matching":
      return {
        ...base,
        config: {
          pairs: d.pairs
            .filter((p) => p.left.trim() && p.right.trim())
            .map((p) => ({ left: p.left.trim(), right: p.right.trim() })),
        },
      };
    case "ordering":
      return { ...base, config: { steps: d.steps.map((s) => s.trim()).filter(Boolean) } };
    case "categorize": {
      // Ids g1…, c1… en orden, como al leer el CSV
      const cards: CategorizeCard[] = d.groups
        .flatMap((g, i) => g.cards.map((text) => ({ text: text.trim(), groupId: `g${i + 1}` })))
        .filter((k) => k.text)
        .map((k, j) => ({ id: `c${j + 1}`, kind: "text" as const, ...k }));
      return { ...base, config: { groups: d.groups.map((g, i) => ({ id: `g${i + 1}`, name: g.name.trim() })), cards } };
    }
    case "cloze": {
      // Los distractores solo existen en el banco (igual que en el editor)
      const distractors = d.clozeMode === "bank" ? d.distractors.map((w) => w.trim()).filter(Boolean) : [];
      return {
        ...base,
        config: { text: lfOnly(d.clozeText.trim()), mode: d.clozeMode, ...(distractors.length > 0 ? { distractors } : {}) },
      };
    }
    default:
      return base;
  }
}

/** El problema que impide importar este borrador, o null. */
export const draftProblem = (d: QuestionDraft): string | null => questionProblem(draftToInput(d));

/**
 * Grupos de un borrador como líneas para corregirlos a mano en la revisión:
 * «Frutas: Manzana; Pera», una por grupo.
 */
export function formatGroupLines(groups: QuestionDraft["groups"]): string {
  return groups.map((g) => `${g.name}: ${g.cards.join("; ")}`).join("\n");
}

/** Distractores escritos en la revisión, separados por «|» como en el Excel/CSV. */
export function splitDistractors(text: string): string[] {
  return text
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Lo escrito en la revisión → grupos. Cada línea no vacía es un grupo: su
 * nombre antes de «:» y sus tarjetas después, separadas por «;». Una línea sin
 * «:» es un grupo sin tarjetas (la validación lo dice).
 */
export function parseGroupLines(text: string): QuestionDraft["groups"] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(":");
      if (at < 0) return { name: line, cards: [] };
      return {
        name: line.slice(0, at).trim(),
        cards: line
          .slice(at + 1)
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    });
}
