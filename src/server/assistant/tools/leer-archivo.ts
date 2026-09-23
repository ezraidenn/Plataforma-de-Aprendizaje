import "server-only";
import { attachmentBytes, attachmentsOf } from "@/server/services/attachment-intake";
import { getAiKey, getAiSettings } from "@/server/services/ai-settings";
import { extractText } from "@/server/services/text-extract";
import { obj, requestStructured, visionMessage, withRetry, type AiOpts, type VisionPart } from "@/server/services/ai-client";
import { summaryForModel } from "@/lib/attachment-summary";
import { visionPartsOf } from "../rows-from-attachment";
import { schema, str, param, type AssistantTool } from "../tool-types";

/**
 * «¿Qué contiene este archivo?»: lo que se sabe del último adjunto sin tocar
 * nada. De una hoja se devuelve su resumen (hojas, filas, columnas y muestra);
 * de un documento, el principio de su texto; y de una foto o un PDF escaneado,
 * lo que vea la IA, por la MISMA ruta de visión que usa el alta de alumnos.
 */

/** Palabras del documento que se le devuelven a la IA: de sobra para decir qué es. */
const MAX_WORDS = 800;

const DESC_SCHEMA = obj({ descripcion: { type: "string" } });

const DESC_PROMPT = [
  "Describes archivos para el asistente de una plataforma de capacitación. Responde en español, en dos o tres frases, y no inventes nada que no se vea.",
  "Si es una lista de personas, di cuántas hay y qué columnas trae (nombre, correo, grupo…).",
  "No transcribas la lista entera ni los correos: solo di qué hay.",
].join("\n");

/** Lo que la IA ve en la foto o en el escaneo, en un par de frases. */
async function describirConIa(parts: VisionPart[], opts: AiOpts, pregunta: string): Promise<string> {
  const intro = [
    parts.some((p) => p.kind === "pdf")
      ? "Describe brevemente qué hay en este PDF escaneado:"
      : "Describe brevemente qué hay en esta imagen:",
    "si es una lista de personas, di cuántas y qué columnas trae.",
    pregunta ? `El usuario pregunta: ${pregunta}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return withRetry(() =>
    requestStructured(
      {
        system: DESC_PROMPT,
        content: visionMessage(intro, parts),
        name: "descripcion",
        schema: DESC_SCHEMA,
        parse: (json) => String((json as { descripcion?: unknown } | null)?.descripcion ?? "").trim(),
      },
      opts,
      240_000
    )
  );
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export const leerArchivo: AssistantTool = {
  name: "leer_archivo",
  description:
    "Dice qué contiene el archivo adjunto sin cambiar nada: de un Excel o CSV, sus hojas, filas y columnas; de un documento, el principio de su texto; y de una foto o un PDF escaneado, lo que la IA vea en él. Úsala cuando el usuario pregunte qué trae el archivo o no esté claro qué es.",
  parameters: schema({
    pregunta: str('Qué quiere saber el usuario del archivo, en pocas palabras («» = simplemente qué contiene)'),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  async run(params, ctx) {
    // El de este mensaje; si no lo hay, el último de la conversación (se avisa)
    const delMensaje = ctx.attachments.at(-1);
    const adjunto = delMensaje ?? attachmentsOf(ctx.conversationId).at(-1);
    if (!adjunto) {
      return { forModel: "No hay ningún archivo adjunto en este mensaje ni antes en esta conversación. Pide al usuario que lo adjunte." };
    }
    const deAntes = delMensaje ? "" : " (es el último archivo de esta conversación, no de este mensaje: dilo al contestar)";
    const { summary } = adjunto;
    const pregunta = param(params, "pregunta");

    // Hoja de cálculo: ya está todo en el resumen, sin gastar IA
    if (summary.kind === "sheet") {
      return { forModel: `Esto es lo que trae el archivo:\n${summaryForModel(summary)}\nCuéntaselo al usuario con tus palabras y ofrécele qué hacer con él.${deAntes}` };
    }

    let bytes: Buffer;
    let fileName: string;
    try {
      ({ bytes, fileName } = await attachmentBytes(adjunto));
    } catch (err) {
      return { forModel: errorText(err, "El archivo adjunto ya no está disponible.") };
    }

    // Foto o PDF escaneado: lo lee la IA con visión
    if (summary.kind === "image") {
      const key = getAiKey();
      if (!key) {
        return { forModel: `Para leer «${fileName}» hace falta la IA y no hay clave configurada. Dile al usuario que el administrador tiene que agregar la clave de OpenAI.` };
      }
      try {
        const { parts } = await visionPartsOf(bytes, fileName);
        const descripcion = await describirConIa(parts, { key, model: getAiSettings().model }, pregunta);
        if (!descripcion) return { forModel: `La IA no pudo describir «${fileName}». Pide al usuario una foto más nítida o el archivo original.` };
        return {
          forModel: `Esto es lo que la IA ve en «${fileName}»: ${descripcion}\nSi es una lista de personas, ofrécele darlas de alta con alta_alumnos (origen "adjunto").${deAntes}`,
        };
      } catch (err) {
        return { forModel: errorText(err, `No pude leer «${fileName}».`) };
      }
    }

    // Documento con texto: el principio, que es donde se ve qué es
    try {
      const { text, chars } = await extractText(bytes, fileName);
      const words = text.split(/\s+/).filter(Boolean);
      const trozo = words.slice(0, MAX_WORDS).join(" ");
      const resto = words.length > MAX_WORDS ? ` (…solo te doy las primeras ${MAX_WORDS} palabras de ${chars} caracteres)` : "";
      return { forModel: `Principio de «${fileName}»${resto}:\n${trozo}\nResume al usuario qué es y ofrécele qué hacer con él.${deAntes}` };
    } catch (err) {
      return { forModel: errorText(err, `No pude leer «${fileName}».`) };
    }
  },
};
