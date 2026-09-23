import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { aiProposals } from "@/server/db/schema";
import type { ProposalRow, ProposalStatus } from "@/lib/assistant-blocks";
import type { ProposalDraft, ToolCtx } from "./tool-types";

/**
 * Guardar y leer propuestas. Separado de proposals.ts para que las
 * herramientas puedan crear propuestas sin importar el registro (ciclo).
 */

export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export type Proposal = {
  id: string;
  conversationId: string;
  messageId: string;
  tool: string;
  rows: ProposalRow[];
  payload: Record<string, unknown>;
  status: ProposalStatus;
  draft: Omit<ProposalDraft, "rows" | "payload">;
};

/** En la columna `payload` van los datos de la herramienta y, aparte, cómo se presenta. */
type StoredPayload = { data: Record<string, unknown>; draft: Proposal["draft"] };

export function createProposal(tool: string, ctx: ToolCtx, messageId: string, draft: ProposalDraft): string {
  const id = nanoid();
  const stored: StoredPayload = {
    data: draft.payload,
    draft: {
      title: draft.title,
      applyLabel: draft.applyLabel,
      columns: draft.columns,
      confirmWord: draft.confirmWord,
      recheckOnApply: draft.recheckOnApply,
    },
  };
  db.insert(aiProposals)
    .values({
      id,
      conversationId: ctx.conversationId,
      messageId,
      tool,
      rows: draft.rows,
      payload: stored,
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
    })
    .run();
  return id;
}

export function getProposal(id: string): Proposal | null {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  if (!row) return null;
  const stored = row.payload as StoredPayload;
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    tool: row.tool,
    rows: row.rows as ProposalRow[],
    payload: stored.data,
    status: row.status,
    draft: stored.draft,
  };
}
