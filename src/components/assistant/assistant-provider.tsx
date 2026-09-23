"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AssistantMessage } from "@/lib/assistant-blocks";
import { MAX_AI_FILE_BYTES, aiFileKind, heicMessage } from "@/lib/ai-import-files";
import { attachAction, getConversationAction, sendTurnAction } from "@/server/actions/assistant";

/**
 * Estado del asistente para toda la app: panel abierto, conversación actual,
 * mensajes, adjuntos pendientes y si está ocupado. `send` guarda el turno y, si
 * la respuesta trae una navegación, cambia la página de fondo sin cerrar el panel.
 */

type View = "thread" | "history";

export type PendingAttachment = { id: string; name: string; detail: string };

/** Adjuntos por mensaje: más de tres no caben en el desplegable ni aportan. */
export const MAX_ATTACHMENTS = 3;

/** Se manda esto cuando solo hay archivo y ninguna pregunta escrita. */
export const DEFAULT_ATTACHMENT_TEXT = "¿Qué contiene este archivo?";

const HEIC_RE = /\.hei[cf]$/i;

type AssistantState = {
  open: boolean;
  view: View;
  conversationId: string | null;
  title: string;
  messages: AssistantMessage[];
  busy: boolean;
  draft: string;
  pendingText: string | null;
  /** Archivos ya leídos por el servidor que irán con el próximo mensaje */
  attachments: PendingAttachment[];
  /** Qué se puede pedir con esos archivos (chips) */
  suggestions: string[];
  uploading: boolean;
  /** Se está arrastrando un archivo sobre la ventana */
  dragging: boolean;
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
  attach(file: File): Promise<void>;
  attachFiles(files: FileList | File[]): Promise<void>;
  removeAttachment(id: string): void;
  /** Lo llama el campo al montarse: sin él, soltar archivos no hace nada */
  enableFileDrop(): void;
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

const fail = (text: string) => toast.error(text, { position: "top-center" });

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
    attachments: [],
    suggestions: [],
    uploading: false,
    dragging: false,
  });
  const [dropEnabled, setDropEnabled] = useState(false);
  const lastText = useRef<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  // Un turno a la vez: el estado tarda un render en reflejar `busy`, la ref no
  const busyRef = useRef(false);
  // Lo mismo con los adjuntos: `attachFiles` sube uno tras otro y necesita la
  // cuenta al día antes de que React vuelva a pintar
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  useEffect(() => {
    conversationRef.current = state.conversationId;
  }, [state.conversationId]);
  useEffect(() => {
    attachmentsRef.current = state.attachments;
  }, [state.attachments]);

  // Estable: el campo la llama en un efecto al montarse
  const enableFileDrop = useCallback(() => setDropEnabled(true), []);

  const setAttachments = useCallback((next: PendingAttachment[], suggestions?: string[]) => {
    attachmentsRef.current = next;
    setState((s) => ({ ...s, attachments: next, suggestions: suggestions ?? s.suggestions }));
  }, []);

  const loadConversation = useCallback(
    async (id: string, open: boolean) => {
      const conv = await getConversationAction({ id });
      if (!conv) {
        remember(null);
        return;
      }
      // La abierta desde el historial pasa a ser la actual también tras recargar
      remember(conv.id);
      attachmentsRef.current = [];
      setState((s) => ({
        ...s,
        conversationId: conv.id,
        title: conv.title,
        messages: conv.messages,
        view: "thread",
        open: open || s.open,
        // Los pendientes eran de otra conversación: no se arrastran
        attachments: [],
        suggestions: [],
      }));
    },
    []
  );

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
      if (!text || busyRef.current) return;
      busyRef.current = true;
      lastText.current = text;
      const attachmentIds = attachmentsRef.current.map((a) => a.id);
      setState((s) => ({ ...s, open: true, view: "thread", busy: true, draft: "", pendingText: text }));
      let result: Awaited<ReturnType<typeof sendTurnAction>>;
      try {
        result = await sendTurnAction({ conversationId: conversationRef.current, text, route: pathname, attachmentIds });
      } catch {
        result = { error: "No se pudo hablar con el servidor. Inténtalo de nuevo." };
      } finally {
        busyRef.current = false;
      }
      if ("error" in result) {
        // Los adjuntos se quedan puestos para poder reintentar sin volver a subirlos
        setState((s) => ({ ...s, busy: false, pendingText: null, draft: text }));
        toast.error(result.error, { position: "top-center" });
        if (result.noKey) router.push("/admin/settings");
        return;
      }
      remember(result.conversationId);
      // Solo se quitan los que fueron en este mensaje: si se adjuntó algo
      // mientras el asistente pensaba, sigue pendiente para el siguiente
      attachmentsRef.current = attachmentsRef.current.filter((a) => !attachmentIds.includes(a.id));
      const attachments = attachmentsRef.current;
      setState((s) => ({
        ...s,
        busy: false,
        pendingText: null,
        conversationId: result.conversationId,
        title: s.title || text,
        messages: [...s.messages, result.userMessage, result.message],
        attachments,
        suggestions: attachments.length ? s.suggestions : [],
      }));
      const nav = result.message.blocks.find((b) => b.type === "navigate");
      if (nav && nav.type === "navigate") router.push(nav.href);
    },
    [pathname, router]
  );

  /** Sube un archivo y lo adjunta a la conversación (el servidor lo resume). */
  const attach = useCallback(
    async (file: File) => {
      if (!aiFileKind(file.name)) {
        fail(
          HEIC_RE.test(file.name)
            ? heicMessage(file.name)
            : `«${file.name}»: no podemos leer ese tipo de archivo. Usa Excel, CSV, Word, PDF, texto o imágenes.`
        );
        return;
      }
      if (file.size > MAX_AI_FILE_BYTES) {
        fail(`«${file.name}» pasa de 10 MB.`);
        return;
      }
      if (attachmentsRef.current.length >= MAX_ATTACHMENTS) {
        fail(`Máximo ${MAX_ATTACHMENTS} archivos por mensaje`);
        return;
      }
      setState((s) => ({ ...s, uploading: true }));
      try {
        const res = await fetch("/api/uploads", {
          method: "POST",
          headers: {
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Kind": "assistant_attachment",
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        const data = (await res.json().catch(() => ({}))) as { fileId?: string; error?: string };
        if (!res.ok || !data.fileId) {
          fail(data.error ?? "No se pudo subir el archivo. Revisa tu conexión con el servidor.");
          return;
        }
        const result = await attachAction({ conversationId: conversationRef.current, fileId: data.fileId });
        if ("error" in result) {
          fail(result.error);
          return;
        }
        conversationRef.current = result.conversationId;
        remember(result.conversationId);
        attachmentsRef.current = [...attachmentsRef.current, { id: result.attachmentId, name: result.name, detail: result.detail }];
        const attachments = attachmentsRef.current;
        setState((s) => ({ ...s, conversationId: result.conversationId, attachments, suggestions: result.suggestions }));
      } catch {
        fail("No se pudo subir el archivo. Revisa tu conexión con el servidor.");
      } finally {
        setState((s) => ({ ...s, uploading: false }));
      }
    },
    []
  );

  /** De uno en uno: el servidor lee cada archivo entero para resumirlo. */
  const attachFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) await attach(file);
    },
    [attach]
  );

  // Arrastrar un archivo a cualquier parte de la ventana lo adjunta. Solo si
  // hay campo del asistente montado: los alumnos no lo tienen.
  useEffect(() => {
    if (!dropEnabled) return;
    // `dragleave` también salta al pasar de un hijo a otro: se cuentan entradas
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const stop = () => {
      depth = 0;
      setState((s) => (s.dragging ? { ...s, dragging: false } : s));
    };
    const onEnter = (e: DragEvent) => {
      if (hasFiles(e)) depth += 1;
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Las zonas de soltar propias (importar alumnos, CSV, entregas…) ya
      // llamaron a preventDefault: el archivo es suyo, no del asistente
      if (e.defaultPrevented) {
        setState((s) => (s.dragging ? { ...s, dragging: false } : s));
        return;
      }
      // Sin esto el navegador abre el archivo en lugar de soltarlo aquí
      e.preventDefault();
      setState((s) => (s.dragging ? s : { ...s, dragging: true }));
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth -= 1;
      if (depth <= 0 || e.relatedTarget === null) stop();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      stop();
      if (e.defaultPrevented) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files?.length) void attachFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", onDrop);
    };
  }, [attachFiles, dropEnabled]);

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
        attachmentsRef.current = [];
        setState((s) => ({
          ...s,
          conversationId: null,
          title: "",
          messages: [],
          view: "thread",
          open: true,
          attachments: [],
          suggestions: [],
        }));
      },
      openConversation: (id) => loadConversation(id, true),
      replaceMessage: (message) =>
        setState((s) => ({ ...s, messages: s.messages.map((m) => (m.id === message.id ? message : m)) })),
      attach,
      attachFiles,
      // Solo se quita de la lista: el archivo sigue en la conversación, pero no
      // se manda con este mensaje
      removeAttachment: (id) => {
        const next = attachmentsRef.current.filter((a) => a.id !== id);
        setAttachments(next, next.length ? undefined : []);
      },
      enableFileDrop,
    }),
    [state, send, loadConversation, attach, attachFiles, setAttachments, enableFileDrop]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useAssistant fuera de AssistantProvider");
  return api;
}
