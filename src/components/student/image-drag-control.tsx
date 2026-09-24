"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { BoardSpot, ImageBoard, ItemFace, ZoneShadow, relToRect, useElementWidth } from "@/components/exam/image-board";
import { QUIET_ANNOUNCEMENTS, useIsClient } from "@/components/exam/image-dnd";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import { DraggableChip, ImageBank, groupBank, groupKey } from "@/components/student/image-drag-bank";
import type { RunnerQuestion } from "@/components/student/types";
import {
  fileUrl,
  iconNumbers,
  iconPx,
  imageItemName,
  nearestZone,
  parseDragAnswer,
  readingOrder,
  type Point,
} from "@/lib/image-questions";
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

export function ImageDragControl({
  image,
  config,
  answerText,
  onChange,
}: {
  image: string;
  config: DragConfig;
  /** Lo guardado: `{ fichaDeLugar: fichaDeElemento }` en JSON. */
  answerText: string;
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
  const { live, announce } = useAnnouncer();
  const focusAfter = useRef<(() => HTMLElement | null) | null>(null);
  const isClient = useIsClient();

  // Sin sensor de teclado: con teclado se elige y se coloca con Enter, como al tocar
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // «Lugar N» en orden de lectura, el mismo que usa la revisión
  const zones = useMemo(() => readingOrder(config.zones, config.aspect), [config.zones, config.aspect]);
  const items = useMemo(() => new Map(config.items.map((it) => [it.token, it])), [config.items]);
  const labels = useMemo(() => {
    const icons = iconNumbers(config.items.map((it) => it.fileId));
    return new Map(config.items.map((it) => [it.token, imageItemName(it, icons)]));
  }, [config.items]);

  // Lo guardado, solo con lugares y fichas que existen, y cada ficha una vez
  const placement = useMemo(() => {
    const zoneTokens = new Set(config.zones.map((z) => z.token));
    const used = new Set<string>();
    const out: Record<string, string> = {};
    for (const [zone, item] of Object.entries(parseDragAnswer(answerText))) {
      if (!zoneTokens.has(zone) || !items.has(item) || used.has(item)) continue;
      used.add(item);
      out[zone] = item;
    }
    return out;
  }, [answerText, config.zones, items]);
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

  const find = (selector: string) => rootRef.current?.querySelector<HTMLElement>(selector) ?? null;
  const attr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;

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
    if (viaKeyboard) focusAfter.current = () => find("[data-bank-item]") ?? find(attr("data-zone", zone));
  }

  function unplace(item: string, viaKeyboard: boolean) {
    setSelected(null);
    const from = zoneOf.get(item);
    const it = items.get(item);
    if (!from || !it) return;
    const next = { ...placement };
    delete next[from];
    onChange(next);
    announce("Devuelto al banco");
    // El foco sigue a la ficha, ya en el banco (en su grupo, si hay copias)
    if (viaKeyboard) focusAfter.current = () => find(attr("data-group", groupKey(it)));
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
    const i = nearestZone(zones, p, config.aspect);
    if (i !== null) place(selected, zones[i].token, false);
    else announce("Toca uno de los lugares marcados en la foto");
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
    const i = nearestZone(zones, center, config.aspect);
    return i === null ? null : zones[i].token;
  }

  return (
    <div
      ref={rootRef}
      // Una etiqueta junto al borde de la foto no debe abrir desplazamiento de lado en el celular.
      // Recorte en los dos ejes: con solo el horizontal, Chrome ignora el margen y corta al ras de la foto
      className="space-y-3 overflow-clip [overflow-clip-margin:16px]"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) {
          e.preventDefault();
          setSelected(null);
          announce("Elección cancelada");
          // El foco vuelve a la ficha que se había elegido
          const token = selected;
          focusAfter.current = () => find(attr("data-token", token));
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Arrastra cada ficha a su lugar en la foto, o tócala y después toca su lugar. Si el lugar ya
        tiene una ficha, la nueva la reemplaza.
      </p>
      <DndContext
        sensors={sensors}
        accessibility={{ announcements: QUIET_ANNOUNCEMENTS }}
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
          else if (zoneOf.has(token)) unplace(token, false);
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
                  <DraggableChip
                    key="item"
                    item={item}
                    label={`Lugar ${i + 1}: ${labels.get(item.token)}`}
                    px={px}
                    dense={dense}
                    selected={selected}
                    hot={isHot}
                    className={lifted ? "invisible" : undefined}
                    data-zone={z.token}
                    onClick={(e) => onChipClick(item.token, e)}
                  />
                )}
                {(!item || lifted) && (
                  <ZoneShadow
                    key="zone"
                    data-zone={z.token}
                    data-free-zone=""
                    aria-label={`Lugar ${i + 1}`}
                    // Sin ficha elegida no son paradas de Tab: al elegir, el foco llega solo
                    tabIndex={selected ? 0 : -1}
                    shape={activeItem}
                    hot={isHot}
                    hoverable={!!selected}
                    px={px}
                    dense={dense}
                    onClick={(e) => onZoneClick(z.token, e)}
                  />
                )}
              </BoardSpot>
            );
          })}
        </ImageBoard>

        <ImageBank
          groups={bank}
          labels={labels}
          px={px}
          dense={dense}
          selected={selected}
          dragging={dragging}
          canReturn={!!selected && zoneOf.has(selected)}
          onChipClick={onChipClick}
          onReturn={(e) => selected && unplace(selected, e.detail === 0)}
        />

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
      <LiveRegion live={live} />
    </div>
  );
}
