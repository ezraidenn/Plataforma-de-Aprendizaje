"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent, Modifier } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { relToRect } from "@/components/exam/image-board";
import { useStableHandler } from "@/components/exam/image-dnd";
import type { Guide } from "@/lib/image-layout";
import { freeSpot, round4, type ImageDragConfig, type ImageElement, type ImageZone, type Point } from "@/lib/image-questions";
import type { useDragSelection } from "./use-drag-selection";

/**
 * El arrastre (dnd-kit) del editor de «arrastrar a la imagen». Un elemento de
 * la lista soltado en la foto crea un lugar ahí. Un lugar solo se mueve (si
 * cae encima de otro, se corre lo justo) o, soltado fuera de la foto, se
 * quita. Un lugar seleccionado con otros lleva al grupo: eso lo resuelve la
 * selección. Se sigue el puntero real (en captura, antes que dnd-kit), y un
 * lugar tomado de una orilla se mueve con su centro, sin saltar al puntero.
 * Un lugar solo sobre la foto se pega con el imán (`snap`): su fantasma se
 * dibuja ya pegado (`ghostModifier`) y cae donde se ve.
 */
export function useEditorDrag({
  boardNode,
  zones,
  aspect,
  byId,
  setConfig,
  selection,
  snap,
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
  /** Imán de un lugar solo: dónde queda su centro (`point`, sin tocar el estado), sus guías (`hold`) y el final del gesto. */
  snap: {
    snapPoint: (i: number, p: Point) => { p: Point; guides: Guide[] };
    hold: (i: number, p: Point | null) => void;
    end: () => void;
  };
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
  /** Un lugar solo en la mano (no un grupo ni un elemento de la lista) y su centro en pantalla al tomarlo. */
  const single = useRef<{ index: number; center: Point } | null>(null);
  const snapPoint = useStableHandler(snap.snapPoint);

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

  /** Un lugar solo, soltado con su centro en `p` (ya con imán): si cae encima de otro, se corre lo justo. */
  function moveZone(i: number, p: Point) {
    const q = { x: round4(p.x), y: round4(p.y) };
    const at = freeSpot(q, zones.filter((_, j) => j !== i), aspect) ?? q;
    setConfig((c) => ({ ...c, zones: c.zones.map((z, j) => (j === i ? { ...z, x: at.x, y: at.y } : z)) }));
  }

  /**
   * El fantasma de un lugar solo se dibuja donde lo pega el imán. Se calcula
   * con el desplazamiento que da dnd-kit (no con el estado), así no va un
   * cuadro atrás del puntero.
   */
  const ghostModifier = useCallback<Modifier>(
    ({ transform }) => {
      const held = single.current;
      if (!held || !boardNode) return transform;
      const rect = boardNode.getBoundingClientRect();
      const p = relToRect(held.center.x + transform.x, held.center.y + transform.y, rect);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return transform;
      const s = snapPoint(held.index, p);
      return { ...transform, x: transform.x + (s.p.x - p.x) * rect.width, y: transform.y + (s.p.y - p.y) * rect.height };
    },
    [boardNode, snapPoint]
  );

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
    single.current = null;
    // Un lugar seleccionado con otros se lleva al grupo; si no, pasa a ser lo seleccionado
    if (id.startsWith("zone:")) {
      const i = Number(id.slice(5));
      if (!selection.startDrag(i)) single.current = { index: i, center: { x: at.x + grab.current.x, y: at.y + grab.current.y } };
    } else selection.clear();
  }

  function onDragMove(e: DragMoveEvent) {
    const rect = boardNode?.getBoundingClientRect();
    if (rect && selection.dragGroup(e.delta, rect)) return;
    const p = dropPoint();
    setOutside(p === null);
    if (single.current) snap.hold(single.current.index, p);
  }

  /**
   * Un lugar solo se oculta mientras va en la mano, y el navegador le quita el
   * foco: al soltarlo, el foco vuelve a él (o a la foto, si se quitó). Así
   * Ctrl+Z y las flechas siguen a mano justo después de moverlo.
   */
  function refocus(i: number | null) {
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now && now !== document.body) return;
      const zone = i === null ? null : boardNode?.querySelector<HTMLElement>(`[data-zone="${i}"]`);
      (zone ?? boardNode)?.focus({ preventScroll: true });
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const p = dropPoint();
    setActive(null);
    setOutside(false);
    single.current = null;
    const grouped = selection.dropGroup(e.delta, boardNode?.getBoundingClientRect());
    snap.end();
    if (grouped) return;
    if (id.startsWith("zone:")) {
      const i = Number(id.slice(5));
      if (p) moveZone(i, snapPoint(i, p).p);
      else selection.remove([i], false);
      refocus(p ? i : null);
    } else if (p) {
      onPlace(id.slice(3), p);
    }
  }

  function onDragCancel() {
    const held = single.current;
    setActive(null);
    setOutside(false);
    single.current = null;
    selection.cancelDrag();
    snap.end();
    if (held) refocus(held.index);
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
    ghostModifier,
    handlers: { onDragStart, onDragMove, onDragEnd, onDragCancel },
  };
}
