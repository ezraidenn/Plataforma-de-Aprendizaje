"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { Plus } from "lucide-react";
import type { ImageItemView } from "@/components/student/types";
import { clamp01, fileUrl, type Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Tablero de las preguntas sobre imagen: la foto con su proporción y, encima,
 * lo que se coloque en coordenadas relativas (0–1). Lo usan el alumno, la
 * revisión y el editor del maestro, así que aquí solo hay aspecto, sin lógica.
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
 * Texto y relleno de las etiquetas. La ficha lleva borde de 1 px y la sombra
 * de 2 px: con estos rellenos las dos miden lo mismo (y al menos 24 px de alto).
 */
const labelText = (dense: boolean | undefined) =>
  cn("max-w-48 text-center font-semibold text-balance", dense ? "text-[11px] leading-4" : "text-sm leading-5");
const labelPad = (dense: boolean | undefined) => (dense ? "px-2 py-[3px]" : "px-3 py-1");
const shadowPad = (dense: boolean | undefined) => (dense ? "px-[7px] py-0.5" : "px-[11px] py-[3px]");

/** Cara de una ficha: ícono en tarjeta blanca o etiqueta de texto. */
export function ItemFace({
  item,
  px,
  dense,
  className,
}: {
  item: ImageItemView;
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
        labelPad(dense),
        "block rounded-full border bg-card text-card-foreground shadow-sm",
        className
      )}
    >
      {item.text}
    </span>
  );
}

/**
 * Aspecto de un lugar libre (la «sombra»). Sin ficha activa, el mismo círculo
 * punteado para todos; con una ficha activa, la forma y el tamaño de esa
 * ficha, igual en todos. Qué hace al tocarla lo decide quien la usa.
 */
export function ZoneShadow({
  shape,
  hot,
  hoverable,
  px,
  dense,
  className,
  style,
  ...rest
}: {
  /** Ficha activa (arrastrada o elegida), o null en reposo. */
  shape: ImageItemView | null;
  /** Es donde caería la ficha si se suelta ahora. */
  hot?: boolean;
  /** Ficha elegida con un toque: el lugar bajo el cursor o con el foco se ilumina. */
  hoverable?: boolean;
  px: number;
  dense?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "flex items-center justify-center border-2 border-dashed outline-none",
        "transition-[width,height,border-radius,background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
        "focus-visible:ring-4 focus-visible:ring-primary/40",
        // 17 px y no rounded-full: así la esquina se interpola hasta los 12 px del ícono
        !shape && "size-[34px] rounded-[17px] border-muted-foreground bg-muted-foreground/12",
        shape && "border-primary bg-primary/14",
        shape?.kind === "icon" && "rounded-[12px]",
        shape?.kind === "text" && cn("max-w-48 rounded-full", shadowPad(dense)),
        shape && !hot && "motion-safe:animate-[zone-pulse_1.4s_ease-in-out_infinite]",
        shape &&
          hoverable &&
          "hover:animate-none! hover:border-solid hover:bg-primary/30 hover:ring-4 hover:ring-primary/20 focus-visible:animate-none! focus-visible:border-solid focus-visible:bg-primary/30",
        hot && "border-solid bg-primary/30 ring-4 ring-primary/20",
        className
      )}
      style={shape?.kind === "icon" ? { width: px, height: px, ...style } : style}
    >
      {!shape ? (
        <Plus className="size-3.5 text-muted-foreground" strokeWidth={3} aria-hidden />
      ) : shape.kind === "text" ? (
        // La misma etiqueta, invisible: la sombra mide exactamente lo que la ficha
        <span aria-hidden className={cn(labelText(dense), "invisible block")}>
          {shape.text}
        </span>
      ) : null}
    </button>
  );
}
