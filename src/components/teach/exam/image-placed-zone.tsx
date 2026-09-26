"use client";

import { memo } from "react";
import { createPortal } from "react-dom";
import { DragOverlay, useDraggable, type Modifier } from "@dnd-kit/core";
import { X } from "lucide-react";
import { BoardSpot } from "@/components/exam/image-board";
import { centerOnPointer, useIsClient } from "@/components/exam/image-dnd";
import { ItemFace } from "@/components/exam/image-pieces";
import { elementView } from "@/lib/image-layout";
import type { ImageElement, Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";
import { TransformBox, type TransformActions } from "./image-transform-box";

/**
 * Un lugar en la foto del editor: el elemento real (el maestro sí ve la
 * solución) con su número «Lugar N». Se arrastra para moverlo (con los demás
 * seleccionados, si lo está). Seleccionado lleva un anillo; si es el único,
 * además la «×» para quitarlo. Con `transform`, en lugar del anillo lleva la
 * caja para estirar y girar (y el número y la «×» se corren para no tapar sus
 * tiradores). El teclado lo atiende el editor (flechas, Supr, Espacio, + − [ ]),
 * por el `data-zone` del botón. Memorizado (con acciones fijas): al mover un
 * grupo solo se vuelven a pintar los lugares que se mueven.
 */
export const PlacedZone = memo(function PlacedZone({
  index,
  at,
  element,
  label,
  number,
  boardWidth,
  aspect,
  dense,
  selected,
  removable,
  lifted,
  transform,
  readout,
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
  /** Alto / ancho de la foto: con otra foto, la bolita y la lectura se reacomodan. */
  aspect: number;
  dense: boolean;
  selected: boolean;
  /** Es el único seleccionado: muestra la «×». */
  removable: boolean;
  /** Va en la mano: se ve el fantasma, y el botón sigue montado (invisible) para no cortar el arrastre. */
  lifted: boolean;
  /** Lleva la caja para estirar y girar. */
  transform?: TransformActions;
  /** El valor mientras se estira o gira. */
  readout?: string | null;
  onClick: (index: number, e: React.MouseEvent) => void;
  onRemove: (index: number, e: React.MouseEvent) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: `zone:${index}` });
  const view = elementView(element);
  // El botón mide la ficha sin girar (los avisos lo miden así); el anillo, el
  // número y la «×» van en una capa que gira con ella, con su contenido derecho
  const turn = view.rotation ? { transform: `rotate(${view.rotation}deg)` } : undefined;
  const upright = view.rotation ? { transform: `rotate(${-view.rotation}deg)` } : undefined;
  return (
    <BoardSpot x={at.x} y={at.y} className={cn(transform ? "z-[25]" : selected ? "z-20" : "z-10", lifted && "invisible")}>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        data-zone={index}
        onClick={(e) => onClick(index, e)}
        aria-label={label}
        aria-pressed={selected}
        title="Clic: seleccionarlo (Mayús+clic: sumarlo a la selección). Arrástralo para moverlo, o fuera de la foto para quitarlo"
        className={cn(
          "group/zone relative block cursor-grab touch-none outline-none active:cursor-grabbing",
          // Encima de la caja: donde el área de toque de un tirador cae sobre la ficha, gana la ficha (moverla)
          transform && "z-[1]"
        )}
      >
        <ItemFace item={view} boardWidth={boardWidth} dense={dense} />
        <span aria-hidden className="pointer-events-none absolute inset-0" style={turn}>
          <span
            className={cn(
              "absolute inset-0 group-focus-visible/zone:ring-4 group-focus-visible/zone:ring-primary/40",
              element.kind === "icon" ? "rounded-[12px]" : "rounded-full",
              selected && !transform && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          />
          <span
            className={cn(
              "absolute flex size-[18px] items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground ring-2 ring-white",
              // Con la caja, a la derecha del tirador de esa esquina
              transform ? "-right-[33px] -top-[15px]" : "-right-2 -top-2"
            )}
            style={upright}
          >
            {number}
          </span>
        </span>
      </button>
      {transform && (
        <TransformBox
          rotation={view.rotation}
          readout={readout ?? null}
          actions={transform}
          layout={`${at.x},${at.y},${view.size},${boardWidth},${aspect}`}
        />
      )}
      {removable && (
        <span className="pointer-events-none absolute inset-0" style={turn}>
          <button
            type="button"
            aria-label={`Quitar el lugar ${number}`}
            title="Quitar este lugar"
            onClick={(e) => onRemove(index, e)}
            style={upright}
            className={cn(
              "pointer-events-auto absolute flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow ring-2 ring-white outline-none hover:bg-destructive/90 focus-visible:ring-4 focus-visible:ring-destructive/40",
              // Con la caja, a la izquierda del tirador de esa esquina
              transform ? "-left-[35px] -top-[16px]" : "-left-2.5 -top-2.5"
            )}
          >
            <X className="size-3" strokeWidth={3} aria-hidden />
          </button>
        </span>
      )}
    </BoardSpot>
  );
});

/**
 * Ctrl+rueda sobre el fantasma (a medio arrastre desde la lista, con el
 * puntero fuera del lienzo): ni el zoom del navegador ni desplazar la página.
 * Nativo y no pasivo (el `onWheel` de React es pasivo), solo sobre él.
 */
function blockCtrlWheel(node: HTMLDivElement | null) {
  if (!node) return;
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  node.addEventListener("wheel", onWheel, { passive: false });
  return () => node.removeEventListener("wheel", onWheel);
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
  modifier,
}: {
  element: ImageElement | undefined;
  /** Viene de la lista: va centrado en el puntero. */
  fromList: boolean;
  /** Un lugar fuera de la foto: al soltarlo se quita, y se ve tenue. */
  removing: boolean;
  boardWidth: number;
  dense: boolean;
  /** Para un lugar que se mueve: lo lleva adonde lo pega el imán. */
  modifier?: Modifier;
}) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(
    <DragOverlay dropAnimation={null} modifiers={fromList ? [centerOnPointer] : modifier ? [modifier] : undefined}>
      {element ? (
        // El fantasma toma el tamaño de lo que se arrastra: la ficha va centrada en él
        <div ref={blockCtrlWheel} data-canvas-ghost="" className="flex size-full items-center justify-center">
          <span
            className={cn(
              "block cursor-grabbing drop-shadow-[0_12px_12px_rgb(15_23_42/0.35)] transition-opacity",
              // Un lugar que se mueve va derecho: así se ve justo sobre las guías
              removing ? "opacity-40" : fromList ? "-rotate-4 opacity-95" : "opacity-95"
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
