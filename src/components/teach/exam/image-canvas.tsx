"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ImageBoard, relToRect } from "@/components/exam/image-board";
import type { Guide } from "@/lib/image-layout";
import { clamp01, type Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";
import type { DistanceMark } from "./use-canvas-tools";
import { RULER_PX, useCanvasGestures, type CanvasZoom } from "./use-canvas-zoom";

/**
 * Lienzo del editor (arrastrar y señalar): la foto (`ImageBoard`) y sus capas,
 * dentro de un contenedor con desplazamiento (alto máximo 70 % de la ventana)
 * que hace el zoom: `use-canvas-zoom.ts` (Ctrl+rueda, Espacio+arrastrar). De
 * abajo arriba: la foto, la cuadrícula, lo colocado (`children`), las guías
 * del imán, las distancias tras repartir y el recuadro de selección.
 *
 * Alrededor de la foto queda un margen (`zoom.pad`) donde caben los tiradores,
 * el número y la «×» de lo que está en la orilla; lo que pase de ahí se
 * recorta (no agranda el desplazamiento). Las reglas (arriba e izquierda,
 * 0–100 % de la foto, con una marca roja en el centro de la selección) se
 * quedan pegadas a la orilla del contenedor y siguen al desplazamiento.
 *
 * Recuadro de selección: arrastrar sobre un área vacía de la foto (no sobre un
 * lugar) dibuja un rectángulo; al soltar, `onMarquee` recibe su área en
 * coordenadas de la foto y si iba con Mayús (sumar a lo seleccionado). El
 * clic que el navegador manda al soltar no cuenta como clic en la foto. Esc
 * lo cancela a medio dibujar, y también se cancela si el botón se soltó
 * fuera sin que la foto se enterara.
 */

/** Rectángulo en coordenadas de la foto (0–1). */
export type Area = { left: number; top: number; right: number; bottom: number };

/** Lo que hay que mover el puntero (px) para que sea un recuadro y no un clic. */
const MARQUEE_START_PX = 4;
/** Marcas con número de las reglas (cada 10 %); en una regla más corta que esto, solo cada 20 %. */
const RULER_MARKS = Array.from({ length: 11 }, (_, k) => k * 10);
const SHORT_RULER_PX = 320;
const pct = (n: number) => `${n * 100}%`;

export function ImageCanvas({
  zoom,
  onMarquee,
  onPointer,
  rulers = false,
  rulerMark,
  grid,
  guides,
  distances,
  children,
  ref,
  className,
  style,
  ...board
}: ComponentProps<typeof ImageBoard> & {
  /** Zoom del lienzo (`useCanvasZoom`): el ancho de la foto y el contenedor que se desplaza. */
  zoom: CanvasZoom;
  /** Recuadro terminado. Sin esto (p. ej. mientras se coloca un elemento) no hay recuadro. */
  onMarquee?: (area: Area, additive: boolean) => void;
  /** Reglas arriba y a la izquierda. */
  rulers?: boolean;
  /** Centro de la selección: la marca roja de las reglas. */
  rulerMark?: Point | null;
  /** Cuadrícula: su separación (fracción de cada lado), o nada. */
  grid?: number | null;
  /** Guías del imán mientras dura un gesto. */
  guides?: Guide[];
  /** Distancias entre cajas vecinas tras repartir. */
  distances?: DistanceMark[] | null;
}) {
  /** Recuadro en curso: dónde empezó (en la foto y en pantalla) y si ya se movió lo bastante. */
  const drag = useRef<{ start: Point; x: number; y: number; additive: boolean; moved: boolean } | null>(null);
  /** El clic que sigue a un recuadro no es un clic en la foto. */
  const swallowClick = useRef(false);
  const [area, setArea] = useState<Area | null>(null);
  const { wrapperProps, hand } = useCanvasGestures(zoom);
  const { boardRef, boardWidth, pad } = zoom;
  // La foto la miden el zoom (para dejar quieto un punto) y quien usa el lienzo
  const setBoard = useCallback(
    (node: HTMLDivElement | null) => {
      boardRef(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [boardRef, ref]
  );

  /** Deja el recuadro sin seleccionar nada; el clic que llegue al soltar tampoco cuenta. */
  const cancel = () => {
    if (drag.current?.moved) swallowClick.current = true;
    drag.current = null;
    setArea(null);
  };

  // Esc a medio dibujar: se cancela solo el recuadro (lo demás del editor no se entera)
  const drawing = area !== null;
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.current?.moved) swallowClick.current = true;
      drag.current = null;
      setArea(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawing]);

  const areaTo = (e: React.PointerEvent<HTMLDivElement>, start: Point): Area => {
    const p = relToRect(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    const q = { x: clamp01(p.x), y: clamp01(p.y) };
    return {
      left: Math.min(start.x, q.x),
      right: Math.max(start.x, q.x),
      top: Math.min(start.y, q.y),
      bottom: Math.max(start.y, q.y),
    };
  };

  const photo = (
    <ImageBoard
      {...board}
      ref={setBoard}
      // Aislada: lo de dentro (lugares, guías) no pasa por encima de las reglas
      className={cn("isolate", className)}
      style={boardWidth > 0 ? { ...style, width: boardWidth } : style}
      onPointer={
        onPointer &&
        ((p, e) => {
          if (swallowClick.current) swallowClick.current = false;
          else onPointer(p, e);
        })
      }
      onPointerDown={(e) => {
        board.onPointerDown?.(e);
        swallowClick.current = false;
        // Solo sobre la foto misma, con el botón principal (en pantallas táctiles el dedo desplaza la página)
        if (!onMarquee || e.button !== 0 || e.target !== e.currentTarget || e.pointerType === "touch") return;
        const rect = e.currentTarget.getBoundingClientRect();
        drag.current = {
          start: relToRect(e.clientX, e.clientY, rect),
          x: e.clientX,
          y: e.clientY,
          additive: e.shiftKey,
          moved: false,
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Sin captura el recuadro igual funciona mientras el puntero siga sobre la foto
        }
      }}
      onPointerMove={(e) => {
        board.onPointerMove?.(e);
        const d = drag.current;
        if (!d) return;
        // Se soltó fuera sin captura: la foto no vio el pointerup
        if (e.buttons === 0) {
          drag.current = null;
          setArea(null);
          return;
        }
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < MARQUEE_START_PX) return;
        d.moved = true;
        setArea(areaTo(e, d.start));
      }}
      onPointerUp={(e) => {
        board.onPointerUp?.(e);
        const d = drag.current;
        drag.current = null;
        if (!d?.moved) return;
        swallowClick.current = true;
        setArea(null);
        onMarquee?.(areaTo(e, d.start), d.additive || e.shiftKey);
      }}
      onPointerCancel={(e) => {
        board.onPointerCancel?.(e);
        cancel();
      }}
    >
      {grid ? <GridLines step={grid} /> : null}
      {children}
      {guides?.map((g) => (
        <span
          key={`${g.axis}${g.at}`}
          aria-hidden
          data-guide={g.axis}
          className={cn(
            "pointer-events-none absolute z-30 border-dashed border-rose-600",
            g.axis === "x" ? "inset-y-0 -ml-[0.75px] border-l-[1.5px]" : "inset-x-0 -mt-[0.75px] border-t-[1.5px]"
          )}
          style={g.axis === "x" ? { left: pct(g.at) } : { top: pct(g.at) }}
        />
      ))}
      {distances?.map((m, k) => (
        <Distance key={k} mark={m} />
      ))}
      {area && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-30 rounded-[2px] border-[1.5px] border-dashed border-primary bg-primary/10"
          style={{
            left: `${area.left * 100}%`,
            top: `${area.top * 100}%`,
            width: `${(area.right - area.left) * 100}%`,
            height: `${(area.bottom - area.top) * 100}%`,
          }}
        />
      )}
    </ImageBoard>
  );

  return (
    <div {...wrapperProps} className="relative min-w-0">
      <div
        ref={zoom.viewportRef}
        data-canvas-viewport=""
        // Sin desplazamiento suave (el ancla del zoom se corrige al instante) y con el hueco de la barra
        // siempre reservado: el ancho al 100 % no cambia al aparecer la barra vertical
        className="max-h-[70vh] scroll-auto overflow-auto rounded-xl border bg-muted/40 [scrollbar-gutter:stable]"
      >
        {/* Al menos tan ancho como el lienzo (la foto va centrada entre las reglas) y recortado:
            un tirador que se sale del margen no agranda el desplazamiento */}
        <div className="w-max min-w-full overflow-clip">
          {rulers && (
            <div className="sticky top-0 z-20 flex border-b bg-background" style={{ height: RULER_PX }}>
              <span aria-hidden className="sticky left-0 z-10 shrink-0 border-r bg-background" style={{ width: RULER_PX }} />
              {/* Mismo acomodo que la fila de la foto: la regla queda justo sobre ella */}
              <div className="flex flex-1 justify-center">
                <div className="shrink-0" style={{ width: boardWidth, marginInline: pad }}>
                  <Ruler axis="x" mark={rulerMark?.x} length={boardWidth} />
                </div>
              </div>
            </div>
          )}
          <div className="flex">
            {rulers && (
              <div
                className="sticky left-0 z-10 shrink-0 border-r bg-background"
                style={{ width: RULER_PX, paddingBlock: pad }}
              >
                <Ruler axis="y" mark={rulerMark?.y} length={boardWidth * board.aspect} />
              </div>
            )}
            <div className="flex flex-1 justify-center">
              <div className="shrink-0" data-pad={pad} style={{ padding: pad }}>
                {photo}
              </div>
            </div>
          </div>
        </div>
      </div>
      {hand && (
        // La mano: encima del lienzo, toma el puntero mientras se sostiene Espacio
        <div
          aria-hidden
          data-hand=""
          className={cn("absolute inset-0 z-30 touch-none", hand.grabbing ? "cursor-grabbing" : "cursor-grab")}
          onPointerDown={hand.onPointerDown}
          onPointerMove={hand.onPointerMove}
          onPointerUp={hand.onPointerUp}
          onPointerCancel={hand.onPointerCancel}
          onLostPointerCapture={hand.onLostPointerCapture}
        />
      )}
    </div>
  );
}

