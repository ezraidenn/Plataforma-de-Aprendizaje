import "server-only";
import { obj, requestStructured, type AiOpts } from "@/server/services/ai-client";
import { getSummary, recentModelText, saveSummary } from "@/server/services/ai-conversations";

/**
 * Resumen de lo viejo de una conversación. Sin esto, una charla larga solo
 * recuerda los últimos 6 mensajes: lo de antes se pierde. Con esto, lo viejo
 * se guarda comprimido en una línea que viaja en cada turno.
 *
 * Reglas fijas de aquí:
 * - Nunca lanza: si la IA falla, el asistente sigue funcionando sin resumen.
 * - Solo se resume cada `SUMMARIZE_EVERY` mensajes nuevos: es una llamada más
 *   y no vale la pena pagarla en cada turno.
 * - El resumen es corto a la fuerza (`MAX_CHARS`): se le manda a la IA en
 *   todos los turnos siguientes.
 */

/** Mensajes nuevos que tienen que juntarse para que valga la pena resumir. */
export const SUMMARIZE_EVERY = 10;

/** Tope de lo que se guarda: el modelo suele respetarlo, pero se recorta igual. */
const MAX_CHARS = 600;

/** Mensajes que se le pasan como mucho (protege si el resumen falló varias veces). */
const MAX_MESSAGES = 60;

const TIMEOUT_MS = 30_000;

const INSTRUCTION =
  "Resume en menos de 600 caracteres lo que se ha hecho y decidido en esta conversación entre un maestro y el asistente de una plataforma de capacitación: qué pidió, qué se hizo (altas, bajas, matrículas, consultas) y qué quedó pendiente. No inventes nada.";

/** Resume los mensajes viejos cuando pasan de SUMMARIZE_EVERY sin resumir. Nunca lanza. */
export async function maybeSummarize(conversationId: string, ai: AiOpts): Promise<boolean> {
  try {
    const { summary, summaryUpto, total } = getSummary(conversationId);
    if (total - summaryUpto < SUMMARIZE_EVERY) return false;

    const nuevos = recentModelText(conversationId, MAX_MESSAGES, summaryUpto);
    if (nuevos.length === 0) return false;

    const content = [
      summary ? `Resumen anterior: ${summary}` : "",
      ...nuevos.map((m) => `${m.role === "user" ? "Maestro" : "Asistente"}: ${m.text}`),
    ]
      .filter(Boolean)
      .join("\n");

    const resumen = await requestStructured(
      {
        system: INSTRUCTION,
        content,
        name: "resumen_conversacion",
        schema: obj({ resumen: { type: "string" } }),
        parse: (json) => {
          const text = (json as { resumen?: unknown }).resumen;
          if (typeof text !== "string" || text.trim() === "") throw new Error("sin resumen");
          return text.trim().slice(0, MAX_CHARS);
        },
      },
      ai,
      TIMEOUT_MS
    );

    saveSummary(conversationId, resumen, total);
    return true;
  } catch (err) {
    // Sin resumen se conversa igual (solo con menos memoria): esto no corta el turno
    console.error(`[asistente] no se pudo resumir la conversación ${conversationId}:`, err);
    return false;
  }
}
