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
import { Crosshair, Plus } from "lucide-react";
import { clamp01, fileUrl, type Point } from "@/lib/image-questions";
import { iconBoxPx, textPx, type ElementView } from "@/lib/image-layout";
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
      <Crosshair className="size-7" strokeWidth={2.5} aria-hidden />
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

const rotate = (deg: number) => (deg ? `rotate(${deg}deg)` : undefined);

/** Sombra suave de un dibujo: drop-shadow sigue su silueta (respeta la transparencia del PNG). */
const SOFT_SHADOW = "drop-shadow(0 1px 2px rgb(0 0 0 / 0.45))";

/** Contorno que sigue la silueta: la misma sombra, sin desenfoque, corrida a los cuatro lados. */
function contour(px: number, color: string): string {
  return [`${px}px 0`, `${-px}px 0`, `0 ${px}px`, `0 ${-px}px`].map((o) => `drop-shadow(${o} 0 ${color})`).join(" ");
}

/** Revisión: contorno verde (bien) o rojo (mal) alrededor del dibujo, más la sombra suave. */
const OUTLINE_FILTER = {
  ok: `${contour(2, "var(--color-success)")} ${SOFT_SHADOW}`,
  bad: `${contour(2, "var(--color-destructive)")} ${SOFT_SHADOW}`,
};

/**
 * Un ícono tal cual, sin tarjeta: el dibujo en una caja de w×h px. La sombra
 * va en la caja y el giro en el dibujo, así la sombra cae siempre hacia abajo.
 */
export function IconArt({
  fileId,
  w,
  h,
  rotation = 0,
  filter = SOFT_SHADOW,
  className,
}: {
  fileId?: string;
  w: number;
  h: number;
  rotation?: number;
  filter?: string;
  className?: string;
}) {
  return (
    <span className={cn("block", className)} style={{ width: w, height: h, filter }}>
      {fileId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fileUrl(fileId)}
          alt=""
          draggable={false}
          className="pointer-events-none size-full select-none object-contain"
          style={{ transform: rotate(rotation) }}
        />
      )}
    </span>
  );
}

/** Alto de línea de las etiquetas, proporcional a la letra. */
const LABEL_LEADING = 1.45;
const LABEL_TEXT = "text-center font-semibold text-balance";
/**
 * Relleno de las etiquetas en `em` (crece con la letra). La ficha lleva borde
 * de 1 px y la sombra de 2 px: la sombra quita ese píxel y las dos miden lo
 * mismo (con letra de 11 px, al menos 24 px de alto).
 */
function labelPad(dense: boolean | undefined, border: 1 | 2): string {
  const less = border === 2 ? " - 1px" : "";
  return `calc(0.28em${less}) calc(${dense ? 0.7 : 0.85}em${less})`;
}

/** Etiqueta de texto: la píldora con su tamaño de letra, girada. */
export function LabelPill({
  text,
  fontPx,
  rotation = 0,
  dense,
  className,
}: {
  text: string;
  fontPx: number;
  rotation?: number;
  dense?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(LABEL_TEXT, "block max-w-[14em] rounded-full border bg-card text-card-foreground shadow-sm", className)}
      style={{ fontSize: fontPx, lineHeight: LABEL_LEADING, padding: labelPad(dense, 1), transform: rotate(rotation) }}
    >
      {text}
    </span>
  );
}

/**
 * Cara de una ficha a su tamaño real en un tablero de `boardWidth` px: el
 * ícono puro (solo el dibujo, con una sombra suave que sigue su silueta) o la
 * etiqueta de texto, con su giro. En la revisión, `outline` la marca bien o mal.
 */
export function ItemFace({
  item,
  boardWidth,
  dense,
  className,
  outline,
}: {
  item: ElementView;
  /** Ancho del tablero en px (0 antes de medirlo). */
  boardWidth: number;
  /** Etiquetas con rellenos más justos (tablero angosto o miniatura). */
  dense?: boolean;
  className?: string;
  outline?: "ok" | "bad";
}) {
  if (item.kind === "icon") {
    const { w, h } = iconBoxPx(item.size, item.ratio, boardWidth);
    return (
      <IconArt
        fileId={item.fileId}
        w={w}
        h={h}
        rotation={item.rotation}
        filter={outline ? OUTLINE_FILTER[outline] : undefined}
        className={className}
      />
    );
  }
  return (
    <LabelPill
      text={item.text ?? ""}
      fontPx={textPx(item.size, boardWidth)}
      rotation={item.rotation}
      dense={dense}
      className={cn(outline && "ring-2", outline === "ok" ? "ring-success" : outline === "bad" && "ring-destructive", className)}
    />
  );
}

/** La silueta de un dibujo como máscara, contenida y centrada igual que el <img>. */
function maskStyle(mask: string): CSSProperties {
  return {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  };
}

/** Ícono sin archivo (escenas de ayuda): la silueta de una tarjeta redondeada. */
const CARD_MASK = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect width='10' height='10' rx='3'/></svg>")`;

const PRIMARY = "var(--color-primary)";
/** Contorno de la silueta: fino mientras espera; donde caería la ficha, más grueso y con halo. */
const RING_FILTER = {
  idle: contour(1.5, PRIMARY),
  hot: `${contour(2, PRIMARY)} drop-shadow(0 0 6px color-mix(in srgb, ${PRIMARY} 80%, transparent))`,
};

