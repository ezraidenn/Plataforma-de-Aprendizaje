import type { QuestionKind, RunnerQuestion } from "@/components/student/types";
import type { AnswerBoard } from "./answer-boards";
import type { QuestionDraft } from "./question-draft";
import { shuffledOrder } from "./ordering";
import { clickReviewBoard, dragReviewBoard, type ReviewBoard } from "./image-boards";
import { elementView } from "./image-layout";
import {
  dragCopies,
  isImageQuestionType,
  readImageClick,
  readImageDrag,
  type ImageQuestionType,
} from "./image-questions";
import { categorizeBoard, categorizeSolutionText, categorizeView, readCategorize } from "./categorize";
import { clozeBoard, clozeSolutionText, clozeView, readCloze } from "./cloze";

/**
 * Pregunta de la vista previa «Ver como alumno»: lo mismo que recibe el
 * alumno (RunnerQuestion) más el texto de la respuesta correcta, que solo ve
 * el maestro al encender «Mostrar respuestas correctas». Todo es local: los
 * tokens no son los del servidor y nada se califica.
 */
export type PreviewQuestion = RunnerQuestion & {
  /** Respuesta correcta en texto; null en las abiertas */
  answerText: string | null;
  /** Preguntas sobre imagen: la solución dibujada, en vez del texto. */
  solution?: ReviewBoard;
  /** Clasificar y completar: la solución como tablero (cada tarjeta en su grupo, cada hueco con su respuesta), además del texto. */
  answerBoard?: AnswerBoard;
};

function shuffle<T>(items: T[]): T[] {
  return shuffledOrder(items.length).map((i) => items[i]);
}

/** Lo que dice la vista previa en lugar de la solución de una pregunta que no se puede mostrar. */
const INCOMPLETE = "La pregunta está incompleta: complétala en el editor.";

/** Borrador → pregunta de vista previa, revuelta como la ve el alumno. */
export function draftToPreview(d: QuestionDraft): PreviewQuestion {
  const withOptions = d.type === "single_choice" || d.type === "multiple_choice" || d.type === "true_false";
  const correct = d.options.filter((o) => o.correct).map((o) => o.text);
  const answerText =
    withOptions
      ? correct.join(" · ") || null
      : d.type === "short_text"
        ? d.accepted.join(" · ") || null
        : d.type === "matching"
          ? d.pairs.map((p) => `${p.left} → ${p.right}`).join(" · ") || null
          : d.type === "ordering"
            ? d.steps.map((s, i) => `${i + 1}. ${s}`).join(" · ") || null
            : null;

  return {
    id: d.key,
    type: d.type,
    promptMd: d.prompt,
    points: d.points,
    options: withOptions ? d.options.map((o, i) => ({ id: `${d.key}-o${i}`, text: o.text })) : [],
    matching:
      d.type === "matching"
        ? {
            lefts: d.pairs.map((p) => p.left),
            rights: shuffle(d.pairs.map((p, i) => ({ token: `${d.key}-r${i}`, text: p.right }))),
          }
        : null,
    ordering:
      d.type === "ordering"
        ? { steps: shuffledOrder(d.steps.length).map((i) => ({ token: `${d.key}-s${i}`, text: d.steps[i] })) }
        : null,
    // Los borradores nunca son preguntas sobre imagen (ni, por ahora, de clasificar o completar)
    image: null,
    imageDrag: null,
    imageClick: null,
    categorize: null,
    cloze: null,
    answerText,
  };
}

/**
 * Pregunta sobre imagen (guardada o la que se está editando) → vista previa.
 * Como la del alumno, pero con fichas locales: el id del elemento con el
 * número de copia, sin secreto que guardar. Lleva la solución como tablero.
 */
