"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { Loader2, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BoardCursor,
  BoardSpot,
  IconArt,
  ImageBoard,
  ItemFace,
  relToRect,
  useCrosshair,
  useElementWidth,
} from "@/components/exam/image-board";
import { DropVeil, QUIET_ANNOUNCEMENTS, centerOnPointer, useFileDrop, useIsClient } from "@/components/exam/image-dnd";
import { EDITOR_IMAGE_ACCEPT, uploadFile } from "@/lib/upload-client";
import { plural } from "@/lib/plural";
import {
  MAX_ELEMENTS,
  MAX_LABEL,
  MAX_ZONES,
  MIN_ZONE_GAP,
  clamp01,
  fileUrl,
  freeSpot,
  iconNumbers,
  iconPx,
  imageItemName,
  readingNumbers,
  relDistance,
  round4,
  type IconSize,
  type ImageDragConfig,
  type ImageElement,
  type ImageZone,
  type Point,
} from "@/lib/image-questions";
import { elementView } from "@/lib/image-layout";
import { cn } from "@/lib/utils";

/**
 * «Arrastrar a la imagen» en el editor del maestro. A la derecha (debajo en
 * pantallas angostas) los elementos, íconos o etiquetas. Arrastrar uno a la
 * foto crea un lugar donde se suelta (también: elegirlo y hacer clic en la
 * foto, o con teclado Enter, flechas y Enter). Los lugares se arrastran para
 * moverlos y fuera de la foto para quitarlos; muestran el elemento real y el
 * número «Lugar N» que ve el alumno. Soltar un archivo sobre la foto la cambia;
 * sobre la lista, lo agrega como ícono.
 */

