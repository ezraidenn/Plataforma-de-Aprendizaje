import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { aiConversations, aiProposals } from "@/server/db/schema";
import { applicableRows, type ProposalRow } from "@/lib/assistant-blocks";
import { audit } from "@/server/services/audit";
import { patchProposalBlock } from "@/server/services/ai-conversations";
import { toolByName } from "./registry";
import { getProposal, type Proposal } from "./proposal-store";
import type { ApplyResult, ToolCtx } from "./tool-types";

/**
 * Propuestas: lo que una herramienta de revisión quiere hacer. El usuario
 * edita filas y confirma; al aplicar se revalida y solo se aplican las filas
 * sin bloqueo. La IA no participa.
 */

export { createProposal, getProposal, PROPOSAL_TTL_MS, type Proposal } from "./proposal-store";

function ownsProposal(userId: string, proposal: Proposal): boolean {
  return !!db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, proposal.conversationId), eq(aiConversations.userId, userId)))
    .get();
}

/**
 * Aplica las filas que manda el cliente. Solo cuenta lo que sigue siendo
 * válido: las filas se cruzan con las originales y una bloqueada en el
 * servidor no se aplica aunque el cliente la mande «desbloqueada».
 */
export async function applyProposal(
  id: string,
  rows: ProposalRow[],
  ctx: ToolCtx,
  confirm = ""
): Promise<ApplyResult | { error: string }> {
  expireProposals();
  const proposal = getProposal(id);
  if (!proposal || !ownsProposal(ctx.user.id, proposal)) return { error: "No encontramos esa revisión." };
  if (proposal.status === "expired") return { error: "Esta revisión caducó; vuelve a pedirla." };
  if (proposal.status !== "pending") return { error: "Esta revisión ya se aplicó o se canceló." };
  const tool = toolByName(proposal.tool);
  if (!tool?.apply) return { error: "Esta acción ya no está disponible." };
  const { confirmWord } = proposal.draft;
  if (confirmWord && confirm.trim().toLowerCase() !== confirmWord.toLowerCase()) {
    return { error: `Escribe ${confirmWord} para confirmar.` };
  }

  // Del cliente solo se toman las celdas editables (recortadas); el resto viene de la propuesta original
  const original = new Map(proposal.rows.map((r) => [r.id, r]));
  const editableKeys = proposal.draft.columns.filter((c) => c.editable !== false).map((c) => c.key);
  const seen = new Set<string>();
  const safe: ProposalRow[] = [];
  for (const r of rows) {
    const o = original.get(r.id);
    if (!o || seen.has(r.id)) continue;
    seen.add(r.id);
    const cells = { ...o.cells };
    for (const key of editableKeys) {
      const v = r.cells?.[key];
      if (typeof v === "string") cells[key] = v.slice(0, 200);
    }
    safe.push({ id: o.id, cells, blocked: o.blocked, warning: o.warning });
  }

  // Se reclama antes de aplicar: dos clics a la vez no la aplican dos veces
  const claimed = db
    .update(aiProposals)
    .set({ status: "applied" })
    .where(and(eq(aiProposals.id, id), eq(aiProposals.status, "pending")))
    .run().changes;
  if (claimed !== 1) return { error: "Esta revisión ya se aplicó o se canceló." };
  // Con `recheckOnApply` van todas las filas: las bloqueadas lo estaban por sus
  // datos y el usuario pudo corregirlas en la tabla, así que la herramienta las
  // vuelve a revisar. Sin él, una fila bloqueada no se aplica ni mandándola.
  const toApply = proposal.draft.recheckOnApply ? safe : applicableRows(safe);
  let result: ApplyResult;
  try {
    result = await tool.apply(toApply, proposal.payload, ctx, confirm);
  } catch (err) {
    // Si la herramienta falla, la propuesta vuelve a estar disponible
    db.update(aiProposals).set({ status: "pending" }).where(eq(aiProposals.id, id)).run();
    throw err;
  }

  db.update(aiProposals).set({ result: { text: result.text, rows: safe.length } }).where(eq(aiProposals.id, id)).run();
  patchProposalBlock(proposal.conversationId, id, { status: "applied", rows: safe, resultText: result.text });
  audit(ctx.user.id, `assistant_${proposal.tool}`, "ai_proposal", id, { via: "assistant", conversationId: proposal.conversationId, rows: safe.length });
  return result;
}

export function cancelProposal(id: string, userId: string): boolean {
  const proposal = getProposal(id);
  if (!proposal || !ownsProposal(userId, proposal) || proposal.status !== "pending") return false;
  db.update(aiProposals).set({ status: "cancelled" }).where(eq(aiProposals.id, id)).run();
  patchProposalBlock(proposal.conversationId, id, { status: "cancelled" });
  return true;
}

/** Marca como caducadas las pendientes vencidas. Barato: se llama antes de aplicar. */
export function expireProposals(): number {
  const now = new Date();
  const stale = db
    .select({ id: aiProposals.id, conversationId: aiProposals.conversationId })
    .from(aiProposals)
    .where(and(eq(aiProposals.status, "pending"), lt(aiProposals.expiresAt, now)))
    .all();
  for (const p of stale) {
    db.update(aiProposals).set({ status: "expired" }).where(eq(aiProposals.id, p.id)).run();
    patchProposalBlock(p.conversationId, p.id, { status: "expired" });
  }
  return stale.length;
}
