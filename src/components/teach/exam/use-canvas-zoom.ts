"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ZOOM_MAX, ZOOM_MIN, clampZoom, wheelZoom, zoomStep } from "@/lib/image-layout";
import { isTypingTarget } from "./use-editor-history";

/**
 * Zoom y desplazamiento del lienzo del editor (arrastrar y señalar). La foto
 * vive en un contenedor con desplazamiento; al 100 % ocupa el ancho disponible
 * («Ajustar») y el zoom va del 50 al 400 %. El tablero se dibuja de verdad a
 * ese ancho (no se escala con CSS): así todo lo que se mide en píxeles —el
 * mínimo legible de los íconos, el umbral del imán, los tiradores, el
 * recuadro, puntero → coordenadas de la foto— sigue valiendo, y los tiradores
 * y las guías conservan su grosor en pantalla. Lo guardado es relativo a la
 * foto: el zoom no lo cambia.
 *
 * Cambiar el zoom deja quieto un punto: el del cursor con Ctrl+rueda (o con
 * el pellizco del trackpad, que llega igual), el centro del lienzo con los
 * botones. Espacio sostenido con el puntero sobre el lienzo pone la mano:
 * arrastrar desplaza.
 */

/** Margen alrededor de la foto dentro del lienzo: ahí caben los tiradores y el número de lo que está en la orilla. */
export const CANVAS_PAD = 40;
/** En un lienzo angosto (celular) el margen es menor: la foto no se queda tan chica. */
const NARROW_PX = 480;
const NARROW_PAD = 24;
/** Grosor de las reglas (con su borde). */
export const RULER_PX = 18;

/** Punto que se deja quieto al cambiar el zoom: en la foto (fracciones) y en la pantalla. */
type Anchor = { fx: number; fy: number; x: number; y: number };

export type CanvasZoom = ReturnType<typeof useCanvasZoom>;

export function useCanvasZoom({ rulers }: { rulers: boolean }) {
  const [zoom, setZoom] = useState(1);
  /** Ancho útil del lienzo (sin su barra de desplazamiento). */
  const [room, setRoom] = useState(0);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const board = useRef<HTMLElement | null>(null);
  /** El zoom pedido: va delante del estado si llegan varios pasos de la rueda antes de dibujar. */
  const current = useRef(1);
  const anchor = useRef<Anchor | null>(null);

  // La primera medida antes de pintar; después, al cambiar de tamaño
  useLayoutEffect(() => {
    if (viewport) setRoom(viewport.clientWidth);
  }, [viewport]);
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(() => setRoom(viewport.clientWidth));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);

  const pad = room > 0 && room < NARROW_PX ? NARROW_PAD : CANVAS_PAD;
  /** Ancho de la foto al 100 %: lo que queda sin las reglas ni el margen. */
  const fit = Math.max(0, room - 2 * pad - (rulers ? RULER_PX : 0));
  // Hacia abajo: al 100 % no aparece una barra horizontal por medio píxel
  const boardWidth = Math.floor(fit * zoom);

  const boardRef = useCallback((node: HTMLElement | null) => {
    board.current = node;
  }, []);

  /** Cambia el zoom dejando quieto el punto (x, y) de la pantalla (sin él, el centro del lienzo). El zoom nuevo, o null si no cambió. */
  const zoomTo = useCallback(
    (next: number, at?: { x: number; y: number }): number | null => {
      const z = clampZoom(next);
      if (Math.abs(z - current.current) < 1e-4) return null;
      const r = board.current?.getBoundingClientRect();
      if (viewport && r && r.width > 0 && r.height > 0) {
        const v = viewport.getBoundingClientRect();
        const x = at?.x ?? v.left + viewport.clientLeft + viewport.clientWidth / 2;
        const y = at?.y ?? v.top + viewport.clientTop + viewport.clientHeight / 2;
        anchor.current = { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, x, y };
      }
      current.current = z;
      setZoom(z);
      return z;
    },
    [viewport]
  );

  // Con el tablero ya a su tamaño nuevo, el punto ancla vuelve a quedar donde estaba
  // (si la foto cabe entera, el desplazamiento se queda en cero y no hay nada que corregir)
  useLayoutEffect(() => {
    const a = anchor.current;
    const r = board.current?.getBoundingClientRect();
    if (!a || !viewport || !r) return;
    anchor.current = null;
    viewport.scrollLeft += r.left + a.fx * r.width - a.x;
    viewport.scrollTop += r.top + a.fy * r.height - a.y;
  }, [zoom, boardWidth, viewport]);

  return {
    zoom,
    /** Margen alrededor de la foto (px). */
    pad,
    /** Ancho de la foto al 100 % (el disponible). */
    fit,
    /** Ancho de la foto en pantalla, ya con el zoom. */
    boardWidth,
    viewport,
    viewportRef: setViewport,
    boardRef,
    /** El zoom pedido al momento (sin esperar a dibujar). */
    current,
    zoomTo,
    zoomIn: () => zoomTo(zoomStep(current.current, 1)),
    zoomOut: () => zoomTo(zoomStep(current.current, -1)),
    /** «Ajustar»: al ancho disponible (100 %). */
    fitWidth: () => zoomTo(1),
    canZoomIn: zoom < ZOOM_MAX - 1e-4,
    canZoomOut: zoom > ZOOM_MIN + 1e-4,
  };
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta"]);
const isSpace = (e: KeyboardEvent) => e.code === "Space" || e.key === " ";

