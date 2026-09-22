"use client";

import { usePathname } from "next/navigation";
import { ArrowUp, Paperclip, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { placeholderFor } from "@/lib/assistant-placeholder";
import { useAssistant } from "./assistant-provider";

/**
 * Campo del asistente en el centro de la barra (solo escritorio): blanco,
 * redondeado, con la chispa índigo. Enter envía y abre el panel.
 */
export function AssistantField() {
  const pathname = usePathname();
  const { draft, setDraft, send, busy, setOpen } = useAssistant();
  const canSend = draft.trim().length > 0 && !busy;

  return (
    <form
      role="search"
      aria-label="Asistente de IA"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) void send(draft);
      }}
      className="hidden h-[42px] w-full max-w-[560px] items-center gap-2 rounded-full bg-white pl-4 pr-1.5 text-slate-500 shadow-[0_1px_2px_rgb(15_23_42/0.12),0_8px_24px_-8px_rgb(30_27_75/0.45)] transition-shadow focus-within:ring-2 focus-within:ring-white/60 md:flex"
    >
      <Sparkles className="size-[18px] shrink-0 text-indigo-600" aria-hidden />
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
      <button
        type="button"
        disabled
        title="Adjuntar archivo (próximamente)"
        aria-label="Adjuntar archivo (próximamente)"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 disabled:cursor-not-allowed"
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
    </form>
  );
}
