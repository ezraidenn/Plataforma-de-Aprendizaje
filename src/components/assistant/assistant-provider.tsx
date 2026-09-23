"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AssistantMessage } from "@/lib/assistant-blocks";
import { MAX_AI_FILE_BYTES, aiFileKind, heicMessage, nombreDePegado } from "@/lib/ai-import-files";
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

/**
 * Imágenes del portapapeles (Ctrl+V) listas para adjuntar. Una captura llega
 * como fichero sin nombre útil: se le pone uno con la fecha. Si el portapapeles
 * trae HTML (copiar de Word o de Excel también deja una imagen), manda el
 * texto y aquí no se toma nada: es el mismo criterio del editor de contenido.
 * Lista vacía = el pegado sigue su curso normal.
 */
export function pastedImages(data: DataTransfer | null, now = new Date()): File[] {
  const items = Array.from(data?.items ?? []);
  if (items.some((i) => i.type === "text/html")) return [];
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    // Un archivo copiado del explorador sí trae su nombre: ese se respeta
    const named = aiFileKind(file.name) === "image" && !/^image\.\w+$/i.test(file.name);
    files.push(named ? file : new File([file], nombreDePegado(file.type, now), { type: file.type }));
  }
  return files;
}

function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sin sessionStorage */
  }
}

const fail = (text: string) => toast.error(text, { position: "top-center" });

/**
 * Enter mientras sube el archivo: no se envía, solo se avisa. Con el mismo id
 * el aviso se reemplaza en vez de apilarse aunque se insista con Enter.
 */
