"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { Crosshair } from "lucide-react";
import { clamp01, type Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Tablero de las preguntas sobre imagen: la foto con su proporción y, encima,
 * lo que se coloque en coordenadas relativas (0–1). Lo usan el alumno, la
 * revisión y el editor del maestro, así que aquí solo hay aspecto, sin lógica.
 * Las fichas y las sombras de los lugares están en image-pieces.tsx.
 */

/** Punto de la pantalla → coordenadas relativas a un rectángulo, sin recortar. */
export function relToRect(clientX: number, clientY: number, rect: DOMRect): Point {
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

/** Coordenadas relativas (0–1) de un evento de puntero dentro del elemento. */
export function relPoint(event: { clientX: number; clientY: number }, element: Element): Point {
  const p = relToRect(event.clientX, event.clientY, element.getBoundingClientRect());
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

/** Ancho del elemento en píxeles (0 antes de medirlo), al día con sus cambios de tamaño. */
export function useElementWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  // La primera medida antes de pintar: en el celular los íconos no saltan de tamaño
  useLayoutEffect(() => {
    if (node) setWidth(node.getBoundingClientRect().width);
  }, [node]);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { ref: setNode, node, width };
}

export function ImageBoard({
  imageUrl,
  aspect,
  children,
  onPointer,
  className,
  style,
  ref,
  ...rest
}: {
  imageUrl: string;
  /** Alto / ancho de la foto. */
  aspect: number;
  children?: ReactNode;
  /** Clic sobre la foto misma (no sobre lo que tiene encima), en coordenadas relativas. */
  onPointer?: (p: Point, event: React.MouseEvent<HTMLDivElement>) => void;
  ref?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "children">) {
  return (
    <div
      ref={ref}
      {...rest}
      // Anillo y no borde: así las coordenadas del rectángulo son las de la foto
      className={cn("relative w-full select-none rounded-xl bg-muted ring-1 ring-border", className)}
      style={{ aspectRatio: 1 / aspect, ...style }}
      onClick={
        onPointer
          ? (e) => {
              if (e.target === e.currentTarget) onPointer(relPoint(e, e.currentTarget), e);
            }
          : undefined
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 size-full rounded-[inherit] object-contain"
      />
      {children}
    </div>
  );
}

/** Algo puesto sobre la foto, centrado en el punto (x, y). */
export function BoardSpot({
  x,
  y,
  className,
  style,
  children,
}: {
  x: number;
  y: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      // w-max: cerca del borde derecho, el ancho disponible no debe partir las etiquetas
      className={cn("absolute w-max -translate-x-1/2 -translate-y-1/2", className)}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, ...style }}
    >
      {children}
    </div>
  );
}

/**
 * Mira para usar el tablero con teclado: las flechas la mueven (Mayús: pasos
 * largos) y Enter o Espacio actúan donde está. Las flechas no se propagan: en
 * el examen no cambian de pregunta. `onKeyDown` va en el tablero enfocable.
 */
export function useCrosshair(aspect: number, onEnter: (p: Point) => void) {
  const [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    // Pasos iguales en pantalla: en vertical se corrigen con la proporción
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step / aspect],
      ArrowDown: [0, step / aspect],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      e.stopPropagation();
      setCursor((c) => ({ x: clamp01(c.x + move[0]), y: clamp01(c.y + move[1]) }));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEnter(cursor);
    }
  }
  return { cursor, setCursor, onKeyDown };
}

/** Mira para el teclado: solo se ve con el foco puesto desde el teclado en el tablero (que lleva `group`). */
export function BoardCursor({ x, y }: Point) {
  return (
    <BoardSpot
      x={x}
      y={y}
      className="pointer-events-none hidden text-primary drop-shadow-[0_0_2px_white] group-focus-visible:block"
    >
      <Crosshair data-board-cursor="" className="size-7" strokeWidth={2.5} aria-hidden />
    </BoardSpot>
  );
}

/**
 * Punto correcto de «señalar» con su margen de acierto: verde, o rojo punteado
 * si se quedó sin señalar. El radio es una fracción del ancho de la foto.
 */
export function SpotArea({ x, y, radius, missed }: { x: number; y: number; radius: number; missed?: boolean }) {
  return (
    <BoardSpot
      x={x}
      y={y}
      className={cn(
        "pointer-events-none rounded-full border-2",
        missed ? "border-dashed border-destructive bg-destructive/10" : "border-success bg-success/20"
      )}
      style={{ width: `${radius * 200}%`, aspectRatio: "1" }}
    />
  );
}
