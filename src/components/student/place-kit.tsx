"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconArt } from "@/components/exam/image-pieces";
import { QUIET_ANNOUNCEMENTS, useIsClient } from "@/components/exam/image-dnd";
import { cn } from "@/lib/utils";

/**
 * Piezas de «Clasificar en grupos» y del banco de «Completar el texto»: la
 * tarjeta (texto o ícono) que se arrastra o se toca, el banco donde espera, el
 * fantasma del arrastre y las reglas comunes. Las dos preguntas colocan igual:
 * - Arrastrar (ratón o dedo): cae en el destino bajo el puntero (o, si no hay,
 *   en el que más cubre); fuera de todo, lo que estaba puesto vuelve al banco.
 * - Tocar y tocar: tocar una tarjeta la elige; tocar un destino la pone.
 * - Teclado: tarjetas y destinos son botones; Enter hace lo mismo que tocar y
 *   Escape cancela.
 */

/** Una tarjeta o palabra tal como se dibuja. */
export type ChipFaceData = { kind: "text" | "icon"; text?: string; fileId?: string; ratio?: number };

/** Id del banco como destino del arrastre (las fichas del servidor nunca lo usan). */
export const BANK = "__banco__";

/** Lado mayor de un ícono en una tarjeta (px), como en la paleta del banco de imagen. */
const ICON_PX = 44;

/** Aspecto de una tarjeta, sin lo interactivo (también la usa la revisión). */
export function chipLook(kind: ChipFaceData["kind"]): string {
  return cn(
    "relative inline-flex max-w-full items-center justify-center gap-1.5 border bg-card text-card-foreground shadow-sm",
    kind === "icon"
      ? "min-h-9 min-w-9 rounded-xl p-1.5"
      : // Píldora en una línea; con texto largo, esquinas suaves (una píldora de varias líneas se
        // come el texto). Una palabra que no cabe se parte con guion (la página está en español)
        "min-h-9 rounded-[18px] px-3 py-1 text-left text-sm font-semibold leading-snug hyphens-auto [overflow-wrap:break-word]"
  );
}

/** Lo de adentro de una tarjeta: el texto o el dibujo a tamaño de paleta. */
export function ChipFace({ face }: { face: ChipFaceData }) {
  if (face.kind === "icon") {
    const r = face.ratio && face.ratio > 0 ? face.ratio : 1;
    const w = r <= 1 ? ICON_PX : Math.max(1, Math.round(ICON_PX / r));
    const h = r <= 1 ? Math.max(1, Math.round(ICON_PX * r)) : ICON_PX;
    return <IconArt fileId={face.fileId} w={w} h={h} />;
  }
  return <span className="min-w-0">{face.text}</span>;
}

/**
 * Foco del teclado: un contorno aparte del anillo de «elegida». Sin
 * `outline-none` ni `outline-hidden`: en Tailwind 4 apagan también este contorno
 * (el navegador ya no lo pone al hacer clic).
 */
export const FOCUS_OUTLINE = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Una tarjeta (en el banco o ya puesta): se arrastra o se toca. */
export function PlaceChip({
  token,
  face,
  label,
  selected,
  faded,
  count = 1,
  className,
  onClick,
  ...data
}: {
  token: string;
  face: ChipFaceData;
  label: string;
  /** Es la tarjeta elegida con un toque (o con Enter). */
  selected: boolean;
  /** Va en la mano (arrastre) o no quedan copias: se atenúa. */
  faded?: boolean;
  /** Palabras iguales en el banco: cuántas quedan. */
  count?: number;
  className?: string;
  onClick: (e: React.MouseEvent) => void;
  /** Marcas para encontrarla al devolver el foco (`data-bank-item`, `data-blank`, …). */
  [data: `data-${string}`]: string | undefined;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: token });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...data}
      data-token={token}
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        chipLook(face.kind),
        "cursor-grab touch-none select-none transition-[background-color,box-shadow,opacity] duration-150 hover:border-primary/50 active:cursor-grabbing motion-reduce:transition-none",
        FOCUS_OUTLINE,
        selected && "bg-primary/10 ring-2 ring-primary",
        faded && "opacity-35",
        className
      )}
    >
      <ChipFace face={face} />
      {count > 1 && (
        <span
          aria-hidden
          className="absolute -right-2 -top-2 rounded-full bg-primary px-1.5 text-[11px] font-bold leading-[18px] text-primary-foreground ring-2 ring-card"
        >
          ×{count}
        </span>
      )}
    </button>
  );
}