/**
 * Regla de un lado de la foto: marcas cada 2 %, números cada 10 % (cada 20 %
 * si la regla es corta: no se enciman) y la marca roja de la selección.
 */
function Ruler({ axis, mark, length }: { axis: "x" | "y"; mark?: number | null; /** Largo en px. */ length: number }) {
  const x = axis === "x";
  const numbered = (n: number) => length >= SHORT_RULER_PX || n % 20 === 0;
  return (
    <div
      aria-hidden
      data-ruler={axis}
      className="pointer-events-none relative size-full select-none text-[9px] font-medium leading-none text-muted-foreground tabular-nums"
    >
      {/* Submarcas cada 2 % */}
      <span
        className={cn("absolute opacity-45", x ? "inset-x-0 bottom-0 h-1" : "inset-y-0 right-0 w-1")}
        style={{ backgroundImage: `repeating-linear-gradient(${x ? 90 : 180}deg, currentColor 0 1px, transparent 1px 2%)` }}
      />
      {RULER_MARKS.map((n) => {
        const last = n === 100;
        return (
          <span key={n}>
            <span
              className={cn("absolute bg-current opacity-70", x ? "bottom-0 h-2 w-px" : "right-0 h-px w-2")}
              style={x ? { left: `calc(${n}% - ${last ? 1 : 0}px)` } : { top: `calc(${n}% - ${last ? 1 : 0}px)` }}
            />
            {numbered(n) && (
              <span
                className={cn("absolute", x ? "top-0.5" : "left-0.5", last && (x ? "-translate-x-full" : "-translate-y-full"))}
                style={x ? { left: `calc(${n}% + ${last ? -2 : 2}px)` } : { top: `calc(${n}% + ${last ? -1 : 1}px)` }}
              >
                {n}
              </span>
            )}
          </span>
        );
      })}
      {typeof mark === "number" && (
        <span
          data-ruler-mark=""
          className={cn("absolute bg-rose-600", x ? "inset-y-0 -ml-px w-0.5" : "inset-x-0 -mt-px h-0.5")}
          style={x ? { left: pct(mark) } : { top: pct(mark) }}
        />
      )}
    </div>
  );
}