const DUPLICATE = "Ya está en la lista: colócalo en varios lugares";
const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** «1», «1 y 4», «1, 3 y 4». */
function joinY(list: number[]): string {
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

function newElementId(elements: ImageElement[]): string {
  const taken = new Set(elements.map((e) => e.id));
  let id = "";
  while (!id || taken.has(id)) id = `e${Math.random().toString(36).slice(2, 10)}`;
  return id;
}

/**
 * Huella del contenido de un archivo: SHA-256. Fuera de https (una IP de la
 * red local) el navegador no ofrece `crypto.subtle`: ahí basta FNV-1a, que
 * solo compara los íconos de una misma pregunta.
 */
async function fingerprint(data: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5;
  for (const byte of new Uint8Array(data)) h = Math.imul(h ^ byte, 0x01000193);
  return `fnv-${(h >>> 0).toString(16)}`;
}

/** Dos rectángulos de la pantalla se tocan. */
const intersect = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export function DragEditor({
  imageFileId,
  aspect,
  config,
  setConfig,
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
  setConfig: (fn: (c: ImageDragConfig) => ImageDragConfig) => void;
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
  const iconInput = useRef<HTMLInputElement>(null);
  /** Tamaño y huella de los íconos ya vistos (por archivo), para no subir dos veces el mismo. */
  const iconPrints = useRef(new Map<string, { size: number; hash?: string }>());
  /** Elemento elegido para colocarlo con un clic en la foto. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Lugar elegido (muestra «×» y se mueve con las flechas). */
  const [picked, setPicked] = useState<number | null>(null);
  /** Lo que va en la mano: `el:<id>` o `zone:<índice>`. */
  const [active, setActive] = useState<string | null>(null);
  /** El lugar arrastrado está fuera de la foto: al soltarlo se quita. */
  const [outside, setOutside] = useState(false);
  /** Etiqueta nueva que se escribe; null = cerrado. */
  const [label, setLabel] = useState<string | null>(null);
  /** Dos lugares (índices) que se tapan a la vista: aviso que no impide guardar. */
  const [covered, setCovered] = useState<[number, number] | null>(null);
  /** Lugares (índices) de etiquetas de texto pegadas a la orilla: aviso que no impide guardar. */
  const [edgeClipped, setEdgeClipped] = useState<number[]>([]);
  /** Puntero en pantalla durante el arrastre, y desfase entre él y el centro del lugar tomado. */
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const grab = useRef<Point>({ x: 0, y: 0 });
  const focusAfter = useRef<string | null>(null);
  const isClient = useIsClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { elements, zones } = config;
  const fullElements = elements.length >= MAX_ELEMENTS;
  const fullZones = zones.length >= MAX_ZONES;
  const px = iconPx(config.iconSize ?? "md", board.width);
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
  /** Números (Lugar N) de las etiquetas pegadas a la orilla, para el aviso. */
  const edgeNumbers = useMemo(
    () => edgeClipped.map((i) => numbers[i]).sort((a, b) => a - b),
    [edgeClipped, numbers]
  );
  const crosshair = useCrosshair(aspect, (p) => {
    if (chosen) placeAt(chosen, p, true);
    else announce("Primero elige un elemento de la lista");
  });
  const boardDrop = useFileDrop(onPhotoFile, uploading === null);
  const panelDrop = useFileDrop((file) => void addIcon(file), uploading === null && !fullElements);

  // Durante el arrastre se sigue el puntero real (en captura, antes que dnd-kit)
  useEffect(() => {
    if (!active) return;
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track, true);
    return () => window.removeEventListener("pointermove", track, true);
  }, [active]);

  // Esc cancela la elección, esté donde esté el foco
  useEffect(() => {
    if (!chosen && picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setChosen(null);
      setPicked(null);
      announce("Elección cancelada");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chosen, picked, announce]);

  // Foco tras una acción: el botón nuevo (o el que se movió) está en el siguiente render
  useEffect(() => {
    const selector = focusAfter.current;
    if (!selector) return;
    focusAfter.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  // Lugares que se tapan a la vista: íconos por distancia, etiquetas por lo que ocupan en pantalla
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || board.width === 0) return;
    const rects = new Map<number, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-zone]").forEach((el) => {
      rects.set(Number(el.dataset.zone), el.getBoundingClientRect());
    });
    const side = px / board.width;
    const find = (): [number, number] | null => {
      for (let a = 0; a < ordered.length; a++) {
        for (let b = a + 1; b < ordered.length; b++) {
          const [i, j] = [ordered[a], ordered[b]];
          const d = relDistance(zones[i], zones[j], aspect);
          // Más cerca aún: es el error «encimados» de la validación, que no deja guardar
          if (d < MIN_ZONE_GAP) continue;
          const twoIcons =
            byId.get(zones[i].elementId)?.kind === "icon" && byId.get(zones[j].elementId)?.kind === "icon";
          const [ri, rj] = [rects.get(i), rects.get(j)];
          if (twoIcons ? d < side : !!ri && !!rj && intersect(ri, rj)) return [i, j];
        }
      }
      return null;
    };
    const found = find();
    setCovered((prev) => (prev?.[0] === found?.[0] && prev?.[1] === found?.[1] ? prev : found));

    // Etiquetas de texto cuyo lugar, sin recortar, se sale del rectángulo de la foto
    const boardRect = board.node?.getBoundingClientRect();
    const clipped = boardRect
      ? ordered.filter((i) => {
          if (byId.get(zones[i].elementId)?.kind !== "text") return false;
          const r = rects.get(i);
          return !!r && (r.left < boardRect.left || r.right > boardRect.right || r.top < boardRect.top || r.bottom > boardRect.bottom);
        })
      : [];
    setEdgeClipped((prev) =>
      prev.length === clipped.length && prev.every((v, idx) => v === clipped[idx]) ? prev : clipped
    );
  }, [zones, ordered, byId, px, dense, board.width, board.node, aspect]);

  const nameOf = (id: string) => names.get(id) ?? "Elemento";
  const labelTaken = (text: string) =>
    elements.some((e) => e.kind === "text" && (e.text ?? "").trim().toLowerCase() === text.trim().toLowerCase());

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

  function moveZone(i: number, p: Point) {
    const others = zones.filter((_, j) => j !== i);
    const at = freeSpot(p, others, aspect) ?? p;
    setConfig((c) => ({ ...c, zones: c.zones.map((z, j) => (j === i ? { ...z, x: at.x, y: at.y } : z)) }));
  }

  function nudgeZone(i: number, dx: number, dy: number) {
    setConfig((c) => ({
      ...c,
      zones: c.zones.map((z, j) => (j === i ? { ...z, x: round4(clamp01(z.x + dx)), y: round4(clamp01(z.y + dy)) } : z)),
    }));
    // Si cambia su número, el botón cambia de sitio en el orden: el foco lo sigue
    focusAfter.current = `[data-zone="${i}"]`;
  }

  function removeZone(i: number, viaKeyboard: boolean) {
    setPicked(null);
    setNotice(null);
    setConfig((c) => ({ ...c, zones: c.zones.filter((_, j) => j !== i) }));
    announce(`Lugar ${numbers[i]} quitado`);
    // El botón desaparece: el foco vuelve a la foto para no perderse
    if (viaKeyboard) board.node?.focus();
  }

  function removeElement(id: string) {
    const count = zones.filter((z) => z.elementId === id).length;
    const next = listed[listed.findIndex((e) => e.id === id) + 1];
    if (chosen === id) setChosen(null);
    setPicked(null);
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

  function addLabel() {
    const text = (label ?? "").trim();
    if (!text || fullElements) return;
    // El aviso ya se ve bajo el campo; aquí solo se dice en voz alta
    if (labelTaken(text)) {
      announce(DUPLICATE);
      return;
    }
    const element: ImageElement = { id: newElementId(elements), kind: "text", text };
    setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
    setLabel("");
    setNotice(null);
    announce(`«${text}» agregado: arrástralo a la foto`);
  }

  function closeLabel() {
    setLabel(null);
    focusAfter.current = "[data-add-text]";
  }

  /** ¿Ya hay un ícono con este mismo contenido? Primero el tamaño; la huella, solo si coincide. */
  async function iconExists(file: File): Promise<boolean> {
    let mine: Promise<string> | null = null;
    const myPrint = () => (mine ??= file.arrayBuffer().then(fingerprint));
    const checks = elements.map(async (e) => {
      if (e.kind !== "icon" || !e.fileId) return false;
      let known = iconPrints.current.get(e.fileId);
      if (!known || (known.size === file.size && !known.hash)) {
        const res = await fetch(fileUrl(e.fileId)).catch(() => null);
        if (!res?.ok) return false;
        const length = res.headers.get("content-length");
        if (length !== null && Number(length) !== file.size) {
          // Otro tamaño: ni se descarga el resto
          void res.body?.cancel();
          iconPrints.current.set(e.fileId, { size: Number(length) });
          return false;
        }
        const data = await res.arrayBuffer();
        known = { size: data.byteLength, hash: await fingerprint(data) };
        iconPrints.current.set(e.fileId, known);
      }
      return known.size === file.size && known.hash === (await myPrint());
    });
    return (await Promise.all(checks)).some(Boolean);
  }

  async function addIcon(file: File) {
    if (uploading || fullElements) return;
    setError(null);
    setNotice(null);
    setUploading("icon");
    try {
      if (await iconExists(file)) {
        setNotice(DUPLICATE);
        announce(DUPLICATE);
        return;
      }
      const fileId = await uploadFile(file, "editor_image");
      iconPrints.current.set(fileId, { size: file.size, hash: await fingerprint(await file.arrayBuffer()) });
      const element: ImageElement = { id: newElementId(elements), kind: "icon", fileId };
      setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
      announce("Ícono agregado: arrástralo a la foto");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el ícono");
    } finally {
      setUploading(null);
    }
  }

  function choose(id: string, viaKeyboard: boolean) {
    setPicked(null);
    if (chosen === id) {
      setChosen(null);
      announce("Elección cancelada");
      return;
    }
    setChosen(id);
    announce(
      viaKeyboard
        ? `Elegiste ${nameOf(id)}: en la foto, mueve la mira con las flechas y pulsa Enter para colocarlo`
        : `Elegiste ${nameOf(id)}: haz clic en la foto donde va`
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
    setPicked(null);
    setOutside(false);
    const at = getEventCoordinates(e.activatorEvent) ?? { x: 0, y: 0 };
    pointer.current = at;
    // Un lugar tomado de una orilla se mueve con su centro, no salta al puntero
    const r = e.active.rect.current.initial;
    grab.current =
      id.startsWith("zone:") && r
        ? { x: r.left + r.width / 2 - at.x, y: r.top + r.height / 2 - at.y }
        : { x: 0, y: 0 };
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const p = dropPoint();
    setActive(null);
    setOutside(false);
    if (id.startsWith("zone:")) {
      const i = Number(id.slice(5));
      if (p) moveZone(i, p);
      else removeZone(i, false);
    } else if (p) {
      placeAt(id.slice(3), p, false);
    }
  }

  const activeElement = active
    ? byId.get(active.startsWith("el:") ? active.slice(3) : (zones[Number(active.slice(5))]?.elementId ?? ""))
    : undefined;
  const removing = outside && !!active?.startsWith("zone:");
  const hint = removing
    ? "Fuera de la foto: suéltalo para quitar este lugar."
    : chosen
      ? `Haz clic en la foto donde va «${nameOf(chosen)}» (Esc para cancelar).`
      : elements.length === 0
        ? "Primero agrega los íconos o etiquetas que el alumno colocará."
        : "Arrastra un elemento de la lista a la foto para marcar dónde va (o elígelo y haz clic en la foto). Arrástralo de nuevo para moverlo, o sácalo de la foto para quitarlo.";

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      accessibility={{ announcements: QUIET_ANNOUNCEMENTS }}
      onDragStart={onDragStart}
      onDragMove={() => setOutside(dropPoint() === null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setOutside(false);
      }}
    >
      <div ref={rootRef} className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 space-y-2">
          <ImageBoard
            ref={board.ref}
            imageUrl={fileUrl(imageFileId)}
            aspect={aspect}
            onPointer={(p) => {
              crosshair.setCursor(p);
              if (chosen) placeAt(chosen, p, false);
              else setPicked(null);
            }}
            tabIndex={0}
            role="application"
            aria-label="Foto: elige un elemento de la lista, mueve la mira con las flechas y pulsa Enter para colocarlo"
            onKeyDown={crosshair.onKeyDown}
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
                  zone={z}
                  element={element}
                  label={`Lugar ${numbers[i]}: ${nameOf(z.elementId)}`}
                  number={numbers[i]}
                  boardWidth={board.width}
                  iconSize={config.iconSize}
                  dense={dense}
                  picked={picked === i}
                  lifted={active === `zone:${i}`}
                  onClick={(e) => {
                    setChosen(null);
                    setPicked(picked === i ? null : i);
                    if (e.detail === 0 && picked !== i) {
                      announce(`Lugar ${numbers[i]} elegido: flechas para moverlo, Supr para quitarlo`);
                    }
                  }}
                  onRemove={(e) => removeZone(i, e.detail === 0)}
                  onKeyDown={(e) => {
                    const step = ARROW_STEPS[e.key];
                    if (step) {
                      e.preventDefault();
                      const d = e.shiftKey ? 0.05 : 0.01;
                      nudgeZone(i, step[0] * d, (step[1] * d) / aspect);
                    } else if (e.key === "Delete" || e.key === "Backspace") {
                      e.preventDefault();
                      removeZone(i, true);
                    }
                  }}
                />
              );
            })}
            <DropVeil show={boardDrop.over} text="Suelta la foto para cambiarla (los lugares se conservan)" />
          </ImageBoard>
          <p className={cn("text-xs", removing ? "font-medium text-destructive" : "text-muted-foreground")}>{hint}</p>
          {covered && numbers[covered[0]] && numbers[covered[1]] && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-warning" role="status">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              Los lugares {numbers[covered[0]]} y {numbers[covered[1]]} se tapan: al alumno le costará distinguirlos.
            </p>
          )}
          {edgeNumbers.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-warning" role="status">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              {plural(
                edgeNumbers.length,
                `La etiqueta del lugar ${edgeNumbers[0]} queda pegada a la orilla: al alumno se le puede ver cortada.`,
                `Las etiquetas de los lugares ${joinY(edgeNumbers)} quedan pegadas a la orilla: al alumno se le pueden ver cortadas.`
              )}
            </p>
          )}
        </div>

        <div className="relative space-y-2 rounded-xl" {...panelDrop.dropProps}>
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
                    chosen={chosen === element.id}
                    onChoose={(e) => choose(element.id, e.detail === 0)}
                    onRemove={() => removeElement(element.id)}
                  />
                );
              })}
            </ul>
          )}

          <input
            ref={iconInput}
            type="file"
            accept={EDITOR_IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void addIcon(file);
            }}
          />
          {label !== null ? (
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <Input
                  autoFocus
                  data-label-input=""
                  value={label}
                  maxLength={MAX_LABEL}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLabel();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      closeLabel();
                    }
                  }}
                  placeholder="Texto de la etiqueta"
                  aria-label="Texto de la etiqueta nueva"
                  className="h-9"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9 shrink-0"
                  aria-label="Cerrar sin agregar"
                  onClick={closeLabel}
                >
                  <X aria-hidden />
                </Button>
              </div>
              {label.trim() && labelTaken(label) ? (
                <p className="text-xs text-amber-700 dark:text-warning">{DUPLICATE}</p>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={!label.trim() || fullElements}
                  onClick={addLabel}
                >
                  Agregar etiqueta
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-add-icon=""
                aria-label="Agregar ícono"
                disabled={fullElements}
                // Mientras sube no se deshabilita del todo: así el foco no se pierde
                aria-disabled={uploading !== null}
                className="aria-disabled:opacity-60"
                onClick={() => uploading === null && iconInput.current?.click()}
              >
                {uploading === "icon" ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
                {uploading === "icon" ? "Subiendo…" : "Ícono"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-add-text=""
                aria-label="Agregar etiqueta de texto"
                disabled={fullElements}
                onClick={() => setLabel("")}
              >
                <Plus aria-hidden />
                Texto
              </Button>
            </div>
          )}
          {fullElements && (
            <p className="text-xs text-muted-foreground">Llegaste al máximo de {MAX_ELEMENTS} elementos.</p>
          )}
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

      {isClient &&
        // Al cuerpo del documento: un ancestro con transform movería el fantasma
        createPortal(
          <DragOverlay dropAnimation={null} modifiers={active?.startsWith("el:") ? [centerOnPointer] : undefined}>
            {activeElement ? (
              // El fantasma toma el tamaño de lo que se arrastra: la ficha va centrada en él
              <div className="flex size-full items-center justify-center">
                <span
                  className={cn(
                    "block cursor-grabbing drop-shadow-[0_12px_12px_rgb(15_23_42/0.35)] transition-opacity",
                    removing ? "opacity-40" : "-rotate-4 opacity-95"
                  )}
                >
                  <ItemFace item={elementView(activeElement, config.iconSize)} boardWidth={board.width} dense={dense} />
                </span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  );
}

/** Un elemento de la lista: se arrastra a la foto, o se elige y luego clic en la foto. */
function ElementRow({
  element,
  name,
  places,
  started,
  chosen,
  onChoose,
  onRemove,
}: {
  element: ImageElement;
  name: string;
  /** Números de los lugares donde va, en orden. */
  places: number[];
  /** Ya hay algo en la foto: lo que no tiene lugar es un distractor, no algo pendiente. */
  started: boolean;
  chosen: boolean;
  onChoose: (e: React.MouseEvent) => void;
  onRemove: () => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `el:${element.id}` });
  const n = places.length;
  const distractor = started && n === 0;
  const status =
    n > 0
      ? `Va en ${n} ${plural(n, "lugar", "lugares")} (${joinY(places)})`
      : distractor
        ? "Sin lugar: distractor"
        : "Arrástralo a la foto";
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-xl border p-1 transition-colors",
        distractor && "border-warning/40 bg-warning/10",
        chosen && "border-primary ring-2 ring-primary/30",
        isDragging && "opacity-60"
      )}
    >
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        data-element={element.id}
        onClick={onChoose}
        aria-pressed={chosen}
        aria-label={`${name}: ${status}`}
        title="Arrástralo a la foto, o haz clic aquí y después en la foto"
        className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg p-0.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-primary/40 active:cursor-grabbing"
      >
        {element.kind === "icon" ? (
          <IconArt fileId={element.fileId} w={34} h={34} className="shrink-0" />
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
        variant="ghost"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Quitar ${name}${n > 0 ? ` y ${plural(n, "su lugar", "sus lugares")}` : ""}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

/** Un lugar en la foto: el elemento real (el maestro sí ve la solución) con su número. */
function PlacedZone({
  index,
  zone,
  element,
  label,
  number,
  boardWidth,
  iconSize,
  dense,
  picked,
  lifted,
  onClick,
  onRemove,
  onKeyDown,
}: {
  index: number;
  zone: ImageZone;
  element: ImageElement;
  label: string;
  number: number;
  boardWidth: number;
  iconSize?: IconSize;
  dense: boolean;
  picked: boolean;
  /** Va en la mano: se ve el fantasma, y el botón sigue montado (invisible) para no cortar el arrastre. */
  lifted: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: `zone:${index}` });
  return (
    <BoardSpot x={zone.x} y={zone.y} className={cn(picked ? "z-20" : "z-10", lifted && "invisible")}>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        data-zone={index}
        onClick={onClick}
        onKeyDown={onKeyDown}
        aria-label={label}
        aria-pressed={picked}
        title="Arrástralo para moverlo, o fuera de la foto para quitarlo"
        className={cn(
          "relative block cursor-grab touch-none outline-none active:cursor-grabbing",
          "focus-visible:ring-4 focus-visible:ring-primary/40",
          element.kind === "icon" ? "rounded-[12px]" : "rounded-full",
          picked && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        <ItemFace item={elementView(element, iconSize)} boardWidth={boardWidth} dense={dense} />
        <span
          aria-hidden
          className="absolute -right-2 -top-2 flex size-[18px] items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground ring-2 ring-white"
        >
          {number}
        </span>
      </button>
      {picked && (
        <button
          type="button"
          aria-label={`Quitar el lugar ${number}`}
          title="Quitar este lugar"
          onClick={onRemove}
          className="absolute -left-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow ring-2 ring-white outline-none hover:bg-destructive/90 focus-visible:ring-4 focus-visible:ring-destructive/40"
        >
          <X className="size-3" strokeWidth={3} aria-hidden />
        </button>
      )}
    </BoardSpot>
  );
}
