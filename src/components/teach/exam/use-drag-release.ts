"use client";

import { useEffect, type RefObject } from "react";
import type { ImageElement } from "@/lib/image-questions";
import { isTypingTarget } from "./use-editor-history";

/**
 * Cuándo el editor de «arrastrar» suelta lo elegido (para colocar o en el
 * panel «Seleccionado») y lo seleccionado:
 *
 * - Esc, esté donde esté el foco, salvo en un campo (el del panel, con Esc,
 *   solo deshace lo escrito) o si ya lo atendió un diálogo. Si lo enfocado
 *   desaparece (el deslizante del panel), el foco va a la foto y Ctrl+Z sigue
 *   a mano.
 * - Tras deshacer: lo elegido puede ya no existir.
 * - Al recortar la foto: se suelta todo, también lo seleccionado; mientras se
 *   recorta, nada más se toca.
 */
export function useDragRelease({
  chosen,
  setChosen,
  panelId,
  setPanelId,
  hasSelection,
  clearSelection,
  byId,
  cropping,
  rootRef,
  boardNode,
  announce,
}: {
  chosen: string | null;
  setChosen: (id: string | null) => void;
  panelId: string | null;
  setPanelId: (id: string | null) => void;
  hasSelection: boolean;
  clearSelection: () => void;
  byId: Map<string, ImageElement>;
  cropping: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  boardNode: HTMLElement | null;
  announce: (text: string) => void;
}) {
  useEffect(() => {
    if (!chosen && !hasSelection && !panelId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      const root = rootRef.current;
      const hadFocus = !!root?.contains(document.activeElement);
      setChosen(null);
      setPanelId(null);
      clearSelection();
      announce("Elección cancelada");
      requestAnimationFrame(() => {
        if (hadFocus && !root?.contains(document.activeElement)) boardNode?.focus({ preventScroll: true });
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chosen, hasSelection, panelId, setChosen, setPanelId, clearSelection, announce, boardNode, rootRef]);

  useEffect(() => {
    if (chosen && (cropping || !byId.has(chosen))) setChosen(null);
    if (panelId && (cropping || !byId.has(panelId))) setPanelId(null);
    if (cropping) clearSelection();
  }, [byId, chosen, panelId, cropping, setChosen, setPanelId, clearSelection]);
}
