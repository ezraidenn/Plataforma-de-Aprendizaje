"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { fileUrl } from "@/lib/image-questions";
import { iconBoxPx, textPx, type ElementView } from "@/lib/image-layout";
import { cn } from "@/lib/utils";

/**
 * Piezas de «arrastrar a la imagen» que van sobre la foto: la ficha (ícono
 * puro o etiqueta) y la sombra de un lugar libre. Las usan el alumno, la
 * revisión, el editor y la ayuda; aquí solo hay aspecto.
 */

const rotate = (deg: number) => (deg ? `rotate(${deg}deg)` : undefined);

/** Sombra suave de un dibujo: drop-shadow sigue su silueta (respeta la transparencia del PNG). */
const SOFT_SHADOW = "drop-shadow(0 1px 2px rgb(0 0 0 / 0.45))";

/** Propiedades de máscara con y sin `-webkit-` (Safari anterior a 15.4). `composite`, con las palabras estándar. */
function maskStyle({
  image,
  position = "center",
  origin,
  composite,
}: {
  image: string;
  position?: string;
  origin?: string;
  composite?: string;
}): CSSProperties {
  const style: CSSProperties = {
    maskImage: image,
    WebkitMaskImage: image,
    maskPosition: position,
    WebkitMaskPosition: position,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
  if (origin) {
    style.maskOrigin = origin;
    style.WebkitMaskOrigin = origin;
  }
  if (composite) {
    style.maskComposite = composite;
    style.WebkitMaskComposite = composite.replaceAll("exclude", "xor").replaceAll("add", "source-over");
  }
  return style;
}

/** 12 direcciones: el contorno mide lo mismo hacia cualquier lado (±3 %). */
const DIRECTIONS = Array.from({ length: 12 }, (_, i) =>
  [Math.cos((i * Math.PI) / 6), Math.sin((i * Math.PI) / 6)].map((n) => Math.round(n * 1e4) / 1e4)
);

/**
 * Máscara de un anillo alrededor de la silueta: la unión de copias corridas `r`
 * en las 12 direcciones, excluida la silueta misma. Se dibuja en la caja de
 * contenido: el relleno del elemento deja lugar al anillo por fuera.
 */
function ringMask(mask: string, r: string): CSSProperties {
  const at = ([x, y]: number[]) => `calc(50% + ${r} * ${x}) calc(50% + ${r} * ${y})`;
  return maskStyle({
    image: Array(DIRECTIONS.length + 1).fill(mask).join(", "),
    position: ["center", ...DIRECTIONS.map(at)].join(", "),
    origin: "content-box",
    composite: ["exclude", ...DIRECTIONS.map(() => "add")].join(", "),
  });
}

/**
 * Contorno continuo que sigue la silueta de un dibujo: 1 px blanco pegado al
 * dibujo y, por fuera, `width` del color (se distingue sobre fotos oscuras o
 * del mismo color). Son máscaras con copias corridas del mismo PNG, no
 * filtros: Chrome redondea los desplazamientos de drop-shadow a píxeles del
 * dispositivo y el contorno salía corrido y cuadrado. Anchos en px enteros:
 * así cada copia cae en píxeles enteros con 1×, 2× o 3× y el grosor es parejo.
 */
function Contour({ mask, color, width, className }: { mask: string; color: string; width: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute -inset-1.5 p-1.5", className)}
      style={{ background: color, ...ringMask(mask, `calc(1px + ${width})`) }}
    >
      <span className="absolute inset-0 p-1.5" style={{ background: "#fff", ...ringMask(mask, "1px") }} />
    </span>
  );
}

/**
 * Un ícono tal cual, sin tarjeta: el dibujo en una caja de w×h px. La sombra
 * va en la caja y el giro en el dibujo, así la sombra cae siempre hacia abajo.
 * `outline`: color de un contorno que sigue la silueta (revisión).
 */
export function IconArt({
  fileId,
  src,
  w,
  h,
  rotation = 0,
  outline,
  className,
}: {
  fileId?: string;
  /** Dibujo que no es un archivo subido (escenas de ayuda): su URL, en lugar de `fileId`. */
  src?: string;
  w: number;
  h: number;
  rotation?: number;
  outline?: string;
  className?: string;
}) {
  const url = src ?? (fileId ? fileUrl(fileId) : undefined);
  return (
    <span className={cn("relative block", className)} style={{ width: w, height: h, filter: SOFT_SHADOW }}>
      {url && (
        <span className="absolute inset-0" style={{ transform: rotate(rotation) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" draggable={false} className="pointer-events-none size-full select-none object-contain" />
          {outline && <Contour mask={`url("${url}")`} color={outline} width="2px" />}
        </span>
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

/** Revisión: color del contorno de un ícono bien o mal puesto. */
const OUTLINE_COLOR = { ok: "var(--success)", bad: "var(--destructive)" };

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
        outline={outline && OUTLINE_COLOR[outline]}
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

/** Ícono sin archivo ni dibujo, o cuyo archivo no cargó: la silueta de una tarjeta redondeada. */
const CARD_MASK = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect width='10' height='10' rx='3'/></svg>")`;

/**
 * Silueta de un archivo como máscara. Si el archivo no carga (se borró), la de
 * una tarjeta: una máscara que no carga ocultaría el lugar entero.
 */
function useSilhouette(fileId: string | undefined): string {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId) return;
    const img = new Image();
    // Como la máscara: con CORS, así falla igual que ella
    img.crossOrigin = "anonymous";
    img.onerror = () => setFailed(fileId);
    img.src = fileUrl(fileId);
    return () => {
      img.onerror = null;
    };
  }, [fileId]);
  return fileId && failed !== fileId ? `url("${fileUrl(fileId)}")` : CARD_MASK;
}

/** Anillo de foco del teclado, separado de la foto por un anillo blanco. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:ring-2 focus-visible:ring-white";

/**
 * Aspecto de un lugar libre (la «sombra»). Sin ficha activa, el mismo círculo
 * punteado para todos; con una ficha activa, la forma, el tamaño y el giro de
 * esa ficha, igual en todos. Qué hace al tocarla lo decide quien la usa.
 *
 * Con un ícono, la sombra es su silueta: una máscara con el mismo PNG (un JPG
 * da su rectángulo). Todas las libres usan la misma, así que no delata nada.
 * El latido sigue corriendo debajo del estado de destino (que lo tapa con
 * `!`): al dejar de serlo, el lugar late al compás de los demás.
 */
export function ZoneShadow({
  shape,
  silhouette,
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
  /** URL del dibujo del ícono si no es un archivo subido (escenas de ayuda). */
  silhouette?: string;
  /** Es donde caería la ficha si se suelta ahora. */
  hot?: boolean;
  /** Ficha elegida con un toque: el lugar bajo el cursor o con el foco se ilumina. */
  hoverable?: boolean;
  /** Ancho del tablero en px (0 antes de medirlo). */
  boardWidth: number;
  dense?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const icon = shape?.kind === "icon";
  const fromFile = useSilhouette(icon && !silhouette ? shape.fileId : undefined);
  const mask = silhouette ? `url("${silhouette}")` : fromFile;
  let sized: CSSProperties | undefined;
  if (shape?.kind === "icon") {
    const { w, h } = iconBoxPx(shape.size, shape.ratio, boardWidth);
    sized = { width: w, height: h, transform: rotate(shape.rotation) };
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
        FOCUS_RING,
        // 17 px y no rounded-full: así la esquina se interpola al cambiar de forma
        !shape && "size-[34px] rounded-[17px] border-2 border-dashed border-muted-foreground bg-muted-foreground/12",
        icon && "rounded-md",
        shape?.kind === "text" &&
          cn(
            "max-w-[14em] rounded-full border-2 border-dashed border-primary bg-primary/14",
            "motion-safe:animate-[zone-pulse_1.4s_ease-in-out_infinite]",
            hoverable &&
              "hover:border-solid hover:bg-primary/30! hover:ring-4 hover:ring-primary/20 focus-visible:border-solid focus-visible:bg-primary/30!",
            hot && "border-solid bg-primary/30! ring-4 ring-primary/20"
          ),
        className
      )}
      style={{ ...sized, ...style }}
    >
      {!shape ? (
        <Plus className="size-3.5 text-muted-foreground" strokeWidth={3} aria-hidden />
      ) : icon ? (
        // Relleno translúcido y contorno con la silueta; late todo junto. El
        // grosor del contorno va en --zone-ring y el halo en el filtro del envoltorio
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 transition-[filter] duration-150 motion-reduce:transition-none",
            "motion-safe:animate-[zone-pulse-shape_1.4s_ease-in-out_infinite]",
            hot
              ? "opacity-100! [--zone-ring:3px] [filter:drop-shadow(0_0_6px_color-mix(in_srgb,var(--primary)_80%,transparent))]"
              : "[--zone-ring:2px] [filter:drop-shadow(0_0_0_transparent)]",
            hoverable &&
              cn(
                "group-hover/zone:opacity-100! group-hover/zone:[--zone-ring:3px] group-hover/zone:[filter:drop-shadow(0_0_6px_color-mix(in_srgb,var(--primary)_80%,transparent))]",
                "group-focus-visible/zone:opacity-100! group-focus-visible/zone:[--zone-ring:3px] group-focus-visible/zone:[filter:drop-shadow(0_0_6px_color-mix(in_srgb,var(--primary)_80%,transparent))]"
              )
          )}
        >
          <span
            className={cn(
              "absolute inset-0 bg-primary/30 transition-colors duration-150 motion-reduce:transition-none",
              hot && "bg-primary/60",
              hoverable && "group-hover/zone:bg-primary/60 group-focus-visible/zone:bg-primary/60"
            )}
            style={maskStyle({ image: mask })}
          />
          <Contour mask={mask} color="var(--primary)" width="var(--zone-ring)" />
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
