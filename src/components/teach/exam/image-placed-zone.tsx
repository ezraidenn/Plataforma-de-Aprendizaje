"use client";

import { createPortal } from "react-dom";
import { DragOverlay, useDraggable } from "@dnd-kit/core";
import { X } from "lucide-react";
import { BoardSpot } from "@/components/exam/image-board";
import { centerOnPointer, useIsClient } from "@/components/exam/image-dnd";
import { ItemFace } from "@/components/exam/image-pieces";
import { elementView } from "@/lib/image-layout";
import type { ImageElement, Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Un lugar en la foto del editor: el elemento real (el maestro sí ve la
 * solución) con su número «Lugar N». Se arrastra para moverlo (con los demás
 * seleccionados, si lo está). Seleccionado lleva un anillo; si es el único,
 * además la «×» para quitarlo. El teclado lo atiende el editor (flechas, Supr,
 * Espacio), por el `data-zone` del botón.
 */
export function PlacedZone({
  index,
  at,
  element,
  label,
  number,
  boardWidth,
  dense,
  selected,
  removable,
  lifted,
  onClick,
  onRemove,
}: {
  index: number;
  /** Dónde se dibuja (mientras se arrastra en grupo, ya desplazado). */
  at: Point;
  element: ImageElement;
  label: string;
  number: number;
  boardWidth: number;
  dense: boolean;
  selected: boolean;
  /** Es el único seleccionado: muestra la «×». */
  removable: boolean;
  /** Va en la mano: se ve el fantasma, y el botón sigue montado (invisible) para no cortar el arrastre. */
  lifted: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: `zone:${index}` });
  const view = elementView(element);
  // El botón mide la ficha sin girar (los avisos lo miden así); el anillo, el
  // número y la «×» van en una capa que gira con ella, con su contenido derecho
  const turn = view.rotation ? { transform: `rotate(${view.rotation}deg)` } : undefined;
  const upright = view.rotation ? { transform: `rotate(${-view.rotation}deg)` } : undefined;
  return (
    <BoardSpot x={at.x} y={at.y} className={cn(selected ? "z-20" : "z-10", lifted && "invisible")}>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        data-zone={index}
        onClick={onClick}
        aria-label={label}
        aria-pressed={selected}
        title="Clic: seleccionarlo (Mayús+clic: sumarlo a la selección). Arrástralo para moverlo, o fuera de la foto para quitarlo"
        className="group/zone relative block cursor-grab touch-none outline-none active:cursor-grabbing"
      >
        <ItemFace item={view} boardWidth={boardWidth} dense={dense} />
        <span aria-hidden className="pointer-events-none absolute inset-0" style={turn}>
          <span
            className={cn(
              "absolute inset-0 group-focus-visible/zone:ring-4 group-focus-visible/zone:ring-primary/40",
              element.kind === "icon" ? "rounded-[12px]" : "rounded-full",
              selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          />
          <span
            className="absolute -right-2 -top-2 flex size-[18px] items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground ring-2 ring-white"
            style={upright}
          >
            {number}
          </span>
        </span>
      </button>
      {removable && (
        <span className="pointer-events-none absolute inset-0" style={turn}>
          <button
            type="button"
            aria-label={`Quitar el lugar ${number}`}
            title="Quitar este lugar"
            onClick={onRemove}
            style={upright}
            className="pointer-events-auto absolute -left-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow ring-2 ring-white outline-none hover:bg-destructive/90 focus-visible:ring-4 focus-visible:ring-destructive/40"
          >
            <X className="size-3" strokeWidth={3} aria-hidden />
          </button>
        </span>
      )}
    </BoardSpot>
  );
}

/**
 * El fantasma de lo que va en la mano (un elemento de la lista o un lugar
 * solo; un grupo se mueve en su sitio, sin fantasma), a su tamaño real. Va al
 * cuerpo del documento: un ancestro con transform lo movería.
 */
export function DragGhost({
  element,
  fromList,
  removing,
  boardWidth,
  dense,
}: {
  element: ImageElement | undefined;
  /** Viene de la lista: va centrado en el puntero. */
  fromList: boolean;
  /** Un lugar fuera de la foto: al soltarlo se quita, y se ve tenue. */
  removing: boolean;
  boardWidth: number;
  dense: boolean;
}) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(
    <DragOverlay dropAnimation={null} modifiers={fromList ? [centerOnPointer] : undefined}>
      {element ? (
        // El fantasma toma el tamaño de lo que se arrastra: la ficha va centrada en él
        <div className="flex size-full items-center justify-center">
          <span
            className={cn(
              "block cursor-grabbing drop-shadow-[0_12px_12px_rgb(15_23_42/0.35)] transition-opacity",
              removing ? "opacity-40" : "-rotate-4 opacity-95"
            )}
          >
            <ItemFace item={elementView(element)} boardWidth={boardWidth} dense={dense} />
          </span>
        </div>
      ) : null}
    </DragOverlay>,
    document.body
  );
}
