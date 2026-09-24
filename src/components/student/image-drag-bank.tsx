"use client";

import { useDraggable } from "@dnd-kit/core";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemFace } from "@/components/exam/image-board";
import type { RunnerQuestion } from "@/components/student/types";
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

/** Una ficha (en el banco o colocada): se arrastra o se toca. */
export function DraggableChip({
  item,
  label,
  px,
  dense,
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
  px: number;
  dense: boolean;
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
        "relative block cursor-grab touch-none outline-none transition-shadow duration-150 active:cursor-grabbing motion-reduce:transition-none",
        item.kind === "icon" ? "rounded-[12px]" : "rounded-full",
        "focus-visible:ring-4 focus-visible:ring-primary/40",
        pressed && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        hot && "ring-4 ring-primary/50",
        // Con otra ficha elegida, pasar sobre una colocada avisa que la reemplazaría
        selected && !pressed && data["data-zone"] && "hover:ring-4 hover:ring-primary/30",
        className
      )}
    >
      <ItemFace item={item} px={px} dense={dense} className={cn(faded && "opacity-35")} />
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
  px,
  dense,
  selected,
  dragging,
  canReturn,
  onChipClick,
  onReturn,
}: {
  groups: [string, DragItem[]][];
  labels: Map<string, string>;
  px: number;
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
                px={px}
                dense={dense}
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
