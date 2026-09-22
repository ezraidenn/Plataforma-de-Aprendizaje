"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AssistantMessage } from "@/lib/assistant-blocks";
import { getConversationAction, sendTurnAction } from "@/server/actions/assistant";

/**
 * Estado del asistente para toda la app: panel abierto, conversación actual,
 * mensajes y si está ocupado. `send` guarda el turno y, si la respuesta trae
 * una navegación, cambia la página de fondo sin cerrar el panel.
 */

type View = "thread" | "history";

type AssistantState = {
  open: boolean;
  view: View;
  conversationId: string | null;
  title: string;
  messages: AssistantMessage[];
  busy: boolean;
  draft: string;
  pendingText: string | null;
};

type AssistantApi = AssistantState & {
  setOpen(open: boolean): void;
  setView(view: View): void;
  setDraft(text: string): void;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  newConversation(): void;
  openConversation(id: string): Promise<void>;
  replaceMessage(message: AssistantMessage): void;
};

const Ctx = createContext<AssistantApi | null>(null);
const STORAGE_KEY = "assistant:conversation";

function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sin sessionStorage */
  }
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AssistantState>({
    open: false,
    view: "thread",
    conversationId: null,
    title: "",
    messages: [],
    busy: false,
    draft: "",
    pendingText: null,
  });
  const lastText = useRef<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  useEffect(() => {
    conversationRef.current = state.conversationId;
  }, [state.conversationId]);

  const loadConversation = useCallback(async (id: string, open: boolean) => {
    const conv = await getConversationAction({ id });
    if (!conv) {
      remember(null);
      return;
    }
    // La abierta desde el historial pasa a ser la actual también tras recargar
    remember(conv.id);
    setState((s) => ({
      ...s,
      conversationId: conv.id,
      title: conv.title,
      messages: conv.messages,
      view: "thread",
      open: open || s.open,
    }));
  }, []);

  // La misma conversación sigue tras recargar (con el panel cerrado)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) void loadConversation(saved, false);
    } catch {
      /* sin sessionStorage */
    }
  }, [loadConversation]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      lastText.current = text;
      setState((s) => ({ ...s, open: true, view: "thread", busy: true, draft: "", pendingText: text }));
      let result: Awaited<ReturnType<typeof sendTurnAction>>;
      try {
        result = await sendTurnAction({ conversationId: conversationRef.current, text, route: pathname });
      } catch {
        result = { error: "No se pudo hablar con el servidor. Inténtalo de nuevo." };
      }
      if ("error" in result) {
        setState((s) => ({ ...s, busy: false, pendingText: null, draft: text }));
        toast.error(result.error);
        if (result.noKey) router.push("/admin/settings");
        return;
      }
      remember(result.conversationId);
      setState((s) => ({
        ...s,
        busy: false,
        pendingText: null,
        conversationId: result.conversationId,
        title: s.title || text,
        messages: [...s.messages, result.userMessage, result.message],
      }));
      const nav = result.message.blocks.find((b) => b.type === "navigate");
      if (nav && nav.type === "navigate") router.push(nav.href);
    },
    [pathname, router]
  );

  const api = useMemo<AssistantApi>(
    () => ({
      ...state,
      setOpen: (open) => setState((s) => ({ ...s, open })),
      setView: (view) => setState((s) => ({ ...s, view })),
      setDraft: (draft) => setState((s) => ({ ...s, draft })),
      send,
      retry: async () => {
        if (lastText.current) await send(lastText.current);
      },
      newConversation: () => {
        remember(null);
        setState((s) => ({ ...s, conversationId: null, title: "", messages: [], view: "thread", open: true }));
      },
      openConversation: (id) => loadConversation(id, true),
      replaceMessage: (message) =>
        setState((s) => ({ ...s, messages: s.messages.map((m) => (m.id === message.id ? message : m)) })),
    }),
    [state, send, loadConversation]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useAssistant fuera de AssistantProvider");
  return api;
}