/** Cae donde está el puntero; si no está sobre nada, en el destino que más cubre la tarjeta. */
const pointerFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * El arrastre: sin sensor de teclado (con teclado se elige y se pone con
 * Enter, como al tocar) y con los avisos de dnd-kit callados (van por la
 * región propia, en español). `onDrop` recibe el destino o null (fuera de todo).
 */
export function PlaceDnd({
  ghost,
  onStart,
  onOver,
  onDrop,
  onCancel,
  children,
}: {
  /** Lo que va en la mano, para dibujar el fantasma. */
  ghost: ChipFaceData | null;
  onStart: (token: string) => void;
  onOver: (target: string | null) => void;
  onDrop: (token: string, target: string | null) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const isClient = useIsClient();
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerFirst}
      accessibility={{ announcements: QUIET_ANNOUNCEMENTS }}
      // Desplaza solo muy cerca del borde, como en «arrastrar a la imagen»
      autoScroll={{ threshold: { x: 0, y: 0.08 } }}
      onDragStart={(e) => onStart(String(e.active.id))}
      onDragOver={(e) => onOver(e.over ? String(e.over.id) : null)}
      onDragEnd={(e) => onDrop(String(e.active.id), e.over ? String(e.over.id) : null)}
      onDragCancel={onCancel}
    >
      {children}
      {isClient &&
        // Al cuerpo del documento: un ancestro con transform movería el fantasma
        createPortal(
          <DragOverlay dropAnimation={null}>
            {ghost ? (
              <div className="flex size-full cursor-grabbing items-center justify-center">
                <span className={cn(chipLook(ghost.kind), "-rotate-4 shadow-[0_12px_22px_-8px_rgb(15_23_42/0.45)] ring-2 ring-primary")}>
                  <ChipFace face={ghost} />
                </span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  );
}

/** El banco: destino para devolver lo puesto y, con algo puesto elegido, el botón «Devolver al banco». */
export function PlaceBank({
  title,
  empty,
  hot,
  canReturn,
  onReturn,
  children,
}: {
  title: string;
  /** Lo que dice cuando ya no queda nada en el banco. */
  empty: string | null;
  /** Lo arrastrado caería aquí. */
  hot: boolean;
  /** Lo elegido está puesto: se puede devolver. */
  canReturn: boolean;
  onReturn: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: BANK });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "space-y-2 rounded-xl border border-dashed bg-muted/60 p-2.5 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
        hot && "border-solid border-primary bg-primary/5 ring-4 ring-primary/15"
      )}
      onClick={(e) => {
        // Tocar el banco (fuera de las tarjetas) con una tarjeta puesta elegida la devuelve
        if (canReturn && !(e.target as Element).closest("button")) onReturn(e);
      }}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/80">{title}</p>
        {canReturn && (
          <Button size="sm" variant="ghost" onClick={onReturn}>
            <Undo2 aria-hidden />
            Devolver al banco
          </Button>
        )}
      </div>
      {empty ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * Foco tras una acción con teclado: el botón nuevo aparece en el siguiente
 * render. `focusLater(a, b)` enfoca el primero de los selectores que exista.
 */
export function useFocusAfter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const pending = useRef<string[] | null>(null);
  useEffect(() => {
    const selectors = pending.current;
    if (!selectors) return;
    pending.current = null;
    for (const s of selectors) {
      const el = rootRef.current?.querySelector<HTMLElement>(s);
      if (el) {
        el.focus();
        return;
      }
    }
  });
  return {
    rootRef,
    focusLater: (...selectors: string[]) => {
      pending.current = selectors;
    },
  };
}

/** Selector de un atributo con su valor escapado. */
export const byAttr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;

/** Clic con el teclado (Enter o Espacio sobre un botón): el navegador lo manda sin detalle. */
export const viaKeyboard = (e: React.MouseEvent) => e.detail === 0;
