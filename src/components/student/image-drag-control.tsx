"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BoardSpot,
  ImageBoard,
  ItemFace,
  fileUrl,
  iconPx,
  labelText,
  relToRect,
  useElementWidth,
} from "@/components/exam/image-board";
import type { RunnerQuestion } from "@/components/student/types";
import { nearestZone, type Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * «Arrastrar a la imagen», lo que ve el alumno. Tres maneras de colocar una
 * ficha, con la misma regla:
 * - Arrastrar (ratón o dedo, con dnd-kit): al soltar manda el CENTRO de la
 *   ficha.
 * - Tocar y tocar: tocar una ficha la elige; tocar una sombra (o la foto cerca
 *   de una) la coloca; tocar la ficha elegida otra vez la suelta.
 * - Teclado: fichas y sombras son botones; Enter o Espacio hacen lo mismo que
 *   tocar y Escape cancela.
 *
 * Regla de encaje: la ficha cae en el lugar más cercano dentro de SNAP_RADIUS,
 * esté libre u ocupado; si estaba ocupado, lo que había vuelve al banco. Si no
 * hay lugar cerca, la ficha vuelve al banco.
 *
 * Las sombras no delatan nada: en reposo todas son el mismo círculo, y con una
 * ficha en la mano todas las libres toman la forma y el tamaño de esa ficha.
 */

type DragConfig = NonNullable<RunnerQuestion["imageDrag"]>;
type Item = DragConfig["items"][number];

/** Los avisos van por la región propia, en español; los de dnd-kit, callados. */
const QUIET: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};
const noSubscribe = () => () => {};

/** Nombre de cada ficha: su texto, o «Ícono N» (el mismo número para el mismo archivo). */
function itemLabels(items: Item[]): Map<string, string> {
  const iconNumber = new Map<string, number>();
  return new Map(
    items.map((it) => {
      if (it.kind === "text") return [it.token, it.text ?? ""];
      const file = it.fileId ?? "";
      if (!iconNumber.has(file)) iconNumber.set(file, iconNumber.size + 1);
      return [it.token, `Ícono ${iconNumber.get(file)}`];
    })
  );
}

/**
 * Banco: fichas iguales (mismo archivo o mismo texto) juntas. El orden de los
 * grupos sale de TODAS las fichas, así un grupo no cambia de sitio al colocar
 * o devolver una copia.
 */
function groupBank(all: Item[], isPlaced: (token: string) => boolean): [string, Item[]][] {
  const groups = new Map<string, Item[]>();
  for (const it of all) {
    const key = it.kind === "icon" ? `i:${it.fileId}` : `t:${it.text}`;
    const group = groups.get(key) ?? [];
    if (!isPlaced(it.token)) group.push(it);
    groups.set(key, group);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 0);
}

