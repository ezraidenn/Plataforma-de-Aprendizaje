"use client";

import { createContext, useContext, useTransition } from "react";
import { toast } from "sonner";
import { setViewContextAction } from "@/server/actions/view-context";
import { VIEW_CHANNEL, type ViewContextInfo } from "@/lib/view-context";

const ViewContextCtx = createContext<ViewContextInfo>({ kind: "own" });

/** Contexto con el que se armó la pantalla (maestros: siempre «own»). */
export function ViewContextProvider({
  value,
  children,
}: {
  value: ViewContextInfo;
  children: React.ReactNode;
}) {
  return <ViewContextCtx.Provider value={value}>{children}</ViewContextCtx.Provider>;
}

export function useViewContext(): ViewContextInfo {
  return useContext(ViewContextCtx);
}

// Un solo canal por pestaña: lo que publica no le llega a sí mismo
let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    try {
      channel = new BroadcastChannel(VIEW_CHANNEL);
    } catch {
      channel = null;
    }
  }
  return channel;
}

/**
 * Todas las pestañas siguen el contexto real de la cookie: al montar, esta
 * anuncia el suyo; si otra pestaña anuncia uno distinto (lo cambió, o una carga
 * completa lo reinició), `handler` lo recibe.
 */
export function onViewContextBroadcast(handler: (value: string) => void, announce: string): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (e: MessageEvent) => {
    if (typeof e.data === "string") handler(e.data);
  };
  ch.addEventListener("message", listener);
  ch.postMessage(announce);
  return () => ch.removeEventListener("message", listener);
}

/**
 * Cambia el contexto (solo admin) y avisa a las otras pestañas. No hace falta
 * `router.refresh()`: al cambiar una cookie en una acción de servidor, Next
 * devuelve la pantalla ya armada con el contexto nuevo.
 */
export function useSwitchViewContext() {
  const [pending, startTransition] = useTransition();
  function switchTo(value: string) {
    startTransition(async () => {
      try {
        const result = await setViewContextAction(value);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        getChannel()?.postMessage(value);
      } catch {
        toast.error("No se pudo cambiar la vista. Intenta de nuevo.");
      }
    });
  }
  return { switchTo, pending };
}
