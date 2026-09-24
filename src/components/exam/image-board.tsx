"use client";

import { useEffect, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { ICON_PX, type IconSize, type Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Tablero de las preguntas sobre imagen: la foto con su proporción y, encima,
 * lo que se coloque en coordenadas relativas (0–1). Lo usan el alumno, la
 * revisión y el editor del maestro, así que aquí no hay lógica de ninguno.
 */

/** URL de un archivo subido (la foto o un ícono). */
export const fileUrl = (fileId: string) => `/api/files/${fileId}`;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Punto de la pantalla → coordenadas relativas a un rectángulo, sin recortar. */
export function relToRect(clientX: number, clientY: number, rect: DOMRect): Point {
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

/** Coordenadas relativas (0–1) de un evento de puntero dentro del elemento. */
export function relPoint(event: { clientX: number; clientY: number }, element: Element): Point {
  const p = relToRect(event.clientX, event.clientY, element.getBoundingClientRect());
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

/** Lado de los íconos en un tablero de este ancho: el elegido, sin pasar del 12 % del ancho (celular). */
export function iconPx(size: IconSize, boardWidth: number): number {
  const px = ICON_PX[size];
  return boardWidth > 0 ? Math.max(24, Math.min(px, Math.round(boardWidth * 0.12))) : px;
}

/** Ancho del elemento en píxeles (0 antes de medirlo), al día con sus cambios de tamaño. */
export function useElementWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
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

/** Lo que tienen las fichas para dibujarse: ícono (archivo) o etiqueta (texto). */
export type ItemLook = { kind: "icon" | "text"; text?: string; fileId?: string };

/** Texto de las etiquetas. La sombra con forma de etiqueta usa el mismo para medir igual. */
export const labelText = (dense: boolean | undefined) =>
  cn("max-w-48 text-center font-semibold text-balance", dense ? "text-[11px] leading-4" : "text-sm leading-5");

/** Cara de una ficha: ícono en tarjeta blanca o etiqueta de texto. */
export function ItemFace({
  item,
  px,
  dense,
  className,
}: {
  item: ItemLook;
  /** Lado del ícono. */
  px: number;
  /** Etiquetas más chicas (tablero angosto o miniatura). */
  dense?: boolean;
  className?: string;
}) {
  if (item.kind === "icon") {
    return (
      <span
        className={cn("flex items-center justify-center rounded-[12px] border bg-white shadow-sm", className)}
        style={{ width: px, height: px }}
      >
        {item.fileId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl(item.fileId)}
            alt=""
            draggable={false}
            className="pointer-events-none size-full select-none object-contain p-[14%]"
          />
        )}
      </span>
    );
  }
  return (
    <span
      className={cn(
        labelText(dense),
        "block rounded-full border bg-card text-card-foreground shadow-sm",
        dense ? "px-2 py-0.5" : "px-3 py-1",
        className
      )}
    >
      {item.text}
    </span>
  );
}
