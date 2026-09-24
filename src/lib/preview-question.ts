import type { QuestionKind, ReviewBoard, RunnerQuestion } from "@/components/student/types";
import type { QuestionDraft } from "./question-draft";
import { shuffledOrder } from "./ordering";
import {
  PRECISION_RADIUS,
  dragCopies,
  isImageQuestionType,
  readImageClick,
  readImageDrag,
  type ImageQuestionType,
} from "./image-questions";

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
};

function shuffle<T>(items: T[]): T[] {
  return shuffledOrder(items.length).map((i) => items[i]);
}

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
    // Los borradores nunca son preguntas sobre imagen
    image: null,
    imageDrag: null,
    imageClick: null,
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
    answerText: "La pregunta está incompleta: complétala en el editor.",
  };
  const drag = q.type === "image_drag" ? readImageDrag(q) : null;
  if (drag) {
    const c = drag.config;
    const views = new Map(c.elements.map(({ id, ...view }) => [id, view]));
    return {
      ...base,
      image: drag.image,
      imageDrag: {
        aspect: c.aspect,
        iconSize: c.iconSize,
        zones: shuffle(c.zones.map((z, i) => ({ token: `${q.id}-z${i}`, x: z.x, y: z.y }))),
        items: shuffle(
          dragCopies(c).map((cp) => ({ token: `${q.id}-e${cp.elementId}-${cp.copy}`, ...views.get(cp.elementId)! }))
        ),
      },
      answerText: null,
      solution: {
        kind: "drag",
        image: drag.image,
        aspect: c.aspect,
        iconSize: c.iconSize,
        // La config ya se validó: cada lugar apunta a un elemento que existe
        zones: c.zones.map((z) => ({ x: z.x, y: z.y, correct: true, placed: null, expected: views.get(z.elementId)! })),
        iconFiles: c.elements.flatMap((e) => (e.kind === "icon" && e.fileId ? [e.fileId] : [])),
      },
    };
  }
  const click = q.type === "image_click" ? readImageClick(q) : null;
  if (click) {
    const c = click.config;
    return {
      ...base,
      image: click.image,
      imageClick: { aspect: c.aspect, marks: c.spots.length },
      answerText: null,
      solution: {
        kind: "click",
        image: click.image,
        aspect: c.aspect,
        radius: PRECISION_RADIUS[c.precision],
        spots: c.spots.map((s) => ({ x: s.x, y: s.y, hit: true })),
        marks: [],
      },
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
    isImageQuestionType(q.type) ? imagePreview({ ...q, type: q.type }) : draftToPreview(questionToDraft({ ...q, type: q.type }))
  );
}

/** Pregunta guardada en la BD → borrador (para «Ver como alumno» del examen actual). */
export function questionToDraft(q: {
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
