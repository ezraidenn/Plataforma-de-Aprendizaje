"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { relToRect } from "@/components/exam/image-board";
import { freeSpot, round4, type ImageDragConfig, type ImageElement, type ImageZone, type Point } from "@/lib/image-questions";
import type { useDragSelection } from "./use-drag-selection";

/**
 * El arrastre (dnd-kit) del editor de «arrastrar a la imagen». Un elemento de
 * la lista soltado en la foto crea un lugar ahí. Un lugar solo se mueve (si
 * cae encima de otro, se corre lo justo) o, soltado fuera de la foto, se
 * quita. Un lugar seleccionado con otros lleva al grupo: eso lo resuelve la
 * selección. Se sigue el puntero real (en captura, antes que dnd-kit), y un
 * lugar tomado de una orilla se mueve con su centro, sin saltar al puntero.
 */
export function useEditorDrag({
  boardNode,
  zones,
  aspect,
  byId,
  setConfig,
  selection,
  onStart,
  onPlace,
}: {
  boardNode: HTMLElement | null;
  zones: ImageZone[];
  aspect: number;
  byId: ReadonlyMap<string, ImageElement>;
  setConfig: (fn: (c: ImageDragConfig) => ImageDragConfig) => void;
  selection: Pick<
    ReturnType<typeof useDragSelection>,
    "startDrag" | "dragGroup" | "dropGroup" | "cancelDrag" | "remove" | "clear" | "groupDragging"
  >;
  /** Empieza un arrastre: lo elegido para colocar se suelta. */
  onStart: () => void;
  /** Un elemento de la lista soltado en `p`. */
  onPlace: (elementId: string, p: Point) => void;
}) {
  /** Lo que va en la mano: `el:<id>` o `zone:<índice>`. */
  const [active, setActive] = useState<string | null>(null);
  /** El lugar arrastrado está fuera de la foto: al soltarlo se quita. */
  const [outside, setOutside] = useState(false);
  /** Puntero en pantalla durante el arrastre, y desfase entre él y el centro del lugar tomado. */
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const grab = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    if (!active) return;
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track, true);
    return () => window.removeEventListener("pointermove", track, true);
  }, [active]);

  /** Dónde quedaría lo que va en la mano; null si está fuera de la foto. */
  function dropPoint(): Point | null {
    if (!boardNode) return null;
    const p = relToRect(
      pointer.current.x + grab.current.x,
      pointer.current.y + grab.current.y,
      boardNode.getBoundingClientRect()
    );
    return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? { x: round4(p.x), y: round4(p.y) } : null;
  }

  /** Un lugar solo, soltado en `p`: si cae encima de otro, se corre lo justo. */
  function moveZone(i: number, p: Point) {
    const at = freeSpot(p, zones.filter((_, j) => j !== i), aspect) ?? p;
    setConfig((c) => ({ ...c, zones: c.zones.map((z, j) => (j === i ? { ...z, x: at.x, y: at.y } : z)) }));
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActive(id);
    setOutside(false);
    onStart();
    const at = getEventCoordinates(e.activatorEvent) ?? { x: 0, y: 0 };
    pointer.current = at;
    const r = e.active.rect.current.initial;
    grab.current =
      id.startsWith("zone:") && r
        ? { x: r.left + r.width / 2 - at.x, y: r.top + r.height / 2 - at.y }
        : { x: 0, y: 0 };
    // Un lugar seleccionado con otros se lleva al grupo; si no, pasa a ser lo seleccionado
    if (id.startsWith("zone:")) selection.startDrag(Number(id.slice(5)));
    else selection.clear();
  }

  function onDragMove(e: DragMoveEvent) {
    const rect = boardNode?.getBoundingClientRect();
    if (!(rect && selection.dragGroup(e.delta, rect))) setOutside(dropPoint() === null);
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const p = dropPoint();
    setActive(null);
    setOutside(false);
    if (selection.dropGroup(e.delta, boardNode?.getBoundingClientRect())) return;
    if (id.startsWith("zone:")) {
      const i = Number(id.slice(5));
      if (p) moveZone(i, p);
      else selection.remove([i], false);
    } else if (p) {
      onPlace(id.slice(3), p);
    }
  }

  function onDragCancel() {
    setActive(null);
    setOutside(false);
    selection.cancelDrag();
  }

  const grouped = selection.groupDragging;
  return {
    active,
    /** Hay un grupo en la mano (se mueve en su sitio, sin fantasma). */
    grouped,
    /** El elemento del fantasma (un elemento de la lista o un lugar solo). */
    ghost:
      active && !grouped
        ? byId.get(active.startsWith("el:") ? active.slice(3) : (zones[Number(active.slice(5))]?.elementId ?? ""))
        : undefined,
    /** Un lugar solo fuera de la foto: al soltarlo se quita. */
    removing: outside && !grouped && !!active?.startsWith("zone:"),
    handlers: { onDragStart, onDragMove, onDragEnd, onDragCancel },
  };
}