export function imagePreview(q: {
  id: string;
  type: ImageQuestionType;
  promptMd: string;
  points: number;
  imageFileId: string | null;
  config: unknown;
}): PreviewQuestion {
  const base: PreviewQuestion = {
    id: q.id,
    type: q.type,
    promptMd: q.promptMd,
    points: q.points,
    options: [],
    matching: null,
    ordering: null,
    image: null,
    imageDrag: null,
    imageClick: null,
    categorize: null,
    cloze: null,
    answerText: INCOMPLETE,
  };
  const drag = q.type === "image_drag" ? readImageDrag(q) : null;
  if (drag) {
    const c = drag.config;
    return {
      ...base,
      image: drag.image,
      imageDrag: {
        aspect: c.aspect,
        zones: shuffle(c.zones.map((z, i) => ({ token: `${q.id}-z${i}`, x: z.x, y: z.y }))),
        items: shuffle(
          dragCopies(c).map((cp) => ({
            token: `${q.id}-e${cp.elementId}-${cp.copy}`,
            ...elementView(c.elements[cp.elementIndex], c.iconSize),
          }))
        ),
      },
      answerText: null,
      solution: dragReviewBoard(drag.image, c),
    };
  }
  const click = q.type === "image_click" ? readImageClick(q) : null;
  if (click) {
    return {
      ...base,
      image: click.image,
      imageClick: { aspect: click.config.aspect, marks: click.config.spots.length },
      answerText: null,
      solution: clickReviewBoard(click.image, click.config),
    };
  }
  return base;
}

/**
 * Clasificar o completar (guardada o la que se está editando) → vista previa.
 * Como la del alumno, con fichas locales (el id de la tarjeta o del grupo, el
 * índice del hueco): sin secreto que guardar. Lleva la solución en texto y
 * como tablero.
 */
export function boardPreview(q: {
  id: string;
  type: "categorize" | "cloze";
  promptMd: string;
  points: number;
  config: unknown;
}): PreviewQuestion {
  const base: PreviewQuestion = {
    id: q.id,
    type: q.type,
    promptMd: q.promptMd,
    points: q.points,
    options: [],
    matching: null,
    ordering: null,
    image: null,
    imageDrag: null,
    imageClick: null,
    categorize: null,
    cloze: null,
    answerText: INCOMPLETE,
  };
  const cat = q.type === "categorize" ? readCategorize(q) : null;
  if (cat) {
    return {
      ...base,
      categorize: categorizeView(cat, { group: (id) => `${q.id}-g-${id}`, card: (id) => `${q.id}-c-${id}` }, shuffle),
      answerText: categorizeSolutionText(cat),
      answerBoard: categorizeBoard(cat),
    };
  }
  const cloze = q.type === "cloze" ? readCloze(q) : null;
  if (cloze) {
    return {
      ...base,
      cloze: clozeView(
        cloze,
        { blank: (i) => `${q.id}-b${i}`, word: (key) => `${q.id}-w-${key}`, option: (i, k) => `${q.id}-o${i}-${k}` },
        shuffle
      ),
      answerText: clozeSolutionText(cloze),
      answerBoard: clozeBoard(cloze),
    };
  }
  return base;
}

/** Preguntas guardadas del examen → vista previa «Ver como alumno», en su orden. */
export function questionsToPreview(
  qs: {
    id: string;
    type: QuestionKind;
    promptMd: string;
    points: number;
    config: unknown;
    imageFileId: string | null;
    options: { textMd: string; isCorrect: boolean }[];
  }[]
): PreviewQuestion[] {
  return qs.map((q) =>
    isImageQuestionType(q.type)
      ? imagePreview({ ...q, type: q.type })
      : q.type === "categorize" || q.type === "cloze"
        ? boardPreview({ ...q, type: q.type })
        : draftToPreview(questionToDraft({ ...q, type: q.type }))
  );
}

/** Pregunta guardada en la BD → borrador (para «Ver como alumno» del examen actual). */
function questionToDraft(q: {
  id: string;
  type: QuestionDraft["type"];
  promptMd: string;
  points: number;
  config: unknown;
  options: { textMd: string; isCorrect: boolean }[];
}): QuestionDraft {
  const config = (q.config ?? {}) as { accepted?: string[]; pairs?: { left: string; right: string }[]; steps?: string[] };
  return {
    key: q.id,
    type: q.type,
    prompt: q.promptMd,
    points: q.points,
    options: q.options.map((o) => ({ text: o.textMd, correct: o.isCorrect })),
    accepted: Array.isArray(config.accepted) ? config.accepted : [],
    pairs: Array.isArray(config.pairs) ? config.pairs : [],
    steps: Array.isArray(config.steps) ? config.steps : [],
    issues: [],
  };
}
