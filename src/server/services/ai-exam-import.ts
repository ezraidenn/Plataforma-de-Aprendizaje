import "server-only";
import { nanoid } from "nanoid";
import { obj, requestStructured, visionMessage, withRetry, type AiOpts, type VisionPart } from "./ai-client";
import type { DraftType, QuestionDraft } from "@/lib/question-draft";

/**
 * Interpretación con OpenAI: el texto del archivo se manda por tramos (sin
 * partir preguntas); las imágenes y los PDF escaneados, con la visión del
 * modelo. Siempre se pide salida estructurada con un esquema estricto.
 * La IA solo TRANSCRIBE: no inventa preguntas, opciones ni respuestas.
 */

export const CHUNK_CHARS = 12_000;

/** Línea que empieza una pregunta: «12.», «3)», «Pregunta 4», «¿…», «¡…». */
const QUESTION_START = /^\s*(\d{1,3}\s*[.)\-]\s|pregunta\s+\d+|[¿¡])/i;

/**
 * Parte el texto en tramos de ~CHUNK_CHARS, cortando siempre ANTES de una
 * línea que empieza pregunta. Un bloque sin inicios muy largo se corta en el
 * salto de línea más cercano al límite.
 */
export function splitIntoChunks(text: string): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  /** Índice (en `current`) de la última línea que empieza pregunta */
  let lastStart = -1;

  const flush = (upTo: number) => {
    const piece = current.slice(0, upTo).join("\n").trim();
    if (piece) chunks.push(piece);
    current = current.slice(upTo);
    size = current.reduce((n, l) => n + l.length + 1, 0);
    lastStart = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      if (QUESTION_START.test(current[i])) {
        lastStart = i;
        break;
      }
    }
  };

  for (const line of lines) {
    const startsQuestion = QUESTION_START.test(line);
    if (size + line.length + 1 > CHUNK_CHARS && startsQuestion && current.length > 0) {
      // Pasaría del tamaño y esta línea abre pregunta: el tramo cierra aquí
      flush(current.length);
    } else if (size + line.length + 1 > CHUNK_CHARS * 1.5 && current.length > 0) {
      // Un bloque sin inicios demasiado largo: cortar en la última pregunta o aquí
      flush(lastStart > 0 ? lastStart : current.length);
    }
    current.push(line);
    size += line.length + 1;
    if (startsQuestion) lastStart = current.length - 1;
  }
  flush(current.length);
  return chunks;
}

// ─── Esquema estricto ────────────────────────────────────────────────────────

const TYPES: DraftType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_text",
  "matching",
  "ordering",
  "open_text",
];

export const AI_SCHEMA = obj({
  questions: {
    type: "array",
    items: obj({
      type: { type: "string", enum: TYPES },
      prompt: { type: "string" },
      points: { type: ["number", "null"] },
      options: { type: "array", items: obj({ text: { type: "string" }, correct: { type: "boolean" } }) },
      accepted: { type: "array", items: { type: "string" } },
      pairs: { type: "array", items: obj({ left: { type: "string" }, right: { type: "string" } }) },
      steps: { type: "array", items: { type: "string" } },
      issues: { type: "array", items: { type: "string" } },
    }),
  },
});

export const SYSTEM_PROMPT = [
  "Eres un transcriptor de exámenes. Del texto o las imágenes que recibes, identifica CADA pregunta y devuélvela con su tipo y formato. Transcribe fielmente: no inventes preguntas, opciones ni respuestas, y no corrijas el contenido.",
  "Tipos disponibles:",
  "- single_choice: opción única (una sola correcta).",
  "- multiple_choice: opción múltiple (varias correctas).",
  "- true_false: verdadero o falso (dos opciones, «Verdadero» y «Falso»).",
  "- short_text: respuesta corta; en `accepted` van las respuestas que se aceptan.",
  "- matching: relacionar columnas; en `pairs` va cada par izquierda → derecha.",
  "- ordering: ordenar pasos; en `steps` van los pasos en el ORDEN CORRECTO.",
  "- open_text: respuesta abierta que calificará el instructor.",
  "Reglas:",
  "- La respuesta correcta se reconoce por las marcas del documento: asteriscos, «(x)», «correcta», «Respuesta: b», una clave de respuestas al final, una columna «correcta» en tablas, etc.",
  "- Si no hay forma de saber cuál es la correcta, déjala sin marcar y agrega a `issues` «No se indica la respuesta correcta».",
  "- Si dudas del tipo, elige el más probable y agrega a `issues` «Tipo dudoso».",
  "- El texto de cada opción va SIN su letra o número inicial («a)», «1.», «B -»).",
  "- `points`: solo si el documento los indica; si no, null.",
  "- Si la última pregunta del texto quedó cortada, omítela.",
  "- Si recibes imágenes o páginas, léelas todas en orden: una pregunta puede empezar en una y continuar en la siguiente.",
  "- Ignora sellos, logotipos, encabezados, números de página y marcas que no sean parte de las preguntas.",
  "- Los campos que no aplican a un tipo van como listas vacías.",
].join("\n");

