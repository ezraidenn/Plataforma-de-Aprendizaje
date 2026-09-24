"use client";

import { memo, useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Crop, Crosshair, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconArt } from "@/components/exam/image-pieces";
import { elementRatio } from "@/lib/image-layout";
import type { ImageElement } from "@/lib/image-questions";
import { joinY, plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

/** Lado de la miniatura de un elemento en la lista (px; el mismo de `size-[34px]`). */
const THUMB_PX = 34;

const NO_PLACES: number[] = [];

type RowActions = {
  onSelect: (id: string, e: React.MouseEvent) => void;
  onPlace: (id: string, e: React.MouseEvent) => void;
  onTrim: (id: string) => void;
  onRemove: (id: string) => void;
};

/**
 * La lista de elementos del editor de «arrastrar». Memorizada (con acciones
 * fijas): mover lugares en la foto no la vuelve a pintar.
 */
export const ElementList = memo(function ElementList({
  listed,
  names,
  places,
  started,
  selectedId,
  placingId,
  withMargin,
  trimmingId,
  busy,
  ...actions
}: {
  /** Los elementos en el orden de la lista. */
  listed: ImageElement[];
  names: ReadonlyMap<string, string>;
  /** Números de los lugares de cada elemento, en orden. */
  places: ReadonlyMap<string, number[]>;
  started: boolean;
  /** El del panel «Seleccionado». */
  selectedId: string | undefined;
  /** El que se está colocando. */
  placingId: string | null;
  /** Íconos con margen transparente que se puede quitar. */
  withMargin: ReadonlySet<string>;
  trimmingId: string | null;
  busy: boolean;
} & RowActions) {
  if (listed.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="Elementos">
      {listed.map((element) => (
        <ElementRow
          key={element.id}
          element={element}
          name={names.get(element.id) ?? "Elemento"}
          places={places.get(element.id) ?? NO_PLACES}
          started={started}
          selected={selectedId === element.id}
          placing={placingId === element.id}
          margin={withMargin.has(element.id)}
          trimming={trimmingId === element.id}
          busy={busy}
          {...actions}
        />
      ))}
    </ul>
  );
});

/**
 * Un elemento de la lista. Clic: lo elige para el panel «Seleccionado» (no
 * coloca nada). Se coloca arrastrándolo a la foto o con su botón «Colocar» y
 * un clic en la foto. Un ícono con margen transparente ofrece quitárselo.
 */
const ElementRow = memo(function ElementRow({
  element,
  name,
  places,
  started,
  selected,
  placing,
  margin,
  trimming,
  busy,
  onSelect,
  onPlace,
  onTrim,
  onRemove,
}: {
  element: ImageElement;
  name: string;
  /** Números de los lugares donde va, en orden. */
  places: number[];
  /** Ya hay algo en la foto: lo que no tiene lugar es un distractor, no algo pendiente. */
  started: boolean;
  /** Es el del panel «Seleccionado». */
  selected: boolean;
  /** Se está colocando: el siguiente clic en la foto pone un lugar suyo. */
  placing: boolean;
  /** Ícono con margen transparente que se puede quitar. */
  margin: boolean;
  trimming: boolean;
  /** Hay una subida en curso. */
  busy: boolean;
} & RowActions) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `el:${element.id}` });
  const main = useRef<HTMLButtonElement | null>(null);
  /** Se pulsó «Quitar margen»: al desaparecer el botón, el foco pasa a la fila (y Ctrl+Z sigue a mano). */
  const trimClicked = useRef(false);
  const showTrim = margin || trimming;
  useEffect(() => {
    if (showTrim || !trimClicked.current) return;
    trimClicked.current = false;
    if (!document.activeElement || document.activeElement === document.body) main.current?.focus({ preventScroll: true });
  }, [showTrim]);
  const n = places.length;
  const distractor = started && n === 0;
  const status =
    n > 0
      ? `Va en ${n} ${plural(n, "lugar", "lugares")} (${joinY(places)})`
      : distractor
        ? "Sin lugar: distractor"
        : "Arrástralo a la foto";
  const ratio = elementRatio(element);
  const thumb =
    ratio >= 1
      ? { w: Math.max(1, Math.round(THUMB_PX / ratio)), h: THUMB_PX }
      : { w: THUMB_PX, h: Math.max(1, Math.round(THUMB_PX * ratio)) };
  return (
    <li
      className={cn(
        "rounded-xl border p-1 transition-colors",
        distractor && "border-warning/40 bg-warning/10",
        selected && "border-primary bg-primary/5",
        placing && "ring-2 ring-primary/30",
        isDragging && "opacity-60"
      )}
    >
      <div className="flex items-center gap-0.5">
        <button
          ref={(node) => {
            setNodeRef(node);
            main.current = node;
          }}
          type="button"
          {...listeners}
          data-element={element.id}
          onClick={(e) => onSelect(element.id, e)}
          aria-pressed={selected}
          aria-label={`${name}: ${status}`}
          title="Clic: cambiar su tamaño y su giro. Arrástralo a la foto para colocarlo"
          className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg p-0.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-primary/40 active:cursor-grabbing"
        >
          {element.kind === "icon" ? (
            // Con su proporción: el lado mayor mide lo de la miniatura
            <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center">
              <IconArt fileId={element.fileId} w={thumb.w} h={thumb.h} />
            </span>
          ) : (
            <span
              aria-hidden
              className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border bg-card text-[11px] font-bold text-muted-foreground"
            >
              Aa
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span
              className={cn("block text-xs", distractor ? "text-amber-700 dark:text-warning" : "text-muted-foreground")}
            >
              {status}
            </span>
          </span>
        </button>
        <Button
          type="button"
          size="icon-sm"
          variant={placing ? "default" : "ghost"}
          className={cn("shrink-0", !placing && "text-muted-foreground hover:text-primary")}
          aria-pressed={placing}
          aria-label={`Colocar ${name} en la foto`}
          title="Colocar: después haz clic en la foto donde va"
          onClick={(e) => onPlace(element.id, e)}
        >
          <Crosshair aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Quitar ${name}${n > 0 ? ` y ${plural(n, "su lugar", "sus lugares")}` : ""}`}
          onClick={() => onRemove(element.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {showTrim && (
        <div className="flex items-center gap-1.5 pb-0.5 pl-[42px] pt-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            // Mientras sube no se deshabilita del todo: así el foco no se pierde
            aria-disabled={busy}
            aria-label={`Quitar margen a ${name}`}
            className="aria-disabled:opacity-60"
            title="El archivo tiene margen transparente: se recorta al dibujo (conserva su tamaño, su giro y sus lugares)"
            onClick={() => {
              if (busy) return;
              trimClicked.current = true;
              onTrim(element.id);
            }}
          >
            {trimming ? <Loader2 className="animate-spin" aria-hidden /> : <Crop aria-hidden />}
            {trimming ? "Quitando…" : "Quitar margen"}
          </Button>
        </div>
      )}
    </li>
  );
});
