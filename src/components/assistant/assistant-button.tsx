"use client";

import { Sparkles } from "lucide-react";
import { useAssistant } from "./assistant-provider";

/** Botón del asistente en la barra, solo celular: abre el panel a pantalla completa. */
export function AssistantButton() {
  const { setOpen } = useAssistant();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Abrir el asistente de IA"
      className="flex size-[34px] items-center justify-center rounded-lg bg-white text-indigo-600 shadow-[0_4px_12px_-2px_rgb(30_27_75/0.5)] transition-colors hover:bg-indigo-50 md:hidden"
    >
      <Sparkles className="size-[18px]" aria-hidden />
    </button>
  );
}
