import "server-only";
import type { SessionUser } from "@/server/auth/sessions";
import { actingOwnerId, type ViewScope } from "@/server/auth/view-scope";
import { requestWithTools, MalformedAiResponse, type AiOpts, type ChatItem, type ToolDef } from "@/server/services/ai-client";
import {
  ATTACHMENT_TITLE,
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getSummary,
  recentModelText,
  renameConversation,
  updateMessage,
} from "@/server/services/ai-conversations";
import { attachmentsOf, claimAttachments } from "@/server/services/attachment-intake";
import { attachmentDetail } from "@/lib/attachment-summary";
import { conversationTitle, type AssistantBlock, type AssistantMessage } from "@/lib/assistant-blocks";
import { getProposal } from "./proposal-store";
import { toolByName, toolDefsForRole } from "./registry";
import { systemPrompt } from "./prompt";
import { maybeSummarize } from "./summarize";
import { cleanParams, type ToolCtx, type ToolResult } from "./tool-types";

/**
 * Un turno del asistente: guarda el mensaje del usuario, deja que la IA
 * elija herramientas (hasta MAX_ROUNDS vueltas), las ejecuta con los permisos
 * del contexto y guarda la respuesta como bloques.
 */

export const MAX_ROUNDS = 6;
const HISTORY_MESSAGES = 6;
const TIMEOUT_MS = 60_000;

export type TurnInput = {
  user: SessionUser;
  scope: ViewScope;
  route: string;
  conversationId: string | null;
  text: string;
  /** Adjuntos de este mensaje (ids de `ai_attachments` del usuario; ver `claimAttachments`) */
  attachmentIds?: string[];
  /**
   * Resumir lo viejo al terminar (por defecto sí). Solo las pruebas que
   * cuentan llamadas a la IA lo apagan: el resumen hace la suya.
   */
  summarize?: boolean;
  ai: AiOpts;
};

export type TurnOutput =
  | { conversationId: string; userMessage: AssistantMessage; message: AssistantMessage }
  | { error: string };

function proposalBlock(proposalId: string): AssistantBlock | null {
  const p = getProposal(proposalId);
  if (!p) return null;
  return { type: "proposal", proposalId: p.id, title: p.draft.title, applyLabel: p.draft.applyLabel, columns: p.draft.columns, rows: p.rows, status: p.status, confirmWord: p.draft.confirmWord, recheckOnApply: p.draft.recheckOnApply };
}

