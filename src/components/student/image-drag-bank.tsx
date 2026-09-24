"use client";

import type { CSSProperties, ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FOCUS_RING, IconArt, ItemFace, LabelPill, TOUCH_AREA } from "@/components/exam/image-pieces";
import type { RunnerQuestion } from "@/components/student/types";
import { iconBoxPx, textPx } from "@/lib/image-layout";
import { cn } from "@/lib/utils";

/** Fichas de «arrastrar a la imagen» y el banco donde esperan. */

export type DragItem = NonNullable<RunnerQuestion["imageDrag"]>["items"][number];

/** Fichas iguales (mismo archivo o mismo texto) van juntas en el banco. */
export const groupKey = (it: DragItem) => (it.kind === "icon" ? `i:${it.fileId}` : `t:${it.text}`);

/**
 * Grupos del banco con las fichas sin lugar. El orden de los grupos sale de
 * TODAS las fichas, así un grupo no cambia de sitio al colocar o devolver una copia.
 */
export function groupBank(all: DragItem[], isPlaced: (token: string) => boolean): [string, DragItem[]][] {
  const groups = new Map<string, DragItem[]>();
  for (const it of all) {
    const group = groups.get(groupKey(it)) ?? [];
    if (!isPlaced(it.token)) group.push(it);
    groups.set(groupKey(it), group);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 0);
}

/** Lado mayor de un ícono en el banco (px): el de su tamaño real, acotado. */
const BANK_ICON_PX = [28, 56] as const;
/** Letra de una etiqueta en el banco (px): la suya, acotada. */
const BANK_TEXT_PX = [11, 16] as const;
const clamp = (n: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, n));

/** La ficha en el banco, sin giro: el ícono en una caja de paleta o la etiqueta con su letra acotada. */
function BankFace({ item, boardWidth, dense, className }: { item: DragItem; boardWidth: number; dense: boolean; className?: string }) {
  if (item.kind === "icon") {
    // Su tamaño real, escalado para que el lado mayor quede en la caja de paleta
    const { w, h } = iconBoxPx(item.size, item.ratio, boardWidth);
    const scale = clamp(Math.max(w, h), BANK_ICON_PX) / Math.max(w, h);
    return <IconArt fileId={item.fileId} w={Math.round(w * scale)} h={Math.round(h * scale)} className={className} />;
  }
  const fontPx = clamp(textPx(item.size, boardWidth), BANK_TEXT_PX);
  return <LabelPill text={item.text ?? ""} fontPx={fontPx} dense={dense} className={className} />;
}

/** Caja sin giro que contiene una de w×h girada `deg` grados. */
function turnedBox(w: number, h: number, deg: number): CSSProperties {
  const t = (deg * Math.PI) / 180;
  const [c, s] = [Math.abs(Math.cos(t)), Math.abs(Math.sin(t))];
  return { width: Math.round(w * c + h * s), height: Math.round(w * s + h * c) };
}

