"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { TriangleAlert } from "lucide-react";
import { BoardCursor, useCrosshair, useElementWidth } from "@/components/exam/image-board";
import { DropVeil, QUIET_ANNOUNCEMENTS, useFileDrop, useStableHandler } from "@/components/exam/image-dnd";
import { useMediaQuery } from "@/components/help/use-media-query";
import { plural } from "@/lib/plural";
import {
  MAX_ELEMENTS,
  MAX_ZONES,
  fileUrl,
  freeSpot,
  iconNumbers,
  imageItemName,
  readingNumbers,
  round4,
  type ImageDragConfig,
  type ImageElement,
  type Point,
} from "@/lib/image-questions";
import { DEFAULT_TEXT_SIZE } from "@/lib/image-layout";
import { cn } from "@/lib/utils";
import { dragEditorHint } from "./drag-editor-hint";
import { ImageCanvas } from "./image-canvas";
import { ElementAdder } from "./image-element-adder";
import { ElementPanel } from "./image-element-panel";
import { ElementList } from "./image-element-row";
import { DragGhost, PlacedZone } from "./image-placed-zone";
import { useDragSelection } from "./use-drag-selection";
import { useEditorDrag } from "./use-editor-drag";
import { isTypingTarget, type HistoryOptions } from "./use-editor-history";
import { newElementId, useEditorIcons } from "./use-editor-icons";
import { useZoneWarnings } from "./use-zone-warnings";

/**
 * «Arrastrar a la imagen» en el editor del maestro. A la derecha (debajo en
 * pantallas angostas) los elementos, íconos o etiquetas. Arrastrar uno a la
 * foto crea un lugar donde se suelta (también: su botón «Colocar» y un clic en
 * la foto, o con teclado Enter, flechas y Enter). Los lugares muestran el
 * elemento real y el número «Lugar N» que ve el alumno; se seleccionan con un
 * clic (Mayús+clic suma, arrastrar sobre la foto hace un recuadro, Ctrl+A
 * todos, Espacio sobre uno lo suma) y lo seleccionado se arrastra junto, se
 * mueve con las flechas, se duplica (Ctrl+D) o se quita (Supr). Un lugar solo
 * se quita también sacándolo de la foto. Todo cambio pasa por el historial del
 * editor (deshacer). Soltar un archivo sobre la foto la cambia; sobre la
 * lista, lo agrega como ícono. Un clic en un elemento de la lista o en lugares
 * de un solo elemento lo lleva al panel «Seleccionado» (tamaño y giro).
 */