export function avisarSubiendo() {
  toast.info("Espera a que termine de subir el archivo", { id: "asistente-subiendo", position: "top-center", duration: 2500 });
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
    attachments: [],
    suggestions: [],
    uploading: false,
    dragging: false,
  });
  const [dropEnabled, setDropEnabled] = useState(false);
  const lastText = useRef<string | null>(null);
  // La conversación y los adjuntos viven en refs y el estado es solo su copia
  // para pintar: quien cambia uno cambia el otro en el mismo paso. Antes un
  // `useEffect` copiaba el estado a la ref un render tarde, y con un turno y
  // una subida a la vez el mensaje y el archivo podían acabar en
  // conversaciones distintas.
  const conversationRef = useRef<string | null>(null);
  // Un turno a la vez: el estado tarda un render en reflejar `busy`, la ref no
  const busyRef = useRef(false);
  // `attachFiles` sube uno tras otro y necesita la cuenta al día antes de que
  // React vuelva a pintar
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  // Subidas en curso. La interfaz no deja enviar mientras haya alguna, y
  // `send` además las espera por si acaso (reintentar, un clic que se cuele)
  const pendingRef = useRef(new Set<Promise<unknown>>());
  // El turno que está en camino: la subida lo espera antes de adjuntar, porque
  // si es el primero de una conversación nueva es él quien la crea
  const turnRef = useRef<Promise<unknown> | null>(null);

  // Estable: el campo la llama en un efecto al montarse
  const enableFileDrop = useCallback(() => setDropEnabled(true), []);

  /**
   * Apunta una subida: `send` la espera y `uploading` (lo que bloquea el botón
   * de enviar) sigue encendido mientras quede alguna. Es un conjunto, no un
   * sí/no: dos subidas seguidas se pisaban y la primera apagaba el aviso.
   */
  const track = useCallback(<T,>(work: Promise<T>): Promise<T> => {
    pendingRef.current.add(work);
    setState((s) => (s.uploading ? s : { ...s, uploading: true }));
    const forget = () => {
      pendingRef.current.delete(work);
      const on = pendingRef.current.size > 0;
      setState((s) => (s.uploading === on ? s : { ...s, uploading: on }));
    };
    work.then(forget, forget);
    return work;
  }, []);

  /** Cambia la conversación actual (ref y sesión); el estado lo pone quien llama en su mismo paso. */
  const setConversation = useCallback((id: string | null) => {
    conversationRef.current = id;
    remember(id);
  }, []);

  const setAttachments = useCallback((next: PendingAttachment[], suggestions?: string[]) => {
    attachmentsRef.current = next;
    setState((s) => ({ ...s, attachments: next, suggestions: suggestions ?? s.suggestions }));
  }, []);

  const loadConversation = useCallback(
    async (id: string, open: boolean, restoring = false) => {
      const conv = await getConversationAction({ id });
      // Al recargar, si mientras tanto ya se empezó algo (un archivo, un
      // mensaje), eso manda: traer la de antes lo dejaría fuera
      if (restoring && (conversationRef.current || busyRef.current || pendingRef.current.size || attachmentsRef.current.length)) return;
      if (!conv) {
        remember(null);
        return;
      }
      // La abierta desde el historial pasa a ser la actual también tras recargar
      setConversation(conv.id);
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
    [setConversation]
  );

  // La misma conversación sigue tras recargar (con el panel cerrado)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) void loadConversation(saved, false, true);
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
      // El mensaje se ve ya en el hilo, en cola: mientras se sube el archivo el
      // panel dice «Leyendo el archivo…» en vez de «Pensando…»
      setState((s) => ({ ...s, open: true, view: "thread", busy: true, draft: "", pendingText: text }));
      // Primero se espera a lo que se esté subiendo: mandar el turno sin el
      // archivo deja a la IA respondiendo sobre algo que nunca vio
      const pending = [...pendingRef.current];
      if (pending.length > 0) {
        const settled = await Promise.allSettled(pending);
        // Mejor el mensaje sin el archivo que perder el mensaje; el porqué del
        // fallo ya salió en su propio aviso
        if (settled.some((r) => r.status === "rejected")) fail("No se pudo adjuntar el archivo; se envía el mensaje sin él.");
      }
      // Los adjuntos y la conversación se recogen DESPUÉS de esperar, y de las
      // refs: son la conversación en la que quedó el archivo
      const attachmentIds = attachmentsRef.current.map((a) => a.id);
      // Mientras el turno va y vuelve, una subida nueva espera a que se sepa la
      // conversación (si es la primera, la crea este turno)
      let finish = () => {};
      turnRef.current = new Promise<void>((resolve) => (finish = resolve));
      try {
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
        setConversation(result.conversationId);
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
      } finally {
        turnRef.current = null;
        finish();
      }
    },
    [pathname, router, setConversation]
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
      // La subida se apunta en `pendingRef`: mientras dure no se puede enviar,
      // y si algo envía de todos modos, el turno espera a que esté adjunto
      const work = (async () => {
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
        // Con un turno en camino se espera a que vuelva: si es el primero de
        // una conversación nueva, la crea él, y adjuntar ahora abriría otra
        // distinta (el mensaje quedaba en una y el archivo en la otra)
        while (turnRef.current) await turnRef.current;
        const result = await attachAction({ conversationId: conversationRef.current, fileId: data.fileId });
        if ("error" in result) {
          fail(result.error);
          return;
        }
        setConversation(result.conversationId);
        attachmentsRef.current = [...attachmentsRef.current, { id: result.attachmentId, name: result.name, detail: result.detail }];
        const attachments = attachmentsRef.current;
        setState((s) => ({ ...s, conversationId: result.conversationId, attachments, suggestions: result.suggestions }));
      })();
      try {
        await track(work);
      } catch {
        fail("No se pudo subir el archivo. Revisa tu conexión con el servidor.");
      }
    },
    [setConversation, track]
  );

  /** De uno en uno: el servidor lee cada archivo entero para resumirlo. */
  const attachFiles = useCallback(
    async (files: FileList | File[]) => {
      // La tanda entera se apunta, no solo cada archivo: entre uno y el
      // siguiente hay un hueco en el que un Enter se colaría sin adjunto
      await track(
        (async () => {
          for (const file of Array.from(files)) await attach(file);
        })()
      );
    },
    [attach, track]
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
        setConversation(null);
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
    [state, send, loadConversation, attach, attachFiles, setAttachments, setConversation, enableFileDrop]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useAssistant fuera de AssistantProvider");
  return api;
}
