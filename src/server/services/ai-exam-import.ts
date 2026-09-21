import "server-only";
import { nanoid } from "nanoid";
import { aiErrorMessage, openaiBase } from "./ai-settings";
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

const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

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

/** Saca el texto (o la negativa) de una respuesta de la Responses API. */
function outputOf(body: unknown): { text?: string; refusal?: string } {
  const output = (body as { output?: { content?: { type: string; text?: string; refusal?: string }[] }[] }).output ?? [];
  for (const item of output) {
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") return { text: c.text };
      if (c.type === "refusal") return { refusal: c.refusal ?? "" };
    }
  }
  return {};
}

/** Error de respuesta ilegible: quien llama reintenta una vez. */
export class MalformedAiResponse extends Error {
  constructor() {
    super("La IA devolvió una respuesta mal formada.");
  }
}

export type VisionPart =
  | { kind: "image"; dataUrl: string }
  | { kind: "pdf"; fileName: string; dataUrl: string };

type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" }
  | { type: "input_file"; filename: string; file_data: string };

/** Mensaje del usuario para la visión: una instrucción corta y luego las imágenes o el PDF. */
export function visionContent(parts: VisionPart[]): ContentPart[] {
  const images = parts.filter((p) => p.kind === "image").length;
  const intro = parts.some((p) => p.kind === "pdf")
    ? "Transcribe las preguntas de este PDF escaneado."
    : images === 1
      ? "Transcribe las preguntas de esta imagen."
      : `Transcribe las preguntas de estas ${images} imágenes, en orden.`;
  return [
    { type: "input_text", text: intro },
    ...parts.map(
      (p): ContentPart =>
        p.kind === "image"
          ? { type: "input_image", image_url: p.dataUrl, detail: "high" }
          : { type: "input_file", filename: p.fileName, file_data: p.dataUrl }
    ),
  ];
}

type AiOpts = { key: string; model: string; fetchImpl?: typeof fetch };

/** Una llamada a la Responses API con el esquema estricto → borradores. */
async function requestDrafts(content: string | ContentPart[], opts: AiOpts, timeoutMs: number): Promise<QuestionDraft[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${openaiBase()}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
        text: { format: { type: "json_schema", name: "examen", strict: true, schema: AI_SCHEMA } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(aiErrorMessage(null));
  }
  const raw = await res.text();
  if (!res.ok) throw new Error(aiErrorMessage(res.status, raw));

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new MalformedAiResponse();
  }
  const out = outputOf(body);
  if (out.refusal !== undefined) throw new Error("La IA se negó a procesar este contenido.");
  if (!out.text) throw new MalformedAiResponse();
  try {
    return toDrafts(JSON.parse(out.text));
  } catch {
    throw new MalformedAiResponse();
  }
}

/** Una respuesta mal formada se reintenta una vez. */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MalformedAiResponse) return run();
    throw err;
  }
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
