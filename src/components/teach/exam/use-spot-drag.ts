"use client";

import { useEffect, useRef, useState } from "react";
import { relToRect } from "@/components/exam/image-board";
import { useStableHandler } from "@/components/exam/image-dnd";
import { snapSpot, type Guide } from "@/lib/image-layout";
import { clamp01, round4, type Point } from "@/lib/image-questions";
import { SNAP_PX } from "./use-canvas-tools";
import { visibleArea } from "./use-canvas-zoom";

/**
 * Mover los puntos de «señalar» arrastrándolos. El punto sigue al puntero (sin
 * saltar a él: guarda el desfase en px entre los dos) y sin salir de lo que se
 * ve de la foto (con zoom, ni de la vista ni bajo las reglas), con imán a la
 * línea de otro punto, a los bordes y el centro de la foto y, con cuadrícula,
 * a sus líneas (Alt lo apaga), y sus guías. Se mide con la foto tal como está
 * en cada momento: si el lienzo se desplaza a medio arrastre, el punto sigue
 * pegado al puntero. Al soltar hay un solo cambio: un paso del historial.
 * Mientras va en la mano no cambia nada guardado, así los números y el orden
 * de los puntos no saltan a medio arrastre. Un clic sin mover no es un
 * arrastre: lo atiende el botón (quita el punto). Esc a medio arrastre lo deja
 * donde estaba.
 */

/** Lo que hay que mover el puntero (px) para que sea un arrastre y no un clic; con el dedo, más. */
const DRAG_START_PX = 4;
const DRAG_START_TOUCH_PX = 9;
const NONE: Guide[] = [];

