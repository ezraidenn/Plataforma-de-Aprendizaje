import "server-only";
import type { SessionUser } from "@/server/auth/sessions";
import { actingOwnerId, type ViewScope } from "@/server/auth/view-scope";
import { requestWithTools, MalformedAiResponse, type AiOpts, type ChatItem, type ToolDef } from "@/server/services/ai-client";
import { appendMessage, createConversation, getConversation, recentModelText, updateMessage } from "@/server/services/ai-conversations";
import type { AssistantBlock, AssistantMessage } from "@/lib/assistant-blocks";
import { getProposal } from "./proposal-store";
import { toolByName, toolDefsForRole } from "./registry";
import { systemPrompt } from "./prompt";
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
  ai: AiOpts;
};

export type TurnOutput =
  | { conversationId: string; userMessage: AssistantMessage; message: AssistantMessage }
  | { error: string };

function proposalBlock(proposalId: string): AssistantBlock | null {
  const p = getProposal(proposalId);
  if (!p) return null;
  return { type: "proposal", proposalId: p.id, title: p.draft.title, applyLabel: p.draft.applyLabel, columns: p.draft.columns, rows: p.rows, status: p.status };
}

export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const text = input.text.trim();
  if (!text) return { error: "Escribe algo para empezar." };
  const role = input.user.role;
  if (role !== "admin" && role !== "teacher") return { error: "El asistente es solo para maestros y administradores." };

  let conversationId = input.conversationId;
  if (conversationId && !getConversation(input.user.id, conversationId)) conversationId = null;
  if (!conversationId) conversationId = createConversation(input.user.id, text).id;

  // Historial corto ANTES de guardar el mensaje nuevo (para no duplicarlo)
  const history = recentModelText(conversationId, HISTORY_MESSAGES);
  const userMessage = appendMessage(conversationId, "user", [{ type: "text", text }], text);
  // El mensaje del asistente nace vacío: las propuestas cuelgan de él y se rellena al final
  const reply = appendMessage(conversationId, "assistant", [], "");

  const ctx: ToolCtx = {
    user: input.user,
    scope: input.scope,
    actingOwnerId: actingOwnerId(input.scope, input.user),
    route: input.route,
    conversationId,
    messageId: reply.id,
  };
  const tools: ToolDef[] = toolDefsForRole(role);

  const items: ChatItem[] = [
    { role: "system", content: systemPrompt({ user: input.user, scope: input.scope, route: input.route }) },
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
  return { conversationId, userMessage, message: finish(reply, blocks, finalText, usedTools, undo) };
}

/** Rellena el mensaje del asistente y lo devuelve tal como quedó. */
function finish(reply: AssistantMessage, blocks: AssistantBlock[], finalText: string | null, usedTools: string[], undo: ToolResult["undo"]): AssistantMessage {
  const modelText = [finalText ?? "", usedTools.length ? `[usó: ${[...new Set(usedTools)].join(", ")}]` : ""].filter(Boolean).join(" ");
  updateMessage(reply.id, blocks, modelText, undo);
  return { ...reply, blocks };
}