/**
 * Los gestos del lienzo (en `ImageCanvas`). Ctrl+rueda acerca o aleja sobre
 * el cursor, sin el zoom del navegador. Espacio con el puntero sobre el lienzo
 * pone la mano (una capa encima que toma el puntero): arrastrar desplaza. La
 * mano solo sale si lo último que se usó fue el puntero, y nunca mientras se
 * escribe: con el teclado, Espacio sigue siendo Espacio (sumar un lugar a la
 * selección, marcar con la mira).
 */
export function useCanvasGestures(zoom: CanvasZoom) {
  const { viewport, zoomTo, current } = zoom;
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  /** Espacio sostenido para desplazar. */
  const [space, setSpace] = useState(false);
  /** Arrastre con la mano en curso. */
  const [grabbing, setGrabbing] = useState(false);
  const grab = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const held = useRef(false);
  /** El puntero está sobre el lienzo, fue lo último que se usó, y con qué botones. */
  const over = useRef(false);
  const fresh = useRef(false);
  const buttons = useRef(0);

  // Nativo y no pasivo: el `onWheel` de React es pasivo y no puede evitar el zoom del navegador
  useEffect(() => {
    if (!wrapper) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoomTo(wheelZoom(current.current, e.deltaY, e.deltaMode), { x: e.clientX, y: e.clientY });
      } else if (held.current && viewport) {
        // Con la mano puesta la rueda cae en su capa (que no está dentro del lienzo): el lienzo se desplaza igual
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
        viewport.scrollLeft += e.deltaX * k;
        viewport.scrollTop += e.deltaY * k;
      }
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, [wrapper, viewport, zoomTo, current]);

  useEffect(() => {
    const release = () => {
      held.current = false;
      setSpace(false);
    };
    // En captura, antes que el editor: si es para la mano, nadie más la ve (ni la página se desplaza)
    const onDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) {
        if (!MODIFIERS.has(e.key)) fresh.current = false;
        return;
      }
      if (held.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey || !over.current || !fresh.current || buttons.current !== 0) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      held.current = true;
      setSpace(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!isSpace(e) || !held.current) return;
      // Tampoco «pulsa» el botón que tenga el foco
      e.preventDefault();
      e.stopPropagation();
      release();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  const track = (e: React.PointerEvent) => {
    over.current = true;
    fresh.current = true;
    buttons.current = e.buttons;
  };
  const endGrab = () => {
    grab.current = null;
    setGrabbing(false);
  };

  return {
    /** Para el envoltorio del lienzo. */
    wrapperProps: {
      ref: setWrapper,
      onPointerMove: track,
      onPointerDown: track,
      onPointerUp: track,
      onPointerLeave: () => {
        over.current = false;
      },
    },
    /** La capa de la mano (null: no se ve). */
    hand:
      space || grabbing
        ? {
            grabbing,
            onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
              if (e.button !== 0 || !viewport) return;
              // Sin foco ni selección de texto: lo que tenía el foco lo conserva
              e.preventDefault();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Sin captura, la mano sigue mientras el puntero esté sobre el lienzo
              }
              grab.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
              setGrabbing(true);
            },
            onPointerMove: (e: React.PointerEvent) => {
              const g = grab.current;
              if (!g || e.pointerId !== g.pointer || !viewport) return;
              if (e.buttons === 0) return endGrab();
              viewport.scrollLeft = g.left - (e.clientX - g.x);
              viewport.scrollTop = g.top - (e.clientY - g.y);
            },
            onPointerUp: endGrab,
            onPointerCancel: endGrab,
            onLostPointerCapture: endGrab,
          }
        : null,
  };
}
