"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { TriangleAlert } from "lucide-react";
import { BoardCursor, relToRect, useCrosshair, useElementWidth } from "@/components/exam/image-board";
import { DropVeil, QUIET_ANNOUNCEMENTS, useFileDrop } from "@/components/exam/image-dnd";
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
import { ImageCanvas } from "./image-canvas";
import { ElementAdder } from "./image-element-adder";
import { ElementPanel } from "./image-element-panel";
import { ElementRow } from "./image-element-row";
import { DragGhost, PlacedZone } from "./image-placed-zone";
import { useDragSelection } from "./use-drag-selection";
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
  /** Lo que va en la mano: `el:<id>` o `zone:<índice>`. */
  const [active, setActive] = useState<string | null>(null);
  /** El lugar arrastrado está fuera de la foto: al soltarlo se quita. */
  const [outside, setOutside] = useState(false);
  /** Puntero en pantalla durante el arrastre, y desfase entre él y el centro del lugar tomado. */
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const grab = useRef<Point>({ x: 0, y: 0 });
  const focusAfter = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { elements, zones } = config;
  const fullElements = elements.length >= MAX_ELEMENTS;
  const fullZones = zones.length >= MAX_ZONES;
  const dense = board.width > 0 && board.width < 480;
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
  });
  const { selected, clear: clearSelection } = selection;
  const iconTools = useEditorIcons({ elements, uploading, setUploading, setError, setNotice, announce, setConfig, nameOf });
  const crosshair = useCrosshair(aspect, (p) => {
    if (chosen) placeAt(chosen, p, true);
    else announce("Primero pulsa «Colocar» en un elemento de la lista");
  });
  const boardDrop = useFileDrop(onPhotoFile, uploading === null);
  const panelDrop = useFileDrop((file) => void iconTools.addIcon(file), uploading === null && !fullElements);

  // Durante el arrastre se sigue el puntero real (en captura, antes que dnd-kit)
  useEffect(() => {
    if (!active) return;
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track, true);
    return () => window.removeEventListener("pointermove", track, true);
  }, [active]);

  // Esc suelta lo elegido y lo seleccionado, esté donde esté el foco, salvo en
  // un campo (el del panel, con Esc, solo deshace lo escrito) o si ya lo
  // atendió un diálogo
  const hasSelection = selected.size > 0;
  useEffect(() => {
    if (!chosen && !hasSelection && !panelId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      setChosen(null);
      setPanelId(null);
      clearSelection();
      announce("Elección cancelada");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chosen, hasSelection, panelId, clearSelection, announce]);

  // Foco tras una acción: el botón nuevo (o el que se movió) está en el siguiente render
  useEffect(() => {
    const selector = focusAfter.current;
    if (!selector) return;
    focusAfter.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  function placeAt(elementId: string, p: Point, viaKeyboard: boolean) {
    setChosen(null);
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

  /** Un lugar solo, soltado en `p`: si cae encima de otro, se corre lo justo. */
  function moveZone(i: number, p: Point) {
    const others = zones.filter((_, j) => j !== i);
    const at = freeSpot(p, others, aspect) ?? p;
    setConfig((c) => ({ ...c, zones: c.zones.map((z, j) => (j === i ? { ...z, x: at.x, y: at.y } : z)) }));
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

  /** Dónde quedaría lo que va en la mano; null si está fuera de la foto. */
  function dropPoint(): Point | null {
    const node = board.node;
    if (!node) return null;
    const p = relToRect(
      pointer.current.x + grab.current.x,
      pointer.current.y + grab.current.y,
      node.getBoundingClientRect()
    );
    return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? { x: round4(p.x), y: round4(p.y) } : null;
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActive(id);
    setChosen(null);
    setOutside(false);
    const at = getEventCoordinates(e.activatorEvent) ?? { x: 0, y: 0 };
    pointer.current = at;
    // Un lugar tomado de una orilla se mueve con su centro, no salta al puntero
    const r = e.active.rect.current.initial;
    grab.current =
      id.startsWith("zone:") && r
        ? { x: r.left + r.width / 2 - at.x, y: r.top + r.height / 2 - at.y }
        : { x: 0, y: 0 };
    // Un lugar seleccionado con otros se lleva al grupo; si no, pasa a ser lo seleccionado
    if (id.startsWith("zone:")) selection.startDrag(Number(id.slice(5)));
    else clearSelection();
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const p = dropPoint();
    setActive(null);
    setOutside(false);
    if (selection.dropGroup(e.delta, board.node?.getBoundingClientRect())) return;
    if (id.startsWith("zone:")) {
      const i = Number(id.slice(5));
      if (p) moveZone(i, p);
      else selection.remove([i], false);
    } else if (p) {
      placeAt(id.slice(3), p, false);
    }
  }

  const grouped = selection.groupDragging;
  const activeElement =
    active && !grouped
      ? byId.get(active.startsWith("el:") ? active.slice(3) : (zones[Number(active.slice(5))]?.elementId ?? ""))
      : undefined;
  const removing = outside && !grouped && !!active?.startsWith("zone:");
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
  const hint = removing
    ? "Fuera de la foto: suéltalo para quitar este lugar."
    : chosen
      ? `Haz clic en la foto donde va «${nameOf(chosen)}» (Esc para cancelar).`
      : elements.length === 0
        ? "Primero agrega los íconos o etiquetas que el alumno colocará."
        : selected.size > 1
          ? `${selected.size} lugares seleccionados: arrástralos juntos o muévelos con las flechas (Mayús: pasos largos). Ctrl+D los duplica, Supr los quita y Esc suelta la selección.`
          : "Arrastra un elemento de la lista a la foto para marcar dónde va (o pulsa su botón «Colocar», la mira, y haz clic en la foto). Clic en un lugar lo selecciona; Mayús+clic o un recuadro sobre la foto seleccionan varios. Arrástralos o usa las flechas para moverlos; Ctrl+D duplica, Supr quita (o saca un lugar de la foto) y Ctrl+Z deshace.";

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      accessibility={{ announcements: QUIET_ANNOUNCEMENTS }}
      onDragStart={onDragStart}
      onDragMove={(e) => {
        const rect = board.node?.getBoundingClientRect();
        if (!(rect && selection.dragGroup(e.delta, rect))) setOutside(dropPoint() === null);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setOutside(false);
        selection.cancelDrag();
      }}
    >
      <div ref={rootRef} onKeyDown={selection.onKeyDown} className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_15rem]">
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
                  onClick={(e) => selection.click(i, e.shiftKey, e.detail === 0)}
                  onRemove={(e) => selection.remove([i], e.detail === 0)}
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
              onChange={(patch) => panelElement && changeElement(panelElement.id, patch)}
              onBegin={gesture.begin}
              onCommit={gesture.commit}
            />
          )}
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Elementos</p>
          {listed.length > 0 && (
            <ul className="space-y-1.5" aria-label="Elementos">
              {listed.map((element) => {
                const places = zones
                  .map((z, i) => (z.elementId === element.id ? numbers[i] : 0))
                  .filter(Boolean)
                  .sort((a, b) => a - b);
                return (
                  <ElementRow
                    key={element.id}
                    element={element}
                    name={nameOf(element.id)}
                    places={places}
                    started={zones.length > 0}
                    selected={panelElement?.id === element.id}
                    placing={chosen === element.id}
                    margin={iconTools.hasMargin(element)}
                    trimming={iconTools.trimming === element.id}
                    busy={uploading !== null}
                    onSelect={(e) => select(element.id, e.detail === 0)}
                    onPlace={(e) => startPlacing(element.id, e.detail === 0)}
                    onTrim={() => void iconTools.trimIcon(element.id)}
                    onRemove={() => removeElement(element.id)}
                  />
                );
              })}
            </ul>
          )}

          <ElementAdder
            elements={elements}
            uploading={uploading}
            announce={announce}
            onIconFile={(file) => void iconTools.addIcon(file)}
            onAddLabel={addLabel}
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
        element={activeElement}
        fromList={!!active?.startsWith("el:")}
        removing={removing}
        boardWidth={board.width}
        dense={dense}
      />
    </DndContext>
  );
}
