import "server-only";
import { and, desc, eq, like, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { aiConversations, aiMessages } from "@/server/db/schema";
import type { AssistantBlock, AssistantMessage, ConversationSummary } from "@/lib/assistant-blocks";
import { conversationTitle } from "@/lib/assistant-blocks";
import type { UndoSpec } from "@/server/assistant/tool-types";

/** Conversaciones del asistente: privadas por usuario. */

export function createConversation(userId: string, firstText: string): { id: string; title: string } {
  const id = nanoid();
  const title = conversationTitle(firstText) || "Nueva conversación";
  db.insert(aiConversations).values({ id, userId, title }).run();
  return { id, title };
}

export function listConversations(userId: string, q?: string): ConversationSummary[] {
  const term = q?.trim();
  return db
    .select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt })
    .from(aiConversations)
    .where(and(eq(aiConversations.userId, userId), term ? like(aiConversations.title, `%${term}%`) : undefined))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(50)
    .all()
    .map((c) => ({ ...c, updatedAt: c.updatedAt.getTime() }));
}

function ownedConversation(userId: string, id: string) {
  return db
    .select({ id: aiConversations.id, title: aiConversations.title })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)))
    .get();
}

export function getConversation(
  userId: string,
  id: string
): { id: string; title: string; messages: AssistantMessage[] } | null {
  const conv = ownedConversation(userId, id);
  if (!conv) return null;
  const rows = db
    .select({ id: aiMessages.id, role: aiMessages.role, content: aiMessages.content, createdAt: aiMessages.createdAt })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, id))
    .orderBy(aiMessages.createdAt, aiMessages.id)
    .all();
  return {
    ...conv,
    messages: rows.map((r) => ({ id: r.id, role: r.role, blocks: r.content as AssistantBlock[], createdAt: r.createdAt.getTime() })),
  };
}

export function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  blocks: AssistantBlock[],
  modelText: string,
  undo?: UndoSpec
): AssistantMessage {
  const id = nanoid();
  let at = new Date();
  db.transaction(() => {
    // Dos mensajes en el mismo milisegundo se leerían en orden de id (nanoid no
    // es ordenable): se fuerza un createdAt estrictamente creciente por conversación
    const last = db
      .select({ at: max(aiMessages.createdAt) })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .get()?.at;
    if (last && last.getTime() >= at.getTime()) at = new Date(last.getTime() + 1);
    db.insert(aiMessages).values({ id, conversationId, role, content: blocks, modelText, undo: undo ?? null, createdAt: at }).run();
    db.update(aiConversations).set({ updatedAt: at }).where(eq(aiConversations.id, conversationId)).run();
  });
  return { id, role, blocks, createdAt: at.getTime() };
}

/** Historial corto para la IA: últimos `limit` mensajes como texto. */
export function recentModelText(conversationId: string, limit: number): { role: "user" | "assistant"; text: string }[] {
  return db
    .select({ role: aiMessages.role, text: aiMessages.modelText })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(limit)
    .all()
    .reverse()
    .filter((m) => m.text.trim() !== "");
}

/** Mensaje con lo necesario para deshacer. */
export function messageUndo(userId: string, conversationId: string, messageId: string) {
  if (!ownedConversation(userId, conversationId)) return null;
  const row = db
    .select({ id: aiMessages.id, undo: aiMessages.undo, undoneAt: aiMessages.undoneAt, createdAt: aiMessages.createdAt, content: aiMessages.content })
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), eq(aiMessages.conversationId, conversationId)))
    .get();
  if (!row || !row.undo) return null;
  return { id: row.id, undo: row.undo as UndoSpec, undoneAt: row.undoneAt, createdAt: row.createdAt, blocks: row.content as AssistantBlock[] };
}

export function markUndone(messageId: string, blocks: AssistantBlock[]) {
  db.update(aiMessages).set({ undoneAt: new Date(), content: blocks }).where(eq(aiMessages.id, messageId)).run();
}

/** Cambia el bloque de una propuesta dentro del mensaje que la muestra (congelar la tabla). */
export function patchProposalBlock(
  conversationId: string,
  proposalId: string,
  patch: Partial<Extract<AssistantBlock, { type: "proposal" }>>
) {
  // El LIKE solo acota candidatos; el filtro real es por proposalId en el bloque
  const rows = db
    .select({ id: aiMessages.id, content: aiMessages.content })
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conversationId), like(aiMessages.content, `%${proposalId}%`)))
    .all();
  for (const r of rows) {
    const blocks = (r.content as AssistantBlock[]).map((b) => (b.type === "proposal" && b.proposalId === proposalId ? { ...b, ...patch } : b));
    db.update(aiMessages).set({ content: blocks }).where(eq(aiMessages.id, r.id)).run();
  }
}

export function deleteConversation(userId: string, id: string): boolean {
  if (!ownedConversation(userId, id)) return false;
  db.delete(aiConversations).where(eq(aiConversations.id, id)).run();
  return true;
}