/** Una ficha (en el banco o colocada): se arrastra o se toca. */
export function DraggableChip({
  item,
  label,
  boardWidth,
  dense,
  inBank,
  selected,
  hot,
  count = 1,
  faded,
  className,
  onClick,
  ...data
}: {
  item: DragItem;
  label: string;
  /** Ancho del tablero en px: en la foto la ficha va a su tamaño real. */
  boardWidth: number;
  dense: boolean;
  /** En el banco: sin giro y a tamaño de paleta. */
  inBank?: boolean;
  /** Ficha elegida con un toque, si hay. */
  selected: string | null;
  /** Es el lugar ocupado donde caería la ficha arrastrada (la reemplazaría). */
  hot?: boolean;
  count?: number;
  faded?: boolean;
  className?: string;
  onClick: (e: React.MouseEvent) => void;
  "data-zone"?: string;
  "data-group"?: string;
  "data-bank-item"?: string;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: item.token });
  const pressed = selected === item.token;
  const palette = inBank && item.kind === "icon";
  const fade = cn(faded && "opacity-35");
  let face: ReactNode;
  let style: CSSProperties | undefined;
  if (inBank) {
    face = <BankFace item={item} boardWidth={boardWidth} dense={dense} className={fade} />;
  } else if (item.kind === "icon") {
    // En la foto el ícono gira por dentro (su sombra cae hacia abajo), en una
    // caja que lo contiene girado: así los anillos lo rodean
    const { w, h } = iconBoxPx(item.size, item.ratio, boardWidth);
    style = turnedBox(w, h, item.rotation);
    face = (
      <span className="flex size-full items-center justify-center">
        <ItemFace item={item} boardWidth={boardWidth} dense={dense} className={fade} />
      </span>
    );
  } else {
    // Una etiqueta gira con su botón: los anillos giran con ella
    style = item.rotation ? { transform: `rotate(${item.rotation}deg)` } : undefined;
    face = <ItemFace item={{ ...item, rotation: 0 }} boardWidth={boardWidth} dense={dense} className={fade} />;
  }
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...data}
      data-token={item.token}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "relative cursor-grab touch-none transition-[background-color,box-shadow] duration-150 active:cursor-grabbing motion-reduce:transition-none",
        palette
          ? // Ícono del banco: sin tarjeta; se resalta solo al pasar, con el foco o elegido.
            // Al menos 32 px por lado, con el dibujo al centro: uno muy alargado se sigue pudiendo tocar
            cn(
              "grid min-h-8 min-w-8 place-items-center rounded-[10px] p-1 outline-none hover:bg-primary/10 hover:ring-2 hover:ring-primary/30 focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary",
              pressed && "bg-primary/10 ring-2 ring-primary"
            )
          : cn(
              "block",
              item.kind === "icon" ? "rounded-md" : "rounded-full",
              // Un ícono muy alargado en la foto se sigue pudiendo tocar. Con otra ficha
              // elegida no: el área de más taparía las sombras libres de al lado
              item.kind === "icon" && !(selected && !pressed) && TOUCH_AREA,
              // Sobre la foto: el mismo foco que las sombras, separado por blanco
              FOCUS_RING,
              pressed && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            ),
        hot && "ring-4 ring-primary/50",
        // Con otra ficha elegida, pasar sobre una colocada avisa que la reemplazaría
        selected && !pressed && data["data-zone"] && "hover:ring-4 hover:ring-primary/30",
        className
      )}
      style={style}
    >
      {face}
      {count > 1 && (
        <span
          aria-hidden
          className="absolute -right-2 -top-2 rounded-full bg-primary px-1.5 text-[11px] font-bold leading-[18px] text-primary-foreground ring-2 ring-card"
        >
          ×{count}
        </span>
      )}
    </button>
  );
}

/** El banco: las fichas sin lugar, agrupadas con «×N». */
export function ImageBank({
  groups,
  labels,
  boardWidth,
  dense,
  selected,
  dragging,
  canReturn,
  onChipClick,
  onReturn,
}: {
  groups: [string, DragItem[]][];
  labels: Map<string, string>;
  boardWidth: number;
  dense: boolean;
  selected: string | null;
  dragging: string | null;
  /** La ficha elegida está en la foto: se puede devolver. */
  canReturn: boolean;
  onChipClick: (token: string, e: React.MouseEvent) => void;
  onReturn: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="space-y-2 rounded-xl border border-dashed bg-muted/60 p-2.5"
      onClick={(e) => {
        // Tocar el banco (fuera de las fichas) con una ficha colocada elegida la devuelve
        if (canReturn && !(e.target as Element).closest("button")) onReturn(e);
      }}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/80">Arrastra a su lugar</p>
        {canReturn && (
          <Button size="sm" variant="ghost" onClick={onReturn}>
            <Undo2 aria-hidden />
            Devolver al banco
          </Button>
        )}
      </div>
      {groups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {groups.map(([key, group]) => {
            const first = group[0];
            // Al arrastrar sale una copia: el número baja y, si no quedan, se atenúa
            const left = group.length - (dragging === first.token ? 1 : 0);
            const label = labels.get(first.token) ?? "";
            return (
              <DraggableChip
                key={key}
                item={first}
                label={group.length > 1 ? `${label}, ${group.length} copias` : label}
                boardWidth={boardWidth}
                dense={dense}
                inBank
                selected={selected}
                count={left}
                faded={left === 0}
                data-group={key}
                data-bank-item=""
                onClick={(e) => onChipClick(first.token, e)}
              />
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Todas las fichas están en la foto. Puedes moverlas o devolverlas aquí.
        </p>
      )}
    </div>
  );
}
