"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { actingOwnerId } from "@/server/auth/view-scope";
import { chatModelOf, getAiKey } from "@/server/services/ai-settings";
import { runTurn } from "@/server/assistant/agent";
import { applyProposal, cancelProposal, expireProposals } from "@/server/assistant/proposals";
import { rateLimitHit } from "@/server/assistant/rate-limit";
import { platformSuggestions, type Suggestion } from "@/server/assistant/suggestions";
import { toolByName } from "@/server/assistant/registry";
import type { ToolCtx } from "@/server/assistant/tool-types";
import {
  ATTACHMENT_TITLE,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  markUndone,
  messageUndo,
} from "@/server/services/ai-conversations";
import { attachToConversation } from "@/server/services/attachment-intake";
import { attachmentDetail, suggestionsFor } from "@/lib/attachment-summary";
import type { AssistantBlock, AssistantMessage, ConversationSummary, ProposalRow } from "@/lib/assistant-blocks";

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

export async function sendTurnAction(input: {
  conversationId: string | null;
  text: string;
  route: string;
  attachmentIds?: string[];
}): Promise<SendTurnResult> {
  const user = await requireTeacher();
  // Antes que nada: un bucle de preguntas no debe llegar ni a mirar la clave
  if (rateLimitHit(user.id)) return { error: "Espera un momento: demasiadas preguntas seguidas." };
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
    attachmentIds: validAttachmentIds(input.attachmentIds),
    // Conversar puede ir con un modelo más barato; extraer archivos y exámenes
    // no: esas herramientas leen `getAiSettings().model` por su cuenta
    ai: { key, model: chatModelOf() },
  });
  if ("error" in result) return result;
  refreshAfterChange();
  return { ok: true, ...result };
}

export type AttachResult =
  | { ok: true; conversationId: string; attachmentId: string; name: string; detail: string; suggestions: string[] }
  | { error: string };

/**
 * Adjunta un archivo ya subido a la conversación: lo lee, lo resume y devuelve
 * lo que se pinta en el chat. Sin conversación (o si no es suya), abre una.
 */
export async function attachAction(input: { conversationId: string | null; fileId: string }): Promise<AttachResult> {
  const user = await requireTeacher();
  // Subir y convertir con LibreOffice cuesta disco y CPU: mismo freno que los
  // turnos, pero con su propio cubo (adjuntar no debe gastar las preguntas)
  if (rateLimitHit(`attach:${user.id}`)) return { error: "Espera un momento: demasiados archivos seguidos." };
  const fileId = String(input.fileId ?? "");
  if (!fileId) return { error: "No recibimos el archivo." };

  let conversationId = typeof input.conversationId === "string" ? input.conversationId : null;
  if (conversationId && !getConversation(user.id, conversationId)) conversationId = null;
  const isNew = !conversationId;
  if (!conversationId) conversationId = createConversation(user.id, ATTACHMENT_TITLE).id;

  try {
    const { id, summary } = await attachToConversation({ conversationId, fileId, userId: user.id });
    return {
      ok: true,
      conversationId,
      attachmentId: id,
      name: summary.fileName,
      detail: attachmentDetail(summary),
      suggestions: suggestionsFor(summary),
    };
  } catch (err) {
    // Un archivo ilegible no deja una conversación vacía en la lista
    if (isNew) deleteConversation(user.id, conversationId);
    return { error: err instanceof Error ? err.message : "No pudimos leer ese archivo." };
  }
}

/** Contexto de herramienta para acciones fuera del bucle (aplicar, deshacer). */
async function toolContext(user: Awaited<ReturnType<typeof requireTeacher>>, conversationId: string, messageId: string): Promise<ToolCtx> {
  const scope = await getViewScope(user);
  return { user, scope, actingOwnerId: actingOwnerId(scope, user), route: "/", conversationId, messageId, attachments: [] };
}

/**
 * Aplica una propuesta. Devuelve además los bloques que deje la acción (la
 * descarga de las contraseñas del alta, los enlaces): el servidor ya los
 * guardó en el mensaje y el panel los pinta sin recargar.
 */
export async function applyProposalAction(input: { proposalId: string; rows: ProposalRow[]; confirm?: string }): Promise<{ ok: true; text: string; blocks: AssistantBlock[] } | { error: string }> {
  const user = await requireTeacher();
  const rows = validRows(input.rows);
  const confirm = String(input.confirm ?? "").slice(0, 40);
  // La conversación y el mensaje los pone `applyProposal`: son los de la propuesta
  const result = await applyProposal(String(input.proposalId ?? ""), rows, await toolContext(user, "", ""), confirm);
  if ("error" in result) return result;
  refreshAfterChange();
  return { ok: true, text: result.text, blocks: result.blocks ?? [] };
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
  // Antes de leerla: una propuesta vencida debe verse caducada, no pendiente con su botón
  expireProposals();
  return getConversation(user.id, String(input.id ?? ""));
}

/** Lo que hace falta atender ahora mismo: se pide al abrir el panel en blanco. */
export async function suggestionsAction(): Promise<Suggestion[]> {
  const user = await requireTeacher();
  return platformSuggestions(user, await getViewScope(user));
}

export async function deleteConversationAction(input: { id: string }): Promise<{ ok: boolean }> {
  const user = await requireTeacher();
  return { ok: deleteConversation(user.id, String(input.id ?? "")) };
}

const MAX_ROWS = 5000;
const MAX_ATTACHMENTS = 5;

/** Ids de adjuntos que manda el cliente: cadenas no vacías, hasta 5. */
function validAttachmentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, MAX_ATTACHMENTS);
}

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
