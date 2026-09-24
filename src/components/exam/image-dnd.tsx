"use client";

import { useState, useSyncExternalStore } from "react";
import type { Announcements, Modifier } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";

/**
 * Piezas de arrastrar compartidas por las preguntas sobre imagen: el control
 * del alumno y el editor del maestro.
 */

/** Los avisos van por la región propia, en español; los de dnd-kit, callados. */
export const QUIET_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

const noSubscribe = () => () => {};

/** true ya en el navegador (para llevar el fantasma del arrastre al cuerpo del documento). */
export function useIsClient(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

/**
 * Para el `onEscapeKeyDown` de un diálogo que muestra preguntas sobre imagen
 * (la vista previa): con una ficha elegida, Esc solo la suelta (lo atiende la
 * pregunta, marcada con `data-choosing`) y el diálogo sigue abierto.
 */
export function keepOpenWhileChoosing(e: KeyboardEvent) {
  if (e.target instanceof Element && e.target.closest("[data-choosing]")) e.preventDefault();
}

/** Lo arrastrado va centrado en el puntero (el fantasma mide lo que el nodo tomado). */
export const centerOnPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  const at = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  if (!at || !draggingNodeRect) return transform;
  return {
    ...transform,
    x: transform.x + at.x - draggingNodeRect.left - draggingNodeRect.width / 2,
    y: transform.y + at.y - draggingNodeRect.top - draggingNodeRect.height / 2,
  };
};

/**
 * Soltar un archivo del equipo sobre una zona. Llama a preventDefault aunque
 * no esté habilitada (p. ej. a media subida): así el navegador no lo abre y el
 * asistente, que escucha en toda la ventana, no se lo queda.
 */
export function useFileDrop(onFile: (file: File) => void, enabled = true) {
  const [over, setOver] = useState(false);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return {
    over: over && enabled,
    dropProps: {
      onDragOver(e: React.DragEvent<HTMLElement>) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave(e: React.DragEvent<HTMLElement>) {
        // Pasar de un hijo a otro también dispara dragleave
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop(e: React.DragEvent<HTMLElement>) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file && enabled) onFile(file);
      },
    },
  };
}

/** Velo sobre una zona mientras se arrastra un archivo encima. */
export function DropVeil({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary bg-primary/10 p-3 text-center text-sm font-semibold text-primary backdrop-blur-[1px]">
      {text}
    </div>
  );
}