export function ImageDragControl({
  image,
  config,
  value,
  onChange,
}: {
  image: string;
  config: DragConfig;
  /** `{ fichaDeLugar: fichaDeElemento }` tal como está guardado. */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const board = useElementWidth<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  /** Ficha elegida con un toque (o con Enter). */
  const [selected, setSelected] = useState<string | null>(null);
  /** Ficha que va en la mano (arrastre). */
  const [dragging, setDragging] = useState<string | null>(null);
  /** Lugar donde caería la ficha si se suelta ahora. */
  const [hot, setHot] = useState<string | null>(null);
  const [live, setLive] = useState({ text: "", n: 0 });
  const focusAfter = useRef<(() => HTMLElement | null) | null>(null);
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);

  // Sin sensor de teclado: con teclado se elige y se coloca con Enter, como al tocar
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Lugares en orden de lectura: «Lugar 1» es el de más arriba
  const zones = useMemo(() => [...config.zones].sort((a, b) => a.y - b.y || a.x - b.x), [config.zones]);
  const items = useMemo(() => new Map(config.items.map((it) => [it.token, it])), [config.items]);
  const labels = useMemo(() => itemLabels(config.items), [config.items]);

  // Lo guardado, solo con lugares y fichas que existen, y cada ficha una vez
  const placement = useMemo(() => {
    const zoneTokens = new Set(config.zones.map((z) => z.token));
    const used = new Set<string>();
    const out: Record<string, string> = {};
    for (const [zone, item] of Object.entries(value)) {
      if (!zoneTokens.has(zone) || !items.has(item) || used.has(item)) continue;
      used.add(item);
      out[zone] = item;
    }
    return out;
  }, [value, config.zones, items]);
  const zoneOf = useMemo(
    () => new Map(Object.entries(placement).map(([zone, item]) => [item, zone])),
    [placement]
  );
  const bank = useMemo(() => groupBank(config.items, (token) => zoneOf.has(token)), [config.items, zoneOf]);

  const active = dragging ?? selected;
  const activeItem = active ? (items.get(active) ?? null) : null;
  const px = iconPx(config.iconSize, board.width);
  const dense = board.width > 0 && board.width < 480;
  const zoneNumber = (token: string) => zones.findIndex((z) => z.token === token) + 1;

  // Foco tras una acción con teclado: el botón nuevo aparece en el siguiente render
  useEffect(() => {
    const pick = focusAfter.current;
    if (!pick) return;
    focusAfter.current = null;
    pick()?.focus();
  });

  const announce = (text: string) => setLive((l) => ({ text, n: l.n + 1 }));
  const find = (selector: string) => rootRef.current?.querySelector<HTMLElement>(selector) ?? null;
  const zoneSelector = (zone: string) => `[data-zone="${CSS.escape(zone)}"]`;

  function place(item: string, zone: string, viaKeyboard: boolean) {
    setSelected(null);
    const from = zoneOf.get(item);
    let text = `Colocado en el lugar ${zoneNumber(zone)}`;
    if (from !== zone) {
      const next = { ...placement };
      if (from) delete next[from];
      const previous = next[zone];
      next[zone] = item;
      onChange(next);
      if (previous) text += `; ${labels.get(previous)} volvió al banco`;
    }
    announce(text);
    // Con teclado se sigue con la próxima ficha del banco; si ya no hay, en el lugar
    if (viaKeyboard) focusAfter.current = () => find("[data-bank-item]") ?? find(zoneSelector(zone));
  }

  function unplace(item: string) {
    setSelected(null);
    const from = zoneOf.get(item);
    if (!from) return;
    const next = { ...placement };
    delete next[from];
    onChange(next);
    announce("Devuelto al banco");
  }

  function onChipClick(token: string, e: React.MouseEvent) {
    const viaKeyboard = e.detail === 0;
    if (selected === token) {
      setSelected(null);
      announce("Elección cancelada");
      return;
    }
    // Con otra ficha elegida, tocar una ya colocada es tocar su lugar: la reemplaza
    const zone = zoneOf.get(token);
    if (selected && zone) {
      place(selected, zone, viaKeyboard);
      return;
    }
    setSelected(token);
    announce(`Elegiste ${labels.get(token)}. Ahora elige su lugar`);
    if (viaKeyboard) focusAfter.current = () => find("[data-free-zone]") ?? find("[data-zone]");
  }

  function onZoneClick(zone: string, e: React.MouseEvent) {
    if (!selected) {
      announce("Primero elige una ficha del banco");
      return;
    }
    place(selected, zone, e.detail === 0);
  }

  /** Toque en la foto con una ficha elegida: al lugar más cercano, si hay uno a la mano. */
  function onBoardTap(p: Point) {
    if (!selected) return;
    const i = nearestZone(zones, p, config.aspect, () => true);
    if (i !== null) place(selected, zones[i].token, false);
  }

  /** Lugar donde cae la ficha arrastrada, según dónde está su centro. */
  function dropZone(e: Pick<DragEndEvent, "active">): string | null {
    const rect = e.active.rect.current.translated;
    if (!rect || !board.node) return null;
    const center = relToRect(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      board.node.getBoundingClientRect()
    );
    const i = nearestZone(zones, center, config.aspect, () => true);
    return i === null ? null : zones[i].token;
  }

  const chipProps = { px, dense, selected };

  return (
    <div
      ref={rootRef}
      // Una etiqueta junto al borde de la foto no debe abrir desplazamiento de lado en el celular
      className="space-y-3 overflow-x-clip [overflow-clip-margin:16px]"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) {
          e.preventDefault();
          setSelected(null);
          announce("Elección cancelada");
          // El foco vuelve a la ficha que se había elegido
          const token = selected;
          focusAfter.current = () => find(`[data-token="${CSS.escape(token)}"]`);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Arrastra cada ficha a su lugar en la foto, o tócala y después toca su lugar.
      </p>
      <DndContext
        sensors={sensors}
        accessibility={{ announcements: QUIET }}
        // Desplaza solo muy cerca del borde: con el 20 % de fábrica, una sombra
        // arriba de la vista se alejaba justo al llegar a ella
        autoScroll={{ threshold: { x: 0, y: 0.08 } }}
        onDragStart={(e) => {
          setSelected(null);
          setDragging(String(e.active.id));
        }}
        onDragMove={(e) => setHot(dropZone(e))}
        onDragEnd={(e) => {
          const token = String(e.active.id);
          const zone = dropZone(e);
          setDragging(null);
          setHot(null);
          if (zone) place(token, zone, false);
          else if (zoneOf.has(token)) unplace(token);
        }}
        onDragCancel={() => {
          setDragging(null);
          setHot(null);
        }}
      >
        <ImageBoard
          ref={board.ref}
          imageUrl={fileUrl(image)}
          aspect={config.aspect}
          onPointer={selected ? (p) => onBoardTap(p) : undefined}
        >
          {zones.map((z, i) => {
            const token = placement[z.token];
            const item = token ? items.get(token) : undefined;
            // La ficha de este lugar va en la mano: se ve la sombra, y el botón
            // sigue montado (invisible) para que dnd-kit no pierda el arrastre
            const lifted = !!item && item.token === dragging;
            const isHot = hot === z.token;
            return (
              <BoardSpot
                key={z.token}
                x={z.x}
                y={z.y}
                className={cn(
                  "grid place-items-center *:[grid-area:1/1]",
                  item && !lifted && "z-10",
                  isHot && "z-20"
                )}
              >
                {item && (
                  <Chip
                    key="item"
                    {...chipProps}
                    item={item}
                    label={`Lugar ${i + 1}: ${labels.get(item.token)}`}
                    hot={isHot}
                    className={lifted ? "invisible" : undefined}
                    data-zone={z.token}
                    onClick={(e) => onChipClick(item.token, e)}
                  />
                )}
                {(!item || lifted) && (
                  <ZoneShadow
                    key="zone"
                    zone={z.token}
                    n={i + 1}
                    shape={activeItem}
                    hot={isHot}
                    tapMode={!!selected}
                    px={px}
                    dense={dense}
                    onClick={(e) => onZoneClick(z.token, e)}
                  />
                )}
              </BoardSpot>
            );
          })}
        </ImageBoard>

        <div
          className="space-y-2 rounded-xl border border-dashed bg-muted/60 p-2.5"
          onClick={(e) => {
            // Tocar el banco con una ficha colocada elegida la devuelve
            if (e.target === e.currentTarget && selected && zoneOf.has(selected)) unplace(selected);
          }}
        >
          <div className="flex min-h-7 items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Arrastra a su lugar
            </p>
            {selected && zoneOf.has(selected) && (
              <Button size="sm" variant="ghost" onClick={() => unplace(selected)}>
                <Undo2 aria-hidden />
                Devolver al banco
              </Button>
            )}
          </div>
          {bank.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2.5">
              {bank.map(([key, group]) => {
                const first = group[0];
                // Al arrastrar sale una copia: el número baja y, si no quedan, se atenúa
                const left = group.length - (dragging === first.token ? 1 : 0);
                const label = labels.get(first.token) ?? "";
                return (
                  <Chip
                    key={key}
                    {...chipProps}
                    item={first}
                    label={group.length > 1 ? `${label}, ${group.length} copias` : label}
                    count={left}
                    faded={left === 0}
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

        {isClient &&
          // Al cuerpo del documento: un ancestro con transform movería el fantasma
          createPortal(
            <DragOverlay dropAnimation={null}>
              {dragging && activeItem ? (
                <ItemFace
                  item={activeItem}
                  px={px}
                  dense={dense}
                  className="-rotate-4 cursor-grabbing opacity-95 shadow-[0_14px_28px_-8px_rgb(15_23_42/0.45)]"
                />
              ) : null}
            </DragOverlay>,
            document.body
          )}
      </DndContext>
      <p className="sr-only" role="status" aria-live="polite">
        {live.text}
        {/* Un carácter invisible alterno para que se repita el mismo aviso */}
        {live.n % 2 ? String.fromCharCode(0x200b) : ""}
      </p>
    </div>
  );
}

/** Una ficha (en el banco o colocada): se arrastra o se toca. */
function Chip({
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
  item: Item;
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
        // Con otra ficha elegida, pasar por encima avisa que la reemplazaría
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

/**
 * Un lugar libre. Sin ficha activa: el mismo círculo punteado para todos. Con
 * una ficha activa: la forma y el tamaño de esa ficha, igual en todos.
 */
function ZoneShadow({
  zone,
  n,
  shape,
  hot,
  tapMode,
  px,
  dense,
  onClick,
}: {
  zone: string;
  n: number;
  shape: Item | null;
  hot: boolean;
  /** Ficha elegida con un toque: el lugar bajo el cursor o con el foco se ilumina. */
  tapMode: boolean;
  px: number;
  dense: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      data-zone={zone}
      data-free-zone=""
      aria-label={`Lugar ${n}`}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center border-2 border-dashed outline-none",
        "transition-[width,height,border-radius,background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
        "focus-visible:ring-4 focus-visible:ring-primary/40",
        !shape && "size-[34px] rounded-full border-muted-foreground bg-muted-foreground/12",
        shape && "border-primary bg-primary/14",
        shape?.kind === "icon" && "rounded-[12px]",
        shape?.kind === "text" &&
          cn("max-w-48 rounded-full", dense ? "px-[7px] py-px" : "px-[11px] py-[3px]"),
        shape && !hot && "motion-safe:animate-[zone-pulse_1.4s_ease-in-out_infinite]",
        shape &&
          tapMode &&
          "hover:animate-none! hover:border-solid hover:bg-primary/30 hover:ring-4 hover:ring-primary/20 focus-visible:animate-none! focus-visible:border-solid focus-visible:bg-primary/30",
        hot && "border-solid bg-primary/30 ring-4 ring-primary/20"
      )}
      style={shape?.kind === "icon" ? { width: px, height: px } : undefined}
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
