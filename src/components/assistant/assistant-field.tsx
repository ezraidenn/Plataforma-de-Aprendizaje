"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUp, Loader2, Paperclip, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { placeholderFor } from "@/lib/assistant-placeholder";
import { AI_ACCEPT } from "@/lib/ai-import-files";
import { AttachmentChip } from "./attachment-chip";
import { DEFAULT_ATTACHMENT_TEXT, MAX_ATTACHMENTS, useAssistant } from "./assistant-provider";

/**
 * Campo del asistente en el centro de la barra (solo escritorio): blanco,
 * redondeado, con la chispa índigo. Enter envía y abre el panel. Acepta
 * archivos por el clip o arrastrándolos a cualquier parte de la ventana; los
 * pendientes se ven en un desplegable bajo el campo, con sus sugerencias.
 */
export function AssistantField() {
  const pathname = usePathname();
  const {
    draft,
    setDraft,
    send,
    busy,
    open,
    setOpen,
    attachments,
    suggestions,
    uploading,
    dragging,
    attachFiles,
    removeAttachment,
    enableFileDrop,
  } = useAssistant();
  const fileRef = useRef<HTMLInputElement>(null);
  const [closed, setClosed] = useState(false);
  // Al enviar hay adjunto pero no hace falta escribir nada
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !busy && !uploading;
  const full = attachments.length >= MAX_ATTACHMENTS;
  const clipLabel = full ? `Máximo ${MAX_ATTACHMENTS} archivos por mensaje` : "Adjuntar archivo";
  const showPopover = attachments.length > 0 && !open && !closed && !dragging;

  // Este campo solo existe para quien puede usar el asistente: desde aquí se
  // enciende el soltar archivos en toda la ventana
  useEffect(() => {
    enableFileDrop();
  }, [enableFileDrop]);

  // Un archivo nuevo vuelve a mostrar el desplegable que se cerró con Esc
  useEffect(() => {
    if (attachments.length) setClosed(false);
  }, [attachments.length]);

  // Esc cierra el desplegable (el panel tiene su propio Esc)
  useEffect(() => {
    if (!showPopover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClosed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPopover]);

  return (
    <div className="relative hidden w-full max-w-[560px] md:block">
      <form
        role="search"
        aria-label="Asistente de IA"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) void send(draft.trim() || DEFAULT_ATTACHMENT_TEXT);
        }}
        className={cn(
          "flex h-[42px] w-full items-center gap-2 rounded-full pl-4 pr-1.5 text-slate-500 shadow-[0_1px_2px_rgb(15_23_42/0.12),0_8px_24px_-8px_rgb(30_27_75/0.45)] transition-shadow focus-within:ring-2 focus-within:ring-white/60",
          dragging ? "justify-center border-2 border-dashed border-indigo-400 bg-indigo-50 pl-2" : "bg-white"
        )}
      >
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
        {dragging ? (
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-indigo-900">
            <Upload className="size-4 shrink-0 text-indigo-600" aria-hidden />
            Suelta el archivo aquí
          </p>
        ) : (
          <>
            {uploading ? (
              <Loader2 className="size-[18px] shrink-0 animate-spin text-indigo-600" aria-hidden />
            ) : (
              // La chispa abre el panel en blanco: sin ella, en escritorio no
              // hay forma de ver las sugerencias sin escribir antes algo
              <button
                type="button"
                onClick={() => setOpen(true)}
                title="Abrir el asistente de IA"
                aria-label="Abrir el asistente de IA"
                className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-indigo-600 transition-colors hover:text-indigo-800"
              >
                <Sparkles className="size-[18px]" aria-hidden />
              </button>
            )}
            {uploading ? (
              <p className="min-w-0 flex-1 truncate text-[13.5px] text-slate-500" aria-live="polite">
                Leyendo el archivo…
              </p>
            ) : (
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={() => {
                  if (draft.trim()) setOpen(true);
                }}
                placeholder={placeholderFor(pathname)}
                aria-label="Escribe lo que quieres hacer"
                disabled={busy}
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
              />
            )}
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
          </>
        )}
      </form>

      {showPopover && (
        <div className="absolute left-1/2 top-[calc(100%+8px)] z-40 w-[600px] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-[0_24px_48px_-12px_rgb(15_23_42/0.25)]">
          <div className="flex flex-col gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip key={a.id} name={a.name} detail={a.detail} onRemove={() => removeAttachment(a.id)} />
            ))}
          </div>
          {suggestions.length > 0 && (
            <>
              <p className="mt-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                Sugerencias con este archivo
              </p>
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
            </>
          )}
          <p className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[11.5px] text-slate-500">
            <ShieldCheck className="size-3.5 shrink-0 text-green-600" aria-hidden />
            Nada se guarda sin que revises y confirmes
          </p>
        </div>
      )}
    </div>
  );
}