export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const text = input.text.trim();
  if (!text) return { error: "Escribe algo para empezar." };
  const role = input.user.role;
  if (role !== "admin" && role !== "teacher") return { error: "El asistente es solo para maestros y administradores." };

  let conversationId = input.conversationId;
  const existing = conversationId ? getConversation(input.user.id, conversationId) : null;
  if (conversationId && !existing) conversationId = null;
  const created = !conversationId;
  if (!conversationId) conversationId = createConversation(input.user.id, text).id;
  // La conversación que nació de un archivo no tiene título propio: se lo da el primer mensaje
  else if (existing && existing.title === ATTACHMENT_TITLE && existing.messages.length === 0) {
    renameConversation(conversationId, conversationTitle(text));
  }

  // Los adjuntos viajan con el turno aunque la subida los dejara en otra
  // conversación del mismo usuario; uno ajeno o que ya no existe no se usa, y
  // se dice: contestar como si no hubiera archivo es justo lo que no debe pasar
  const claimed = input.attachmentIds?.length
    ? claimAttachments({ userId: input.user.id, conversationId, ids: input.attachmentIds })
    : [];
  if (claimed === null) {
    if (created) deleteConversation(input.user.id, conversationId);
    return { error: "Uno de los archivos adjuntos ya no está disponible. Quítalo y vuelve a adjuntarlo." };
  }
  const attachments = claimed.length ? attachmentsOf(conversationId, claimed) : [];

  // Historial corto ANTES de guardar el mensaje nuevo (para no duplicarlo).
  // Lo anterior al resumen no se repite en crudo: ya va comprimido en él.
  const { summary, summaryUpto } = getSummary(conversationId);
  const history = recentModelText(conversationId, HISTORY_MESSAGES, summaryUpto);
  const userBlocks: AssistantBlock[] = [
    { type: "text", text },
    ...attachments.map((a) => ({ type: "attachment" as const, name: a.summary.fileName, detail: attachmentDetail(a.summary) })),
  ];
  const userMessage = appendMessage(conversationId, "user", userBlocks, text);
  // El mensaje del asistente nace vacío: las propuestas cuelgan de él y se rellena al final
  const reply = appendMessage(conversationId, "assistant", [], "");

  const ctx: ToolCtx = {
    user: input.user,
    scope: input.scope,
    actingOwnerId: actingOwnerId(input.scope, input.user),
    route: input.route,
    conversationId,
    messageId: reply.id,
    attachments,
  };
  const tools: ToolDef[] = toolDefsForRole(role);

  const items: ChatItem[] = [
    { role: "system", content: systemPrompt({ user: input.user, scope: input.scope, route: input.route, attachments }) },
    ...(summary ? [{ role: "system", content: `Resumen de lo anterior: ${summary}` } as ChatItem] : []),
    ...history.map((m) => ({ role: m.role, content: m.text }) as ChatItem),
    { role: "user", content: text },
  ];

  const blocks: AssistantBlock[] = [];
  const usedTools: string[] = [];
  let undo: ToolResult["undo"];
  let finalText: string | null = null;
  // Turno cerrado: ya se hizo una acción instantánea o se creó una propuesta.
  // Una sola por turno: así cada mensaje tiene como mucho un «Deshacer» y un undo.
  let closed = false;

  try {
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      if (round === MAX_ROUNDS) {
        items.push({ role: "system", content: "Ya no puedes usar más herramientas en este turno: resume lo que encontraste y termina." });
      }
      const noTools = round === MAX_ROUNDS || closed;
      const activeTools = noTools ? [] : tools;
      // Una respuesta ilegible se reintenta una vez
      const turn = await requestWithTools(items, activeTools, input.ai, TIMEOUT_MS).catch((err) => {
        if (err instanceof MalformedAiResponse) return requestWithTools(items, activeTools, input.ai, TIMEOUT_MS);
        throw err;
      });
      if (turn.text) finalText = turn.text;
      if (turn.calls.length === 0 || noTools) break;

      for (const call of turn.calls) {
        items.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: JSON.stringify(call.args ?? {}) });
        const tool = toolByName(call.name);
        let output: string;
        if (closed) {
          // Tras una acción o propuesta no se ejecuta nada más; se contesta para que el historial quede completo
          output = "no ejecutada: ya se hizo una acción en este turno";
        } else if (!tool || !tool.roles.includes(role)) {
          output = `La herramienta «${call.name}» no existe o no está disponible para este usuario.`;
        } else {
          try {
            const params = cleanParams((call.args && typeof call.args === "object" ? call.args : {}) as Record<string, unknown>);
            const result = await tool.run(params, ctx);
            usedTools.push(call.name);
            output = result.forModel;
            if (result.blocks) blocks.push(...result.blocks);
            if (result.navigate) blocks.push({ type: "navigate", href: result.navigate });
            if (result.undo) {
              undo = result.undo;
              closed = true;
            }
            if (result.proposalId) {
              const block = proposalBlock(result.proposalId);
              if (block) blocks.push(block);
              closed = true;
            }
          } catch (err) {
            // El detalle solo al registro: la IA no debe repetir mensajes internos
            console.error(`[asistente] herramienta ${call.name} falló (conversación ${conversationId}):`, err);
            output = "error: la herramienta falló; díselo al usuario en una frase";
          }
        }
        items.push({ type: "function_call_output", call_id: call.callId, output });
      }
    }
  } catch (err) {
    // Lo que las herramientas ya hicieron (y su deshacer) se conserva junto al error
    const message = err instanceof Error ? err.message : "La IA no respondió.";
    blocks.push({ type: "error", text: message, retryable: true });
    return { conversationId, userMessage, message: finish(reply, blocks, null, usedTools, undo) };
  }

  if (finalText) blocks.push({ type: "text", text: finalText });
  if (blocks.length === 0) blocks.push({ type: "error", text: "No obtuve una respuesta. Intenta de nuevo.", retryable: true });
  const message = finish(reply, blocks, finalText, usedTools, undo);

  /**
   * Con el mensaje ya guardado, se resume lo viejo si toca. Se ESPERA en vez
   * de dejarlo suelto en segundo plano: una promesa suelta en una acción de
   * servidor puede quedarse a medias cuando la petición termina, y dos turnos
   * seguidos escribirían el mismo `summary` pisándose. Cuesta una llamada
   * barata una vez cada 10 mensajes, no en cada turno. Si el turno acabó en
   * error no se resume: la API acaba de fallar.
   */
  if (input.summarize !== false) await maybeSummarize(conversationId, input.ai);
  return { conversationId, userMessage, message };
}

/** Rellena el mensaje del asistente y lo devuelve tal como quedó. */
function finish(reply: AssistantMessage, blocks: AssistantBlock[], finalText: string | null, usedTools: string[], undo: ToolResult["undo"]): AssistantMessage {
  const modelText = [finalText ?? "", usedTools.length ? `[usó: ${[...new Set(usedTools)].join(", ")}]` : ""].filter(Boolean).join(" ");
  updateMessage(reply.id, blocks, modelText, undo);
  return { ...reply, blocks };
}