export function DragEditor({
  imageFileId,
  aspect,
  config,
  setConfig,
  gesture,
  uploading,
  setUploading,
  setError,
  setNotice,
  announce,
  onPhotoFile,
}: {
  imageFileId: string;
  /** Alto / ancho de la foto (una cualquiera mientras se mide). */
  aspect: number;
  config: ImageDragConfig;
  /** Cambia la config (un paso del historial) y devuelve la nueva. */
  setConfig: (fn: (c: ImageDragConfig) => ImageDragConfig, options?: HistoryOptions) => ImageDragConfig;
  /** Un gesto (arrastrar un deslizante del panel) es un solo paso del historial. */
  gesture: { begin: () => void; commit: () => void };
  uploading: "photo" | "icon" | null;
  setUploading: (u: "photo" | "icon" | null) => void;
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  /** Un archivo soltado sobre la foto la cambia. */
  onPhotoFile: (file: File) => void;
}) {
  const board = useElementWidth<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  /** Elemento elegido para colocarlo con un clic en la foto (su botón «Colocar»). */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Elemento elegido en la lista para cambiar su tamaño y giro: no coloca nada. */
  const [panelId, setPanelId] = useState<string | null>(null);
  const focusAfter = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { elements, zones } = config;
  const fullElements = elements.length >= MAX_ELEMENTS;
  const fullZones = zones.length >= MAX_ZONES;
  const dense = board.width > 0 && board.width < 480;
  /** Puntero táctil: la pista no habla de teclas. */
  const touch = useMediaQuery("(pointer: coarse)");
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const icons = useMemo(() => iconNumbers(elements.map((e) => e.fileId)), [elements]);
  const names = useMemo(() => new Map(elements.map((e) => [e.id, imageItemName(e, icons)])), [elements, icons]);
  // En la lista, los íconos por su número (el que oye el alumno) y después las etiquetas
  const listed = useMemo(
    () => [
      ...elements
        .filter((e) => e.kind === "icon")
        .sort((a, b) => (icons.get(a.fileId ?? "") ?? 0) - (icons.get(b.fileId ?? "") ?? 0)),
      ...elements.filter((e) => e.kind === "text"),
    ],
    [elements, icons]
  );
  const numbers = useMemo(() => readingNumbers(zones, aspect), [zones, aspect]);
  /** Índices de los lugares en orden de lectura: el orden de Tab. */
  const ordered = useMemo(() => zones.map((_, i) => i).sort((a, b) => numbers[a] - numbers[b]), [zones, numbers]);
  /** Números de los lugares de cada elemento, en orden (para su fila). */
  const placesOf = useMemo(() => {
    const out = new Map<string, number[]>();
    zones.forEach((z, i) => out.set(z.elementId, [...(out.get(z.elementId) ?? []), numbers[i]].sort((a, b) => a - b)));
    return out;
  }, [zones, numbers]);
  const nameOf = (id: string) => names.get(id) ?? "Elemento";
  const warnings = useZoneWarnings({
    rootRef,
    boardNode: board.node,
    boardWidth: board.width,
    zones,
    ordered,
    numbers,
    byId,
    aspect,
    dense,
  });
  const selection = useDragSelection({
    zones,
    aspect,
    numbers,
    setConfig,
    setNotice,
    announce,
    boardNode: board.node,
    focusAfter,
    onSelectZones: () => {
      setChosen(null);
      setPanelId(null);
    },
    endRun: gesture.commit,
  });
  const { selected, clear: clearSelection } = selection;
  const iconTools = useEditorIcons({ elements, uploading, setUploading, setError, setNotice, announce, setConfig, nameOf });
  const crosshair = useCrosshair(aspect, (p) => {
    if (chosen) placeAt(chosen, p, true);
    else announce("Primero pulsa «Colocar» en un elemento de la lista");
  });
  const boardDrop = useFileDrop(onPhotoFile, uploading === null);
  const panelDrop = useFileDrop((file) => void iconTools.addIcon(file), uploading === null && !fullElements);

  // Esc suelta lo elegido y lo seleccionado, esté donde esté el foco, salvo en
  // un campo (el del panel, con Esc, solo deshace lo escrito) o si ya lo
  // atendió un diálogo
  const hasSelection = selected.size > 0;
  useEffect(() => {
    if (!chosen && !hasSelection && !panelId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      const root = rootRef.current;
      const hadFocus = !!root?.contains(document.activeElement);
      setChosen(null);
      setPanelId(null);
      clearSelection();
      announce("Elección cancelada");
      // Si lo enfocado desaparece (el deslizante del panel), el foco va a la foto y Ctrl+Z sigue a mano
      requestAnimationFrame(() => {
        if (hadFocus && !root?.contains(document.activeElement)) board.node?.focus({ preventScroll: true });
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chosen, hasSelection, panelId, clearSelection, announce, board.node]);

  // Tras deshacer, lo elegido (para colocar o en el panel) puede ya no existir
  useEffect(() => {
    if (chosen && !byId.has(chosen)) setChosen(null);
    if (panelId && !byId.has(panelId)) setPanelId(null);
  }, [byId, chosen, panelId]);

  // Foco tras una acción: el botón nuevo (o el que se movió) está en el siguiente render
  useEffect(() => {
    const selector = focusAfter.current;
    if (!selector) return;
    focusAfter.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  function placeAt(elementId: string, p: Point, viaKeyboard: boolean) {
    setChosen(null);
    // Un elemento que ya no está (se deshizo su alta) no deja un lugar sin nada
    if (!byId.has(elementId)) return;
    if (fullZones) {
      const text = `Ya hay ${MAX_ZONES} lugares, el máximo: quita uno para agregar otro.`;
      setNotice(text);
      announce(text);
      return;
    }
    // La mira del teclado acumula decimales; encima de otro lugar no: se corre lo justo
    const dropped = { x: round4(p.x), y: round4(p.y) };
    const at = freeSpot(dropped, zones, aspect) ?? dropped;
    const zone = { x: at.x, y: at.y, elementId };
    setConfig((c) => (c.zones.length >= MAX_ZONES ? c : { ...c, zones: [...c.zones, zone] }));
    setNotice(null);
    const n = readingNumbers([...zones, zone], aspect)[zones.length];
    announce(`${nameOf(elementId)} en el lugar ${n}${at !== dropped ? ", corrido un poco para no encimarse" : ""}`);
    if (viaKeyboard) focusAfter.current = `[data-zone="${zones.length}"]`;
  }

  function removeElement(id: string) {
    const count = zones.filter((z) => z.elementId === id).length;
    const next = listed[listed.findIndex((e) => e.id === id) + 1];
    if (chosen === id) setChosen(null);
    if (panelId === id) setPanelId(null);
    clearSelection();
    setNotice(null);
    setConfig((c) => ({
      ...c,
      elements: c.elements.filter((e) => e.id !== id),
      zones: c.zones.filter((z) => z.elementId !== id),
    }));
    announce(`${nameOf(id)} quitado${count ? ` junto con ${plural(count, "su lugar", `sus ${count} lugares`)}` : ""}`);
    // El foco pasa a la fila siguiente o, si era la última, a agregar
    focusAfter.current = next ? `[data-element="${next.id}"]` : "[data-add-icon], [data-label-input]";
  }

  function addLabel(text: string) {
    const element: ImageElement = { id: newElementId(elements), kind: "text", text, size: DEFAULT_TEXT_SIZE };
    setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
    setNotice(null);
    announce(`«${text}» agregado: arrástralo a la foto`);
  }

  /** Un clic en la fila: el elemento va al panel «Seleccionado». No coloca nada. */
  function select(id: string, viaKeyboard: boolean) {
    setChosen(null);
    clearSelection();
    if (panelId === id) {
      setPanelId(null);
      announce("Elección cancelada");
      return;
    }
    setPanelId(id);
    if (viaKeyboard) announce(`${nameOf(id)} elegido: cambia su tamaño y su giro en «Seleccionado»`);
  }

  /** «Colocar»: el siguiente clic en la foto (o Enter con la mira) pone ahí un lugar suyo. */
  function startPlacing(id: string, viaKeyboard: boolean) {
    clearSelection();
    if (chosen === id) {
      setChosen(null);
      announce("Elección cancelada");
      return;
    }
    setChosen(id);
    setPanelId(id);
    announce(
      viaKeyboard
        ? `Colocar ${nameOf(id)}: en la foto, mueve la mira con las flechas y pulsa Enter`
        : `Colocar ${nameOf(id)}: haz clic en la foto donde va`
    );
    if (viaKeyboard) board.node?.focus();
  }

  const drag = useEditorDrag({
    boardNode: board.node,
    zones,
    aspect,
    byId,
    setConfig,
    selection,
    onStart: () => setChosen(null),
    onPlace: (elementId, p) => placeAt(elementId, p, false),
  });
  const { active, grouped, removing } = drag;
  /** Elementos de los lugares seleccionados. */
  const selectedIds = new Set([...selected].map((i) => zones[i]?.elementId));
  /** El elemento del panel «Seleccionado»: el elegido en la lista o el de los lugares seleccionados (si es uno solo). */
  const panelElement =
    (panelId ? byId.get(panelId) : selectedIds.size === 1 ? byId.get([...selectedIds][0] ?? "") : undefined) ?? null;
  const several = !panelElement && selectedIds.size > 1 ? selected.size : undefined;

  /** Tamaño o giro de un elemento: lo toman todos sus lugares. Escribir o pulsar seguido es un solo paso. */
  function changeElement(id: string, patch: Pick<ImageElement, "size" | "rotation">) {
    setConfig((c) => ({ ...c, elements: c.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), {
      coalesce: `elemento:${id}:${Object.keys(patch).join(",")}`,
    });
  }
  const hint = dragEditorHint({
    removing,
    placing: chosen && nameOf(chosen),
    empty: elements.length === 0,
    selectedCount: selected.size,
    touch,
  });
  // Acciones fijas para las piezas memorizadas: mover un grupo no vuelve a pintar la lista ni los demás lugares
  const onZoneClick = useStableHandler((i: number, e: React.MouseEvent) => selection.click(i, e.shiftKey, e.detail === 0));
  const onZoneRemove = useStableHandler((i: number, e: React.MouseEvent) => selection.remove([i], e.detail === 0));
  const rowActions = {
    onSelect: useStableHandler((id: string, e: React.MouseEvent) => select(id, e.detail === 0)),
    onPlace: useStableHandler((id: string, e: React.MouseEvent) => startPlacing(id, e.detail === 0)),
    onTrim: useStableHandler((id: string) => void iconTools.trimIcon(id)),
    onRemove: useStableHandler(removeElement),
  };
  const onPanelChange = useStableHandler(
    (patch: Pick<ImageElement, "size" | "rotation">) => panelElement && changeElement(panelElement.id, patch)
  );
  const onIconFile = useStableHandler((file: File) => void iconTools.addIcon(file));
  const onAddLabel = useStableHandler(addLabel);

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      accessibility={{ announcements: QUIET_ANNOUNCEMENTS }}
      {...drag.handlers}
    >
      <div
        ref={rootRef}
        // Un clic en un hueco deja aquí el foco: los atajos (Ctrl+A, Ctrl+D, Supr, Ctrl+Z) siguen a mano
        tabIndex={-1}
        role="group"
        aria-label="Lugares en la foto y elementos"
        data-drag-editor=""
        onKeyDown={selection.onKeyDown}
        onKeyUp={selection.onKeyUp}
        className="grid gap-4 outline-none @2xl:grid-cols-[minmax(0,1fr)_15rem]"
      >
        <div className="min-w-0 space-y-2">
          <ImageCanvas
            ref={board.ref}
            imageUrl={fileUrl(imageFileId)}
            aspect={aspect}
            onPointer={(p, e) => {
              crosshair.setCursor(p);
              // Solo con «Colocar» un clic crea un lugar; si no, suelta lo elegido (con Mayús, lo conserva)
              if (chosen) placeAt(chosen, p, false);
              else if (!e.shiftKey) {
                clearSelection();
                setPanelId(null);
              }
            }}
            onMarquee={
              chosen
                ? undefined
                : (area, additive) => {
                    setPanelId(null);
                    selection.selectArea(area, additive);
                  }
            }
            tabIndex={0}
            role="application"
            aria-label="Foto: para colocar, pulsa «Colocar» en un elemento de la lista, mueve la mira con las flechas y pulsa Enter. Con lugares seleccionados, las flechas los mueven y Supr los quita"
            onKeyDown={(e) => {
              // Con lugares seleccionados, las flechas los mueven; si no, mueven la mira
              if (!chosen) selection.onKeyDown(e);
              if (!e.defaultPrevented) crosshair.onKeyDown(e);
            }}
            {...boardDrop.dropProps}
            className={cn(
              "group outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
              chosen && "cursor-crosshair",
              active?.startsWith("el:") && "ring-2 ring-primary",
              removing && "ring-2 ring-destructive"
            )}
          >
            <BoardCursor x={crosshair.cursor.x} y={crosshair.cursor.y} />
            {ordered.map((i) => {
              const z = zones[i];
              const element = byId.get(z.elementId);
              if (!element) return null;
              return (
                <PlacedZone
                  key={i}
                  index={i}
                  at={selection.at(i)}
                  element={element}
                  label={`Lugar ${numbers[i]}: ${nameOf(z.elementId)}`}
                  number={numbers[i]}
                  boardWidth={board.width}
                  dense={dense}
                  selected={selected.has(i)}
                  removable={selected.size === 1 && selected.has(i) && !active}
                  lifted={active === `zone:${i}` && !grouped}
                  onClick={onZoneClick}
                  onRemove={onZoneRemove}
                />
              );
            })}
            <DropVeil show={boardDrop.over} text="Suelta la foto para cambiarla (los lugares se conservan)" />
          </ImageCanvas>
          <p className={cn("text-xs", removing ? "font-medium text-destructive" : "text-muted-foreground")}>{hint}</p>
          {[warnings.covered, warnings.edge].map(
            (text) =>
              text && (
                <p key={text} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-warning" role="status">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  {text}
                </p>
              )
          )}
        </div>

        <div className="relative space-y-2 rounded-xl" {...panelDrop.dropProps}>
          {elements.length > 0 && (
            <ElementPanel
              element={panelElement}
              name={panelElement ? nameOf(panelElement.id) : ""}
              several={several}
              aspect={aspect}
              boardWidth={board.width}
              onChange={onPanelChange}
              onBegin={gesture.begin}
              onCommit={gesture.commit}
            />
          )}
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Elementos</p>
          <ElementList
            listed={listed}
            names={names}
            places={placesOf}
            started={zones.length > 0}
            selectedId={panelElement?.id}
            placingId={chosen}
            withMargin={iconTools.withMargin}
            trimmingId={iconTools.trimming}
            busy={uploading !== null}
            {...rowActions}
          />

          <ElementAdder
            elements={elements}
            uploading={uploading}
            announce={announce}
            onIconFile={onIconFile}
            onAddLabel={onAddLabel}
          />
          {zones.length > 0 && (
            <p className="rounded-lg bg-muted/60 p-2 text-xs leading-relaxed text-muted-foreground">
              <b className="font-semibold text-foreground">Puntos:</b> cada lugar bien puesto vale lo mismo.{" "}
              {zones.length === 1
                ? "Con un solo lugar, vale la pregunta completa."
                : `Con ${zones.length} lugares, cada uno vale 1/${zones.length} de la pregunta.`}
              {fullZones && ` Llegaste al máximo de ${MAX_ZONES} lugares.`}
            </p>
          )}
          <DropVeil show={panelDrop.over} text="Suelta la imagen para agregarla como ícono" />
        </div>
      </div>

      <DragGhost
        element={drag.ghost}
        fromList={!!active?.startsWith("el:")}
        removing={removing}
        boardWidth={board.width}
        dense={dense}
      />
    </DndContext>
  );
}
