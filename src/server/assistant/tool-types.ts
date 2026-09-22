import "server-only";
import type { SessionUser } from "@/server/auth/sessions";
import type { ViewScope } from "@/server/auth/view-scope";
import type { AssistantBlock, ProposalColumn, ProposalRow } from "@/lib/assistant-blocks";
import type { StoredAttachment } from "@/server/services/attachment-intake";

/**
 * Una herramienta del asistente. La IA solo puede pedir estas; `run` llama a
 * los servicios existentes con los permisos del contexto. `forModel` es lo
 * único que ve la IA (texto corto); `blocks` es lo que ve el usuario.
 */

export type ToolRole = "admin" | "teacher";
export type ToolRisk = "read" | "instant" | "review" | "navigate";

export type ToolCtx = {
  user: SessionUser;
  scope: ViewScope;
  /** A nombre de quién se crea (admin viendo como maestro → ese maestro) */
  actingOwnerId: string;
  /** Ruta donde está el usuario */
  route: string;
  conversationId: string;
  /** Mensaje del asistente de este turno (ancla de propuestas) */
  messageId: string;
  /** Adjuntos del mensaje (sus resúmenes ya los vio la IA) */
  attachments: StoredAttachment[];
};

/** Cómo revertir una acción instantánea: la herramienta y los parámetros para su `undo`. */
export type UndoSpec = { tool: string; params: Record<string, unknown> };

export type ToolResult = {
  forModel: string;
  blocks?: AssistantBlock[];
  undo?: UndoSpec;
  navigate?: string;
  proposalId?: string;
};

/** Lo que una herramienta de revisión propone; se guarda en ai_proposals. */
export type ProposalDraft = {
  title: string;
  applyLabel: string;
  columns: ProposalColumn[];
  rows: ProposalRow[];
  /** Datos fijos que `apply` necesita (p. ej. el curso) */
  payload: Record<string, unknown>;
  /** Si está, hay que escribirla tal cual (sin distinguir mayúsculas ni espacios) para aplicar */
  confirmWord?: string;
};

export type ApplyResult = { text: string; blocks?: AssistantBlock[] };

export type JsonSchema = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required: string[];
};

export type AssistantTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  roles: ToolRole[];
  risk: ToolRisk;
  run(params: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> | ToolResult;
  /** Solo herramientas `review`: aplica las filas ya revisadas (revalida). `confirm` es lo que escribió el usuario cuando la propuesta pide `confirmWord`. */
  apply?(rows: ProposalRow[], payload: Record<string, unknown>, ctx: ToolCtx, confirm: string): Promise<ApplyResult> | ApplyResult;
  /** Solo herramientas `instant`: revierte lo hecho. El servidor llama a esto con `UndoSpec.params`, nunca a `run`. */
  undo?(params: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> | ToolResult;
};

/** Defensa extra ante la IA: fuera cualquier clave interna (`__…`) que no esté en el esquema. */
export function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([k]) => !k.startsWith("__")));
}

/** Esquema estricto: sin propiedades extra y todas requeridas (OpenAI lo exige). */
export function schema(properties: Record<string, unknown>): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

export const str = (description: string) => ({ type: "string", description });
export const strEnum = (description: string, values: string[]) => ({ type: "string", description, enum: values });
export const strList = (description: string) => ({ type: "array", description, items: { type: "string" } });

export function param(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v.trim() : "";
}

export function paramList(params: Record<string, unknown>, key: string): string[] {
  const v = params[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}
