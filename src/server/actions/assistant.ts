"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { actingOwnerId } from "@/server/auth/view-scope";
import { getAiKey, getAiSettings } from "@/server/services/ai-settings";
import { runTurn } from "@/server/assistant/agent";
import { applyProposal, cancelProposal } from "@/server/assistant/proposals";
import { toolByName } from "@/server/assistant/registry";
import type { ToolCtx } from "@/server/assistant/tool-types";
import {
  deleteConversation,
  getConversation,
  listConversations,
  markUndone,
  messageUndo,
} from "@/server/services/ai-conversations";
import type { AssistantMessage, ConversationSummary, ProposalRow } from "@/lib/assistant-blocks";

/**
 * Puerta del asistente. Todas exigen maestro o admin; el contexto de vista se
 * lee de la cookie como en el resto de /teach.
 */

const NO_KEY_ADMIN = "La IA no está configurada. Agrega la clave de OpenAI en Configuración → Inteligencia artificial.";
const NO_KEY_TEACHER = "La IA no está configurada. Pide al administrador que la active en Configuración.";
const UNDO_WINDOW_MS = 10 * 60 * 1000;

export type SendTurnResult =
  | { ok: true; conversationId: string; userMessage: AssistantMessage; message: AssistantMessage }
  | { error: string; noKey?: boolean };

export async function sendTurnAction(input: { conversationId: string | null; text: string; route: string }): Promise<SendTurnResult> {
  const user = await requireTeacher();
  const key = getAiKey();
  // Solo el admin puede configurar la clave: solo a él se le manda a Configuración
  if (!key) return user.role === "admin" ? { error: NO_KEY_ADMIN, noKey: true } : { error: NO_KEY_TEACHER };
  const scope = await getViewScope(user);
  const result = await runTurn({
    user,
    scope,
    route: typeof input.route === "string" ? input.route.slice(0, 200) : "/",
    conversationId: typeof input.conversationId === "string" ? input.conversationId : null,
    text: String(input.text ?? "").slice(0, 4000),
    ai: { key, model: getAiSettings().model },
  });
  if ("error" in result) return result;
  refreshAfterChange();
  return { ok: true, ...result };
}

/** Contexto de herramienta para acciones fuera del bucle (aplicar, deshacer). */
async function toolContext(user: Awaited<ReturnType<typeof requireTeacher>>, conversationId: string, messageId: string): Promise<ToolCtx> {
  const scope = await getViewScope(user);
  return { user, scope, actingOwnerId: actingOwnerId(scope, user), route: "/", conversationId, messageId, attachments: [] };
}

export async function applyProposalAction(input: { proposalId: string; rows: ProposalRow[] }): Promise<{ ok: true; text: string } | { error: string }> {
  const user = await requireTeacher();
  const rows = validRows(input.rows);
  const result = await applyProposal(String(input.proposalId ?? ""), rows, await toolContext(user, "", ""));
  if ("error" in result) return result;
  refreshAfterChange();
  return { ok: true, text: result.text };
}

export async function cancelProposalAction(input: { proposalId: string }): Promise<{ ok: boolean }> {
  const user = await requireTeacher();
  return { ok: cancelProposal(String(input.proposalId ?? ""), user.id) };
}

/** Revierte la acción instantánea de un mensaje, una sola vez y antes de 10 min. */
export async function undoAction(input: { conversationId: string; messageId: string }): Promise<{ ok: true; text: string } | { error: string }> {
  const user = await requireTeacher();
  const found = messageUndo(user.id, String(input.conversationId ?? ""), String(input.messageId ?? ""));
  if (!found) return { error: "No hay nada que deshacer." };
  if (found.undoneAt) return { error: "Ya se deshizo." };
  if (Date.now() - found.createdAt.getTime() > UNDO_WINDOW_MS) return { error: "Pasaron más de 10 minutos; ya no se puede deshacer desde aquí." };
  const tool = toolByName(found.undo.tool);
  if (!tool?.undo) return { error: "No se puede deshacer esta acción." };
  try {
    const result = await tool.undo(found.undo.params, await toolContext(user, input.conversationId, found.id));
    const blocks = found.blocks.map((b) => (b.type === "result" ? { ...b, undone: true } : b));
    markUndone(found.id, blocks);
    refreshAfterChange();
    return { ok: true, text: result.forModel };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo deshacer esta acción." };
  }
}

export async function listConversationsAction(input: { q?: string }): Promise<ConversationSummary[]> {
  const user = await requireTeacher();
  return listConversations(user.id, typeof input?.q === "string" ? input.q.slice(0, 100) : undefined);
}

export async function getConversationAction(input: { id: string }): Promise<{ id: string; title: string; messages: AssistantMessage[] } | null> {
  const user = await requireTeacher();
  return getConversation(user.id, String(input.id ?? ""));
}

export async function deleteConversationAction(input: { id: string }): Promise<{ ok: boolean }> {
  const user = await requireTeacher();
  return { ok: deleteConversation(user.id, String(input.id ?? "")) };
}

const MAX_ROWS = 5000;

/** Filas del cliente con forma de fila: `id` texto y `cells` objeto; tope de 5000. */
function validRows(input: unknown): ProposalRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((r): r is ProposalRow => {
      if (!r || typeof r !== "object") return false;
      const { id, cells } = r as { id?: unknown; cells?: unknown };
      return typeof id === "string" && !!cells && typeof cells === "object" && !Array.isArray(cells);
    })
    .slice(0, MAX_ROWS);
}

/** Las pantallas de fondo se rearman: una matrícula cambia listas y conteos. */
function refreshAfterChange() {
  revalidatePath("/teach", "layout");
}
