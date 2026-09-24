"use client";

import { useRef, useState, type ComponentProps } from "react";
import { ImageBoard, relToRect } from "@/components/exam/image-board";
import { clamp01, type Point } from "@/lib/image-questions";

/**
 * Lienzo del editor: la foto (`ImageBoard`) y sus capas. De abajo arriba: la
 * foto, la cuadrícula (tarea 7), lo colocado (`children`), las guías (tarea
 * 7) y el recuadro de selección. El envoltorio de fuera es el contenedor que
 * hará zoom y desplazamiento, con las reglas en su orilla (tareas 7 y 8).
 *
 * Recuadro de selección: arrastrar sobre un área vacía de la foto (no sobre un
 * lugar) dibuja un rectángulo; al soltar, `onMarquee` recibe su área en
 * coordenadas de la foto y si iba con Mayús (sumar a lo seleccionado). El
 * clic que el navegador manda al soltar no cuenta como clic en la foto.
 */

/** Rectángulo en coordenadas de la foto (0–1). */
export type Area = { left: number; top: number; right: number; bottom: number };

/** Lo que hay que mover el puntero (px) para que sea un recuadro y no un clic. */
const MARQUEE_START_PX = 4;

export function ImageCanvas({
  onMarquee,
  onPointer,
  children,
  ...board
}: ComponentProps<typeof ImageBoard> & {
  /** Recuadro terminado. Sin esto (p. ej. mientras se coloca un elemento) no hay recuadro. */
  onMarquee?: (area: Area, additive: boolean) => void;
}) {
  /** Recuadro en curso: dónde empezó (en la foto y en pantalla) y si ya se movió lo bastante. */
  const drag = useRef<{ start: Point; x: number; y: number; additive: boolean; moved: boolean } | null>(null);
  /** El clic que sigue a un recuadro no es un clic en la foto. */
  const swallowClick = useRef(false);
  const [area, setArea] = useState<Area | null>(null);

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

  return (
    // El contenedor que hará zoom (tarea 8); las reglas irán en su orilla (tarea 7)
    <div className="relative min-w-0">
      <ImageBoard
        {...board}
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
          drag.current = null;
          setArea(null);
        }}
      >
        {/* Cuadrícula (tarea 7) */}
        {children}
        {/* Guías (tarea 7) */}
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
    </div>
  );
}
