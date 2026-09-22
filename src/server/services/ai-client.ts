import "server-only";
import { aiErrorMessage, openaiBase } from "./ai-settings";

/**
 * Llamada genérica a la Responses API de OpenAI con salida estructurada
 * (esquema estricto). La usan «Importar con IA» de exámenes y de estudiantes:
 * cada uno pone su instrucción, su esquema y cómo normalizar la respuesta.
 */

export type AiOpts = { key: string; model: string; fetchImpl?: typeof fetch };

/** Objeto del esquema estricto: sin propiedades extra y todas obligatorias. */
export const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

export type VisionPart =
  | { kind: "image"; dataUrl: string }
  | { kind: "pdf"; fileName: string; dataUrl: string };

export type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" }
  | { type: "input_file"; filename: string; file_data: string };

/** Mensaje del usuario para la visión: una instrucción corta y luego las imágenes o el PDF. */
export function visionMessage(intro: string, parts: VisionPart[]): ContentPart[] {
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

/** Una llamada con esquema estricto → lo que devuelva `parse` con el JSON de la IA. */
export async function requestStructured<T>(
  request: {
    system: string;
    content: string | ContentPart[];
    /** Nombre del esquema para OpenAI (solo letras, números, _ y -) */
    name: string;
    schema: unknown;
    parse: (json: unknown) => T;
  },
  opts: AiOpts,
  timeoutMs: number
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${openaiBase()}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        input: [
          { role: "system", content: request.system },
          { role: "user", content: request.content },
        ],
        text: { format: { type: "json_schema", name: request.name, strict: true, schema: request.schema } },
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
    return request.parse(JSON.parse(out.text));
  } catch {
    throw new MalformedAiResponse();
  }
}

/** Una respuesta mal formada se reintenta una vez. */
export async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MalformedAiResponse) return run();
    throw err;
  }
}