/**
 * Contorno continuo de una silueta: la silueta opaca engordada con sombras
 * (`filter`) y sin su interior (máscara inversa: la silueta excluida de un
 * rectángulo lleno), para que el relleno translúcido siga viéndose. El margen
 * de 12 px deja lugar al contorno y al halo fuera del botón.
 */
function SilhouetteRing({ mask, hot, className }: { mask: string; hot?: boolean; className?: string }) {
  const inverse = `${mask}, linear-gradient(#000 0 0)`;
  return (
    <span
      className={cn("absolute -inset-3 p-3 transition-opacity duration-150 motion-reduce:transition-none", className)}
      style={{
        filter: hot ? RING_FILTER.hot : RING_FILTER.idle,
        maskImage: inverse,
        WebkitMaskImage: inverse,
        maskOrigin: "content-box, border-box",
        WebkitMaskOrigin: "content-box, border-box",
        maskSize: "contain, 100% 100%",
        WebkitMaskSize: "contain, 100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskComposite: "exclude",
        WebkitMaskComposite: "xor",
      }}
    >
      <span className="block size-full bg-primary" style={maskStyle(mask)} />
    </span>
  );
}

/**
 * Aspecto de un lugar libre (la «sombra»). Sin ficha activa, el mismo círculo
 * punteado para todos; con una ficha activa, la forma, el tamaño y el giro de
 * esa ficha, igual en todos. Qué hace al tocarla lo decide quien la usa.
 *
 * Con un ícono, la sombra es su silueta: una máscara con el mismo PNG (un JPG
 * da su rectángulo). Todas las libres usan la misma, así que no delata nada.
 */
export function ZoneShadow({
  shape,
  hot,
  hoverable,
  boardWidth,
  dense,
  className,
  style,
  ...rest
}: {
  /** Ficha activa (arrastrada o elegida), o null en reposo. */
  shape: ElementView | null;
  /** Es donde caería la ficha si se suelta ahora. */
  hot?: boolean;
  /** Ficha elegida con un toque: el lugar bajo el cursor o con el foco se ilumina. */
  hoverable?: boolean;
  /** Ancho del tablero en px (0 antes de medirlo). */
  boardWidth: number;
  dense?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  let sized: CSSProperties | undefined;
  let mask: string | null = null;
  if (shape?.kind === "icon") {
    const { w, h } = iconBoxPx(shape.size, shape.ratio, boardWidth);
    sized = { width: w, height: h, transform: rotate(shape.rotation) };
    mask = shape.fileId ? `url("${fileUrl(shape.fileId)}")` : CARD_MASK;
  } else if (shape) {
    sized = {
      fontSize: textPx(shape.size, boardWidth),
      lineHeight: LABEL_LEADING,
      padding: labelPad(dense, 2),
      transform: rotate(shape.rotation),
    };
  }
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "group/zone relative flex items-center justify-center",
        "transition-[width,height,border-radius,background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
        // El foco del teclado va en el botón, no en la silueta: se ve con cualquier forma
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        // 17 px y no rounded-full: así la esquina se interpola al cambiar de forma
        !shape && "size-[34px] rounded-[17px] border-2 border-dashed border-muted-foreground bg-muted-foreground/12",
        shape?.kind === "icon" && "rounded-md",
        shape?.kind === "text" &&
          cn(
            "max-w-[14em] rounded-full border-2 border-dashed border-primary bg-primary/14",
            !hot && "motion-safe:animate-[zone-pulse_1.4s_ease-in-out_infinite]",
            hoverable &&
              "hover:animate-none! hover:border-solid hover:bg-primary/30 hover:ring-4 hover:ring-primary/20 focus-visible:animate-none! focus-visible:border-solid focus-visible:bg-primary/30",
            hot && "border-solid bg-primary/30 ring-4 ring-primary/20"
          ),
        className
      )}
      style={{ ...sized, ...style }}
    >
      {!shape ? (
        <Plus className="size-3.5 text-muted-foreground" strokeWidth={3} aria-hidden />
      ) : mask ? (
        // Relleno translúcido y contorno con la silueta; late todo junto
        <span
          aria-hidden
          className={cn(
            "absolute inset-0",
            !hot && "motion-safe:animate-[zone-pulse-shape_1.4s_ease-in-out_infinite]",
            hoverable && "group-hover/zone:animate-none! group-focus-visible/zone:animate-none!"
          )}
        >
          <span
            className={cn(
              "absolute inset-0 bg-primary/30 transition-colors duration-150 motion-reduce:transition-none",
              hot && "bg-primary/60",
              hoverable && "group-hover/zone:bg-primary/60 group-focus-visible/zone:bg-primary/60"
            )}
            style={maskStyle(mask)}
          />
          <SilhouetteRing
            mask={mask}
            className={cn(hot && "opacity-0", hoverable && "group-hover/zone:opacity-0 group-focus-visible/zone:opacity-0")}
          />
          <SilhouetteRing
            mask={mask}
            hot
            className={cn(
              !hot && "opacity-0",
              hoverable && "group-hover/zone:opacity-100 group-focus-visible/zone:opacity-100"
            )}
          />
        </span>
      ) : (
        // La misma etiqueta, invisible: la sombra mide exactamente lo que la ficha
        <span aria-hidden className={cn(LABEL_TEXT, "invisible block")}>
          {shape.text}
        </span>
      )}
    </button>
  );
}