type AiQuestion = {
  type: DraftType;
  prompt: string;
  points: number | null;
  options: { text: string; correct: boolean }[];
  accepted: string[];
  pairs: { left: string; right: string }[];
  steps: string[];
  issues: string[];
};

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];

/**
 * Respuesta de la IA → borradores normalizados. La respuesta no es de fiar
 * aunque venga con esquema: se revisa cada campo antes de usarlo. `issues`
 * guarda solo las notas de la IA; lo que impide importar se calcula aparte
 * (draftProblem), en vivo, para que desaparezca al corregirlo.
 */
export function toDrafts(parsed: unknown): QuestionDraft[] {
  const list = (parsed as { questions?: unknown } | null)?.questions;
  return (Array.isArray(list) ? (list as Partial<AiQuestion>[]) : [])
    .filter(
      (q): q is AiQuestion =>
        !!q && TYPES.includes(q.type as DraftType) && typeof q.prompt === "string" && !!q.prompt.trim()
    )
    .map((q) => {
      let options = (Array.isArray(q.options) ? q.options : [])
        .filter((o) => o && typeof o.text === "string" && o.text.trim())
        .map((o) => ({ text: o.text.trim(), correct: o.correct === true }));
      if (q.type === "true_false") {
        // Siempre «Verdadero» y «Falso»; la correcta se deduce del texto de la marcada
        const marked = options.find((o) => o.correct)?.text.toLowerCase() ?? "";
        const isTrue = /^(v|verdadero|true|cierto|s[ií])/.test(marked);
        const isFalse = /^(f|falso|false|no)/.test(marked);
        options = [
          { text: "Verdadero", correct: isTrue },
          { text: "Falso", correct: isFalse && !isTrue },
        ];
      }
      const draft: QuestionDraft = {
        key: nanoid(8),
        type: q.type,
        prompt: q.prompt.trim(),
        points: typeof q.points === "number" && q.points > 0 ? q.points : 1,
        options,
        accepted: asStrings(q.accepted),
        pairs: (Array.isArray(q.pairs) ? q.pairs : [])
          .filter((p) => p && typeof p.left === "string" && typeof p.right === "string" && p.left.trim() && p.right.trim())
          .map((p) => ({ left: p.left.trim(), right: p.right.trim() })),
        steps: asStrings(q.steps),
        issues: asStrings(q.issues),
      };
      return draft;
    });
}

// Lo genérico (llamada, reintento, visión) vive en ai-client; se reexporta lo
// que ya usaban otros módulos.
export { MalformedAiResponse, type VisionPart } from "./ai-client";

/** Mensaje del usuario para la visión: una instrucción corta y luego las imágenes o el PDF. */
export function visionContent(parts: VisionPart[]) {
  const images = parts.filter((p) => p.kind === "image").length;
  const intro = parts.some((p) => p.kind === "pdf")
    ? "Transcribe las preguntas de este PDF escaneado."
    : images === 1
      ? "Transcribe las preguntas de esta imagen."
      : `Transcribe las preguntas de estas ${images} imágenes, en orden.`;
  return visionMessage(intro, parts);
}

/** Una llamada a la Responses API con el esquema estricto → borradores. */
function requestDrafts(content: Parameters<typeof requestStructured>[0]["content"], opts: AiOpts, timeoutMs: number) {
  return requestStructured(
    { system: SYSTEM_PROMPT, content, name: "examen", schema: AI_SCHEMA, parse: toDrafts },
    opts,
    timeoutMs
  );
}

/** Manda un tramo de texto a OpenAI y devuelve sus borradores. */
export async function interpretChunk(chunk: string, opts: AiOpts): Promise<QuestionDraft[]> {
  return requestDrafts(chunk, opts, 120_000);
}

export async function interpretChunkWithRetry(chunk: string, opts: AiOpts): Promise<QuestionDraft[]> {
  return withRetry(() => interpretChunk(chunk, opts));
}

/**
 * Imágenes (todas juntas, en orden) o un PDF escaneado → borradores. Más tiempo
 * que el texto: leer varias páginas como imagen tarda.
 */
export async function interpretVision(parts: VisionPart[], opts: AiOpts): Promise<QuestionDraft[]> {
  return requestDrafts(visionContent(parts), opts, 240_000);
}

export async function interpretVisionWithRetry(parts: VisionPart[], opts: AiOpts): Promise<QuestionDraft[]> {
  return withRetry(() => interpretVision(parts, opts));
}
