/**
 * Lo que el asistente muestra en el hilo. Cada mensaje es una lista de
 * bloques; el servidor los arma y el cliente los pinta. Compartido: sin
 * importaciones de servidor.
 */

export type LinkIcon = "user" | "course" | "grading" | "download" | "page";

export type ProposalColumn = { key: string; label: string; editable?: boolean };

export type ProposalRow = {
  id: string;
  cells: Record<string, string>;
  /** Aviso en ámbar; si `blocked`, la fila no se aplica aunque se mande */
  warning?: string;
  blocked?: boolean;
};

export type ProposalStatus = "pending" | "applied" | "cancelled" | "expired";

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "options"; text: string; options: string[] }
  | { type: "tiles"; tiles: { label: string; value: string }[] }
  | { type: "table"; columns: string[]; rows: string[][]; more?: number }
  | { type: "links"; links: { label: string; href: string; icon: LinkIcon }[] }
  | { type: "result"; text: string; undoable?: boolean; undone?: boolean }
  | {
      type: "proposal";
      proposalId: string;
      title: string;
      applyLabel: string;
      columns: ProposalColumn[];
      rows: ProposalRow[];
      status: ProposalStatus;
      resultText?: string;
    }
  | { type: "navigate"; href: string }
  | { type: "error"; text: string; retryable?: boolean };

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: AssistantBlock[];
  createdAt: number;
};

export type ConversationSummary = { id: string; title: string; updatedAt: number };

/** Filas que se pueden aplicar: sin bloqueo y no quitadas por el usuario. */
export function applicableRows(rows: ProposalRow[]): ProposalRow[] {
  return rows.filter((r) => !r.blocked);
}

/** Título de conversación: primeras palabras del primer mensaje. */
export function conversationTitle(firstText: string): string {
  const clean = firstText.replace(/\s+/g, " ").trim();
  return clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}…`;
}
