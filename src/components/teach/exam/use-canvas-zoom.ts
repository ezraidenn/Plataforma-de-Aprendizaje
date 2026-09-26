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
 * El contenedor tiene el alto fijo del lienzo al 100 % (con 70 vh de tope):
 * al acercar no crece ni empuja lo de abajo, y siempre hay desplazamiento
 * para que cambiar el zoom deje quieto un punto: el del cursor con Ctrl+rueda
 * (o con el pellizco del trackpad, que llega igual), el centro del lienzo con
 * los botones. Por debajo del 100 % la foto va centrada. Espacio sostenido con
 * el puntero sobre el lienzo pone la mano: arrastrar desplaza.
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

/**
 * La parte de la foto que se ve en el lienzo, en px de la ventana: dentro del
 * contenedor que se desplaza y sin lo que tapan las reglas (`data-rulers`).
 * Puede quedar vacía (left > right) si la foto está fuera de la vista.
 */
export function visibleArea(board: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const r = board.getBoundingClientRect();
  const vp = board.closest<HTMLElement>("[data-canvas-viewport]");
  if (!vp) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const v = vp.getBoundingClientRect();
  const ruler = vp.dataset.rulers !== undefined ? RULER_PX : 0;
  const [left, top] = [v.left + vp.clientLeft, v.top + vp.clientTop];
  return {
    left: Math.max(r.left, left + ruler),
    top: Math.max(r.top, top + ruler),
    right: Math.min(r.right, left + vp.clientWidth),
    bottom: Math.min(r.bottom, top + vp.clientHeight),
  };
}

/**
 * Lleva a la vista lo que se movió con el teclado si con el zoom quedó fuera
 * del lienzo (o bajo las reglas: lo evita el `scroll-padding` del lienzo). Lo
 * justo y al instante, en el cuadro siguiente: ya dibujado donde quedó.
 */
export function revealSoon(root: ParentNode | null | undefined, selector: string) {
  requestAnimationFrame(() => root?.querySelector(selector)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
}

/** Las teclas de la mira (`useCrosshair`, en `board`): si las flechas la sacan de la vista, se lleva a ella. */
export function crosshairKeys(
  e: React.KeyboardEvent<HTMLElement>,
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void,
  board: HTMLElement | null
) {
  onKeyDown(e);
  if (e.defaultPrevented && e.key.startsWith("Arrow")) revealSoon(board, "[data-board-cursor]");
}

export type CanvasZoom = ReturnType<typeof useCanvasZoom>;

export function useCanvasZoom({ rulers }: { rulers: boolean }) {
  const [zoom, setZoom] = useState(1);
  /** Ancho útil del lienzo (sin su barra de desplazamiento) y el grosor de esa barra. */
  const [room, setRoom] = useState(0);
  const [bar, setBar] = useState(0);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const board = useRef<HTMLElement | null>(null);
  /** El zoom pedido: va delante del estado si llegan varios pasos de la rueda antes de dibujar. */
  const current = useRef(1);
  /** El zoom que se ve (el del último dibujo). */
  const shown = useRef(1);
  const anchor = useRef<Anchor | null>(null);
  /** Cuadro pedido para dibujar el zoom: el pellizco manda muchos pasos por cuadro y se dibuja uno. */
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // La primera medida antes de pintar; después, al cambiar de tamaño
  useLayoutEffect(() => {
    if (!viewport) return;
    const measure = () => {
      setRoom(viewport.clientWidth);
      // El hueco de la barra vertical siempre está reservado: su grosor es el de la horizontal
      setBar(Math.max(0, viewport.offsetWidth - viewport.clientWidth - 2 * viewport.clientLeft));
    };
    measure();
    const observer = new ResizeObserver(measure);
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

  /**
   * Cambia el zoom dejando quieto el punto (x, y) de la pantalla (sin él, el
   * centro del lienzo). Se dibuja en el cuadro siguiente, una vez aunque
   * lleguen varios pasos. El zoom nuevo, o null si no cambió.
   */
  const zoomTo = useCallback(
    (next: number, at?: { x: number; y: number }): number | null => {
      const z = clampZoom(next);
      if (Math.abs(z - current.current) < 1e-4) return null;
      current.current = z;
      const r = board.current?.getBoundingClientRect();
      if (Math.abs(z - shown.current) < 1e-4) {
        // De vuelta al zoom que se ve (+ y − antes de dibujar): no queda nada que corregir
        anchor.current = null;
      } else if (viewport && r && r.width > 0 && r.height > 0) {
        // Medido en la foto tal como se ve (los pasos pedidos aún no se dibujan)
        const v = viewport.getBoundingClientRect();
        const x = at?.x ?? v.left + viewport.clientLeft + viewport.clientWidth / 2;
        const y = at?.y ?? v.top + viewport.clientTop + viewport.clientHeight / 2;
        anchor.current = { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, x, y };
      }
      if (!frame.current) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          setZoom(current.current);
        });
      }
      return z;
    },
    [viewport]
  );

  // Con el tablero ya a su tamaño nuevo, el punto ancla vuelve a quedar donde estaba. Con el
  // alto fijo del contenedor, al acercar siempre hay desplazamiento para lograrlo; por debajo
  // del 100 % la foto va centrada y el desplazamiento queda en cero
  useLayoutEffect(() => {
    shown.current = zoom;
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
    /** Grosor de las barras de desplazamiento del lienzo (px). */
    bar,
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
  /** Un gesto empezó en el lienzo y el botón sigue abajo: quita sus escuchas de la ventana. */
  const gesture = useRef<(() => void) | null>(null);
  const endGesture = useCallback(() => {
    gesture.current?.();
    gesture.current = null;
  }, []);
  useEffect(() => endGesture, [endGesture]);

  /**
   * Ctrl+rueda a medio gesto con el puntero ya fuera del lienzo: tampoco el
   * zoom del navegador. Solo mientras dura el gesto: un escucha no pasivo en
   * la ventana obliga al navegador a esperar al script en cada rueda (sin él
   * desplaza en su propio hilo). Sobre el fantasma de lo que se arrastra desde
   * la lista lo evita el fantasma mismo (`DragGhost`).
   */
  const startGesture = () => {
    if (gesture.current) return;
    const onWheel = (e: WheelEvent) => {
      // Se soltó sin que llegara el pointerup (fuera de la ventana): el gesto ya terminó
      if (e.buttons === 0) return endGesture();
      if (e.ctrlKey) e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("pointerup", endGesture, true);
    window.addEventListener("pointercancel", endGesture, true);
    gesture.current = () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("pointerup", endGesture, true);
      window.removeEventListener("pointercancel", endGesture, true);
    };
  };

  // Nativo y no pasivo: el `onWheel` de React es pasivo y no puede evitar el zoom del navegador
  useEffect(() => {
    if (!wrapper) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        // A medio gesto (arrastrar, estirar, girar) el zoom lo descuadraría: se espera a soltar
        if (e.buttons !== 0) return;
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
      // En captura: los tiradores y los lugares pueden no dejar pasar el pointerdown
      onPointerDownCapture: startGesture,
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
