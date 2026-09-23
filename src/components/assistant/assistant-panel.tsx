"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, History, Loader2, Paperclip, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/assistant-blocks";
import { AI_ACCEPT } from "@/lib/ai-import-files";
import { deleteConversationAction, listConversationsAction, suggestionsAction } from "@/server/actions/assistant";
import { AssistantMessageView, UserBubble } from "./assistant-message";
import { AttachmentChip } from "./attachment-chip";
import { DEFAULT_ATTACHMENT_TEXT, MAX_ATTACHMENTS, useAssistant } from "./assistant-provider";

const WELCOME =
  "Dime qué hacer con tus cursos y alumnos: buscar a alguien, ver cómo va, matricular, abrir una pantalla. Lo sencillo se hace al momento y se puede deshacer; lo que afecta a varios lo revisas antes en una tabla.";

const DATE_FMT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

/** Sin importar el tipo del servidor: el módulo es «server-only». */
type PlatformSuggestion = Awaited<ReturnType<typeof suggestionsAction>>[number];

/**
 * Panel lateral del asistente, no modal: 440 px a la derecha en escritorio y
 * pantalla completa en celular. Se puede seguir navegando con él abierto.
 */
export function AssistantPanel() {
  const { open, setOpen, view, setView, newConversation } = useAssistant();

  // Esc cierra mientras esté abierto
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const history = view === "history";

  return (
    <aside
      role="complementary"
      aria-label="Asistente de IA"
      className="fixed inset-0 z-40 flex flex-col bg-white shadow-[-16px_0_40px_-20px_rgb(15_23_42/0.35)] md:bottom-0 md:top-14 md:left-auto md:right-0 md:w-[440px] md:border-l md:border-slate-200"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
        <Sparkles className="size-[18px] shrink-0 text-indigo-600" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate font-heading text-[15px] font-bold text-slate-900">
          {history ? "Historial" : "Asistente"}
        </h2>
        <HeaderButton
          label={history ? "Volver" : "Historial"}
          onClick={() => setView(history ? "thread" : "history")}
        >
          {history ? <ArrowLeft className="size-4" aria-hidden /> : <History className="size-4" aria-hidden />}
        </HeaderButton>
        <HeaderButton label="Nueva conversación" onClick={newConversation}>
          <Plus className="size-4" aria-hidden />
        </HeaderButton>
        <HeaderButton label="Cerrar" onClick={() => setOpen(false)}>
          <X className="size-4" aria-hidden />
        </HeaderButton>
      </header>
      {history ? <HistoryList /> : <Thread />}
    </aside>
  );
}

function HeaderButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function Thread() {
  const {
    messages,
    pendingText,
    busy,
    conversationId,
    draft,
    setDraft,
    send,
    attachments,
    suggestions,
    uploading,
    attachFiles,
    removeAttachment,
  } = useAssistant();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Lo que hace falta atender: se pide UNA vez por apertura del panel en blanco
  const [platform, setPlatform] = useState<PlatformSuggestion[]>([]);
  const askedRef = useRef(false);
  // Con un archivo adjunto se puede enviar sin escribir nada: en ese caso va una
  // pregunta corta por defecto, que es lo que se quiere casi siempre
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !busy && !uploading;
  const full = attachments.length >= MAX_ATTACHMENTS;
  const clipLabel = full ? `Máximo ${MAX_ATTACHMENTS} archivos por mensaje` : "Adjuntar archivo";

  // Al final cuando llega algo nuevo
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingText, busy]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Solo en una conversación nueva y vacía; si falla, no se pinta nada
  useEffect(() => {
    if (askedRef.current || conversationId || messages.length > 0) return;
    askedRef.current = true;
    void (async () => {
      try {
        setPlatform(await suggestionsAction());
      } catch {
        /* sin sugerencias */
      }
    })();
  }, [conversationId, messages.length]);

  const submit = () => {
    if (canSend) void send(draft.trim() || DEFAULT_ATTACHMENT_TEXT);
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !pendingText && (
          <>
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-[13px] leading-relaxed text-slate-600">{WELCOME}</p>
            {platform.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {platform.map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    onClick={() => void send(s.text)}
                    disabled={busy}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 disabled:opacity-50"
                  >
                    {/* Sin recortar: en celular la pregunta no cabe en una línea
                        y cortada («…este m…») deja de entenderse */}
                    <span className="min-w-0 flex-1 text-slate-800">{s.text}</span>
                    <span className="shrink-0 text-slate-500">{s.detail}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {messages.map((m) => (
          <AssistantMessageView key={m.id} message={m} conversationId={conversationId} />
        ))}
        {pendingText && <UserBubble text={pendingText} />}
        {busy && (
          <div className="flex items-center gap-2 text-[12.5px] text-slate-500" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-indigo-600" aria-hidden />
            Pensando…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="shrink-0 border-t border-slate-200 p-3"
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip key={a.id} name={a.name} detail={a.detail} onRemove={() => removeAttachment(a.id)} />
            ))}
          </div>
        )}
        {/* Las mismas sugerencias del desplegable del campo: en celular no hay
            campo, y al adjuntar desde aquí el desplegable no se abre */}
        {attachments.length > 0 && suggestions.length > 0 && (
          <div className="mb-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">Sugerencias</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={busy || uploading}
                  className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-[11.5px] font-semibold text-indigo-900 transition-colors hover:bg-indigo-50 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {uploading && (
          <p className="mb-2 flex items-center gap-2 text-[12.5px] text-slate-500" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-indigo-600" aria-hidden />
            Leyendo el archivo…
          </p>
        )}
        <div className="flex items-end gap-1.5 rounded-2xl border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
          <input
            ref={fileRef}
            type="file"
            hidden
            aria-hidden
            tabIndex={-1}
            accept={AI_ACCEPT}
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) void attachFiles(files);
              // Sin esto no se puede volver a elegir el mismo archivo
              e.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Escribe aquí…"
            aria-label="Mensaje"
            disabled={busy}
            className="field-sizing-content max-h-24 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-5 text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || full}
            title={clipLabel}
            aria-label={clipLabel}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            <Paperclip className="size-4" aria-hidden />
          </button>
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Enviar"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
              canSend ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400"
            )}
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        </div>
      </form>
    </>
  );
}

function HistoryList() {
  const { conversationId, openConversation, newConversation } = useAssistant();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const list = await listConversationsAction({ q: q.trim() || undefined });
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) {
          setItems([]);
          toast.error("No se pudo cargar el historial.");
        }
      }
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const remove = async (c: ConversationSummary) => {
    if (!window.confirm("¿Borrar esta conversación?")) return;
    setItems((prev) => (prev ? prev.filter((x) => x.id !== c.id) : prev));
    try {
      await deleteConversationAction({ id: c.id });
    } catch {
      toast.error("No se pudo borrar la conversación.");
    }
    if (c.id === conversationId) newConversation();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 p-3">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
          <Search className="size-4 shrink-0 text-slate-400" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar en el historial"
            aria-label="Buscar conversaciones"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {items === null ? (
          <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-slate-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Cargando…
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">
            {q ? "No hay conversaciones con ese texto." : "Todavía no hay conversaciones."}
          </p>
        ) : (
          <ul>
            {items.map((c) => {
              const current = c.id === conversationId;
              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => void openConversation(c.id)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 py-2.5 pl-4 pr-11 text-left transition-colors hover:bg-slate-50",
                      current && "bg-indigo-50 hover:bg-indigo-50"
                    )}
                  >
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", current ? "font-semibold text-indigo-950" : "text-slate-800")}>
                      {c.title || "Sin título"}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500">{DATE_FMT.format(new Date(c.updatedAt))}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(c)}
                    aria-label={`Borrar conversación: ${c.title || "Sin título"}`}
                    title="Borrar"
                    className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