type PointerLike = { clientX: number; clientY: number; altKey: boolean };
type Held = {
  index: number;
  pointer: number;
  start: Point;
  /** Dónde se pulsó y cuánto hay que moverse para que sea un arrastre. */
  x: number;
  y: number;
  threshold: number;
  /** Del puntero al centro del punto, en px. */
  gx: number;
  gy: number;
  moved: boolean;
  /** El último puntero visto: con él se recalcula si el lienzo se desplaza. */
  last: PointerLike;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function useSpotDrag({
  spots,
  boardNode,
  magnet,
  grid,
  onDrop,
}: {
  spots: Point[];
  boardNode: HTMLElement | null;
  /** Interruptor «Imán» de la barra. */
  magnet: boolean;
  /** Cuadrícula encendida (su separación): el imán también pega a sus líneas. */
  grid: number | null;
  /** Se soltó el punto `i` en `p` (ya con imán, redondeado y distinto de donde estaba). */
  onDrop: (i: number, p: Point) => void;
}) {
  /** El punto que va en la mano: dónde se ve y sus guías. */
  const [moving, setMoving] = useState<{ index: number; at: Point; guides: Guide[] } | null>(null);
  const held = useRef<Held | null>(null);
  const last = useRef<Point | null>(null);
  /** El clic que manda el navegador al soltar tras arrastrar (o tras Esc) no quita el punto. */
  const swallow = useRef(false);
  const escape = useRef<((e: KeyboardEvent) => void) | null>(null);

  const stopEscape = () => {
    if (escape.current) window.removeEventListener("keydown", escape.current, true);
    escape.current = null;
  };
  useEffect(
    () => () => {
      if (escape.current) window.removeEventListener("keydown", escape.current, true);
    },
    []
  );

  /** Dónde queda el punto con el puntero ahí: dentro de lo que se ve de la foto y con imán. */
  function where(h: Held, e: PointerLike): { p: Point; guides: Guide[] } {
    const r = boardNode?.getBoundingClientRect();
    if (!boardNode || !r || r.width <= 0 || r.height <= 0) return { p: h.start, guides: NONE };
    const v = visibleArea(boardNode);
    const q = relToRect(clamp(e.clientX + h.gx, v.left, v.right), clamp(e.clientY + h.gy, v.top, v.bottom), r);
    const p = { x: clamp01(q.x), y: clamp01(q.y) };
    if (!magnet || e.altKey) return { p, guides: NONE };
    const others = spots.filter((_, j) => j !== h.index);
    return snapSpot(p, others, { tx: SNAP_PX / r.width, ty: SNAP_PX / r.height, grid });
  }

  /** Lo que se ve del punto en la mano, con el puntero en `e`. */
  function follow(h: Held, e: PointerLike) {
    h.last = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
    const s = where(h, e);
    last.current = s.p;
    setMoving({ index: h.index, at: s.p, guides: s.guides });
  }

  // El lienzo se desplaza a medio arrastre (la rueda): el punto sigue bajo el puntero
  const onScroll = useStableHandler(() => {
    const h = held.current;
    if (h?.moved) follow(h, h.last);
  });
  const dragging = moving !== null;
  useEffect(() => {
    const vp = boardNode?.closest("[data-canvas-viewport]");
    if (!dragging || !vp) return;
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, [dragging, boardNode, onScroll]);

  /** Esc: el punto vuelve a donde estaba; el clic al soltar tampoco cuenta. */
  function cancel() {
    const h = held.current;
    held.current = null;
    stopEscape();
    setMoving(null);
    if (h?.moved) swallow.current = true;
  }

  /** Se soltó (con el evento) o se perdió el puntero (sin él: queda donde se veía). */
  function drop(e: PointerLike | null) {
    const h = held.current;
    if (!h) return;
    held.current = null;
    stopEscape();
    setMoving(null);
    // Sin moverse es un clic: lo atiende el botón
    if (!h.moved) return;
    swallow.current = true;
    const seen = e ? where(h, e).p : last.current;
    if (!seen) return;
    const p = { x: round4(seen.x), y: round4(seen.y) };
    if (p.x !== h.start.x || p.y !== h.start.y) onDrop(h.index, p);
  }

  const handlers = (i: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      swallow.current = false;
      const r = boardNode?.getBoundingClientRect();
      if (e.button !== 0 || held.current || !spots[i] || !r) return;
      held.current = {
        index: i,
        pointer: e.pointerId,
        start: spots[i],
        x: e.clientX,
        y: e.clientY,
        threshold: e.pointerType === "touch" ? DRAG_START_TOUCH_PX : DRAG_START_PX,
        gx: r.left + spots[i].x * r.width - e.clientX,
        gy: r.top + spots[i].y * r.height - e.clientY,
        moved: false,
        last: { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey },
      };
      last.current = null;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Sin captura, el arrastre sigue mientras el puntero esté sobre el punto
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = held.current;
      if (!h || e.pointerId !== h.pointer) return;
      // El botón se soltó sin que llegara el pointerup (Alt+Tab, captura perdida)
      if (e.buttons === 0) return drop(e);
      if (!h.moved) {
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) < h.threshold) return;
        h.moved = true;
        escape.current = (k: KeyboardEvent) => {
          if (k.key !== "Escape") return;
          k.preventDefault();
          k.stopPropagation();
          cancel();
        };
        window.addEventListener("keydown", escape.current, true);
      }
      follow(h, e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (held.current && e.pointerId === held.current.pointer) drop(e);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (held.current && e.pointerId === held.current.pointer) cancel();
    },
    onLostPointerCapture: (e: React.PointerEvent) => {
      if (held.current && e.pointerId === held.current.pointer) drop(null);
    },
  });

  return {
    /** El punto en la mano (dónde se ve), o null. */
    moving,
    guides: moving?.guides ?? NONE,
    /** Dónde se dibuja el punto `i`: movido, si va en la mano. */
    at: (i: number): Point => (moving?.index === i ? moving.at : spots[i]),
    handlers,
    /** El clic en un punto viene de soltarlo tras arrastrar: no lo quita. Con teclado, siempre cuenta. */
    consumeClick: (viaKeyboard: boolean): boolean => {
      const skip = swallow.current && !viaKeyboard;
      swallow.current = false;
      return skip;
    },
  };
}