/** Cuadrícula: líneas blancas translúcidas (con un filo oscuro para verse en fotos claras). */
function GridLines({ step }: { step: number }) {
  const lines = Array.from({ length: Math.round(1 / step) - 1 }, (_, k) => (k + 1) * step);
  return (
    <span aria-hidden data-grid="" className="pointer-events-none absolute inset-0">
      {lines.map((v) => (
        <span key={v}>
          <span
            className="absolute inset-y-0 w-px bg-white/60 shadow-[1px_0_0_rgb(15_23_42/0.14)]"
            style={{ left: pct(v) }}
          />
          <span
            className="absolute inset-x-0 h-px bg-white/60 shadow-[0_1px_0_rgb(15_23_42/0.14)]"
            style={{ top: pct(v) }}
          />
        </span>
      ))}
    </span>
  );
}

/** Distancia entre dos cajas vecinas tras repartir: una cota roja con «= N %». */
function Distance({ mark }: { mark: DistanceMark }) {
  const across = mark.axis === "x";
  const [a, b] = across ? [mark.from.x, mark.to.x] : [mark.from.y, mark.to.y];
  const [lo, len] = [Math.min(a, b), Math.abs(b - a)];
  return (
    <span
      aria-hidden
      data-distance=""
      className={cn(
        "pointer-events-none absolute z-30 flex items-center justify-center border-rose-600",
        across ? "h-2 -translate-y-1/2 border-x-[1.5px]" : "w-2 -translate-x-1/2 flex-col border-y-[1.5px]"
      )}
      style={
        across
          ? { left: pct(lo), width: pct(len), top: pct(mark.from.y) }
          : { top: pct(lo), height: pct(len), left: pct(mark.from.x) }
      }
    >
      <span className={cn("bg-rose-600", across ? "h-[1.5px] w-full" : "h-full w-[1.5px]")} />
      <span
        className={cn(
          "absolute whitespace-nowrap rounded bg-background px-1 text-[10px] font-bold text-rose-600 shadow-sm",
          across ? "bottom-full left-1/2 mb-0.5 -translate-x-1/2" : "left-full top-1/2 ml-1 -translate-y-1/2"
        )}
      >
        {mark.label}
      </span>
    </span>
  );
}
