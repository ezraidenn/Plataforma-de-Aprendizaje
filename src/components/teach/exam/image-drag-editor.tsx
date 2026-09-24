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
import { Crop, Crosshair, Loader2, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BoardCursor,
  BoardSpot,
  ImageBoard,
  relToRect,
  useCrosshair,
  useElementWidth,
} from "@/components/exam/image-board";
import { IconArt, ItemFace } from "@/components/exam/image-pieces";
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
  imageItemName,
  readingNumbers,
  relDistance,
  round4,
  type ImageDragConfig,
  type ImageElement,
  type ImageZone,
  type Point,
} from "@/lib/image-questions";
import {
  DEFAULT_ICON_SIZE,
  DEFAULT_TEXT_SIZE,
  boxBounds,
  boxesOverlap,
  elementBox,
  elementRatio,
  elementView,
  type Box,
} from "@/lib/image-layout";
import { prepareIcon, type PreparedIcon } from "@/lib/image-processing";
import { cn } from "@/lib/utils";
import { ElementPanel } from "./image-element-panel";
import { rememberInspection, useIconInspection } from "./use-icon-inspection";

/**
 * «Arrastrar a la imagen» en el editor del maestro. A la derecha (debajo en
 * pantallas angostas) los elementos, íconos o etiquetas. Arrastrar uno a la
 * foto crea un lugar donde se suelta (también: elegirlo y hacer clic en la
 * foto, o con teclado Enter, flechas y Enter). Los lugares se arrastran para
 * moverlos y fuera de la foto para quitarlos; muestran el elemento real y el
 * número «Lugar N» que ve el alumno. Soltar un archivo sobre la foto la cambia;
 * sobre la lista, lo agrega como ícono (sin sus márgenes transparentes). Un
 * clic en un elemento de la lista o en un lugar lo elige para el panel
 * «Seleccionado» (tamaño y giro), sin colocar nada; para colocar con clics está
 * el botón «Colocar» de cada fila. A un ícono subido antes del recorte se le
 * puede quitar el margen desde su fila.
 */

const DUPLICATE = "Ya está en la lista: colócalo en varios lugares";
const UNREADABLE = "No se pudo leer la imagen: usa un ícono PNG, JPG, WEBP o GIF.";
const EMPTY_ICON = "Ese ícono está vacío (todo transparente): elige otra imagen.";
const NO_MARGIN = "Ese ícono ya no tiene margen.";
const SAME_TRIMMED = "Ya hay en la lista un ícono igual sin margen: deja uno y colócalo en varios lugares.";
/** Lado de la miniatura de un elemento en la lista (px; el mismo de `size-[34px]`). */
const THUMB_PX = 34;
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

/** Aviso de lugares que se salen por la orilla, según lo que haya en ellos. */
function edgeWarning(numbers: number[], kinds: Set<string | undefined>): string {
  const one = numbers.length === 1;
  const places = one ? `del lugar ${numbers[0]}` : `de los lugares ${joinY(numbers)}`;
  if (kinds.size === 1 && kinds.has("text")) {
    return one
      ? `La etiqueta ${places} queda pegada a la orilla: al alumno se le puede ver cortada.`
      : `Las etiquetas ${places} quedan pegadas a la orilla: al alumno se le pueden ver cortadas.`;
  }
  if (kinds.size === 1 && kinds.has("icon")) {
    return one
      ? `El ícono ${places} queda pegado a la orilla: al alumno se le puede ver cortado.`
      : `Los íconos ${places} quedan pegados a la orilla: al alumno se le pueden ver cortados.`;
  }
  return `Los lugares ${joinY(numbers)} quedan pegados a la orilla: al alumno se le pueden ver cortados.`;
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

/** Un archivo por comparar: su tamaño y su huella (calculada una sola vez, y solo si hace falta). */
type Candidate = { size: number; print: () => Promise<string> };
function candidate(blob: Blob): Candidate {
  let print: Promise<string> | null = null;
  return { size: blob.size, print: () => (print ??= blob.arrayBuffer().then(fingerprint)) };
}

/** El ícono ya recortado; si el navegador no lo puede leer, el error real va a la consola y el amable, arriba. */
function prepare(file: File): Promise<PreparedIcon | null> {
  return prepareIcon(file).catch((err: unknown) => {
    console.error("No se pudo preparar el ícono:", err);
    throw new Error(UNREADABLE);
  });
}

/** El Blob preparado como archivo para subirlo, con su nombre y su tipo. */
const asFile = (icon: PreparedIcon) => new File([icon.blob], icon.name, { type: icon.blob.type });

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
  /** Elemento elegido para colocarlo con un clic en la foto (su botón «Colocar»). */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Elemento elegido en la lista para cambiar su tamaño y giro: no coloca nada. */
  const [panelId, setPanelId] = useState<string | null>(null);
  /** Lugar elegido (muestra «×» y se mueve con las flechas). */
  const [picked, setPicked] = useState<number | null>(null);
  /** Lo que va en la mano: `el:<id>` o `zone:<índice>`. */
  const [active, setActive] = useState<string | null>(null);
  /** El lugar arrastrado está fuera de la foto: al soltarlo se quita. */
  const [outside, setOutside] = useState(false);
  /** Ícono al que se le está quitando el margen. */
  const [trimming, setTrimming] = useState<string | null>(null);
  /** Etiqueta nueva que se escribe; null = cerrado. */
  const [label, setLabel] = useState<string | null>(null);
  /** Dos lugares (índices) que se tapan a la vista: aviso que no impide guardar. */
  const [covered, setCovered] = useState<[number, number] | null>(null);
  /** Lugares (índices) que se salen por la orilla de la foto: aviso que no impide guardar. */
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
  /** Números (Lugar N) de los lugares pegados a la orilla, para el aviso. */
  const edgeNumbers = useMemo(
    () => edgeClipped.map((i) => numbers[i]).sort((a, b) => a - b),
    [edgeClipped, numbers]
  );
  /** Qué hay en los lugares pegados a la orilla: solo etiquetas, solo íconos o de todo. */
  const edgeKinds = new Set(edgeClipped.map((i) => byId.get(zones[i]?.elementId ?? "")?.kind));
  /** Proporción y margen de cada archivo de ícono (para los subidos antes del recorte). */
  const inspected = useIconInspection(elements.flatMap((e) => (e.kind === "icon" && e.fileId ? [e.fileId] : [])));
  const crosshair = useCrosshair(aspect, (p) => {
    if (chosen) placeAt(chosen, p, true);
    else announce("Primero pulsa «Colocar» en un elemento de la lista");
  });
  const boardDrop = useFileDrop(onPhotoFile, uploading === null);
  const panelDrop = useFileDrop((file) => void addIcon(file), uploading === null && !fullElements);

  // Íconos subidos antes del recorte (sin proporción): toman la de su archivo y
  // su caja pasa a ser la del dibujo. Se ven igual: su tamaño es el lado mayor
  useEffect(() => {
    const pending = elements.some((e) => e.kind === "icon" && e.ratio === undefined && !!e.fileId && inspected.has(e.fileId));
    if (!pending) return;
    setConfig((c) => ({
      ...c,
      elements: c.elements.map((e) => {
        const info = e.kind === "icon" && e.ratio === undefined && e.fileId ? inspected.get(e.fileId) : undefined;
        return info ? { ...e, ratio: info.ratio } : e;
      }),
    }));
  }, [elements, inspected, setConfig]);

  // Durante el arrastre se sigue el puntero real (en captura, antes que dnd-kit)
  useEffect(() => {
    if (!active) return;
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track, true);
    return () => window.removeEventListener("pointermove", track, true);
  }, [active]);

  // Esc cancela la elección, esté donde esté el foco (salvo que ya lo atendió un
  // campo, como el del panel, que con Esc solo deshace lo escrito)
  useEffect(() => {
    if (!chosen && picked === null && !panelId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setChosen(null);
      setPicked(null);
      setPanelId(null);
      announce("Elección cancelada");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chosen, picked, panelId, announce]);

  // Foco tras una acción: el botón nuevo (o el que se movió) está en el siguiente render
  useEffect(() => {
    const selector = focusAfter.current;
    if (!selector) return;
    focusAfter.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  // Avisos con la caja real de cada lugar en pantalla: su tamaño, su proporción y su giro
  useLayoutEffect(() => {
    const root = rootRef.current;
    const boardRect = board.node?.getBoundingClientRect();
    if (!root || !boardRect || board.width === 0) return;
    const boxes = new Map<number, Box>();
    root.querySelectorAll<HTMLElement>("[data-zone]").forEach((el) => {
      const i = Number(el.dataset.zone);
      const element = byId.get(zones[i]?.elementId ?? "");
      if (!element) return;
      // El botón mide la ficha sin girar (el giro va dentro) y girar no mueve su centro
      const r = el.getBoundingClientRect();
      const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      boxes.set(i, elementBox(center, { w: r.width, h: r.height }, elementView(element).rotation, 1));
    });

    // Dos lugares que se tapan a la vista
    const find = (): [number, number] | null => {
      for (let a = 0; a < ordered.length; a++) {
        for (let b = a + 1; b < ordered.length; b++) {
          const [i, j] = [ordered[a], ordered[b]];
          // Más cerca aún: es el error «encimados» de la validación, que no deja guardar
          if (relDistance(zones[i], zones[j], aspect) < MIN_ZONE_GAP) continue;
          const [bi, bj] = [boxes.get(i), boxes.get(j)];
          if (bi && bj && boxesOverlap(bi, bj)) return [i, j];
        }
      }
      return null;
    };
    const found = find();
    setCovered((prev) => (prev?.[0] === found?.[0] && prev?.[1] === found?.[1] ? prev : found));

    // Lugares que, sin recortar, se salen del rectángulo de la foto
    const clipped = ordered.filter((i) => {
      const box = boxes.get(i);
      if (!box) return false;
      const r = boxBounds(box);
      return r.left < boardRect.left || r.right > boardRect.right || r.top < boardRect.top || r.bottom > boardRect.bottom;
    });
    setEdgeClipped((prev) =>
      prev.length === clipped.length && prev.every((v, idx) => v === clipped[idx]) ? prev : clipped
    );
  }, [zones, ordered, byId, dense, board.width, board.node, aspect]);

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
    if (panelId === id) setPanelId(null);
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
    const element: ImageElement = { id: newElementId(elements), kind: "text", text, size: DEFAULT_TEXT_SIZE };
    setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
    setLabel("");
    setNotice(null);
    announce(`«${text}» agregado: arrástralo a la foto`);
  }

  function closeLabel() {
    setLabel(null);
    focusAfter.current = "[data-add-text]";
  }

  /**
   * ¿Ya hay en la lista (sin contar el elemento `except`) un ícono con el mismo
   * contenido que alguno de estos? Primero el tamaño; la huella, solo si coincide.
   */
  async function iconExists(candidates: Candidate[], except?: string): Promise<boolean> {
    const sizes = new Set(candidates.map((c) => c.size));
    const checks = elements.map(async (e) => {
      if (e.kind !== "icon" || !e.fileId || e.id === except) return false;
      let known = iconPrints.current.get(e.fileId);
      if (!known || (sizes.has(known.size) && !known.hash)) {
        const res = await fetch(fileUrl(e.fileId)).catch(() => null);
        if (!res?.ok) return false;
        const length = res.headers.get("content-length");
        if (length !== null && !sizes.has(Number(length))) {
          // Otro tamaño: ni se descarga el resto
          void res.body?.cancel();
          iconPrints.current.set(e.fileId, { size: Number(length) });
          return false;
        }
        const data = await res.arrayBuffer();
        known = { size: data.byteLength, hash: await fingerprint(data) };
        iconPrints.current.set(e.fileId, known);
      }
      for (const c of candidates) {
        if (c.size === known.size && known.hash === (await c.print())) return true;
      }
      return false;
    });
    return (await Promise.all(checks)).some(Boolean);
  }

  /** Un aviso de algo que no se hizo, a la vista y en voz alta. */
  function warn(text: string) {
    setNotice(text);
    announce(text);
  }

  /** Sube un ícono ya preparado y lo recuerda (su huella y que ya no tiene margen). */
  async function uploadIcon(icon: PreparedIcon, print: Candidate): Promise<string> {
    const fileId = await uploadFile(asFile(icon), "editor_image");
    iconPrints.current.set(fileId, { size: print.size, hash: await print.print() });
    rememberInspection(fileId, { ratio: icon.ratio, margin: false });
    return fileId;
  }

  async function addIcon(file: File) {
    if (uploading || fullElements) return;
    setError(null);
    setNotice(null);
    setUploading("icon");
    try {
      // Solo el dibujo: sin márgenes transparentes y a un tamaño razonable
      const icon = await prepare(file);
      if (!icon) return warn(EMPTY_ICON);
      // Repetido: el recorte (íconos nuevos) o el archivo tal cual (subidos antes del recorte)
      const prepared = candidate(icon.blob);
      if (await iconExists([prepared, candidate(file)])) return warn(DUPLICATE);
      const fileId = await uploadIcon(icon, prepared);
      const element: ImageElement = { id: newElementId(elements), kind: "icon", fileId, size: DEFAULT_ICON_SIZE, ratio: icon.ratio };
      setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
      announce("Ícono agregado: arrástralo a la foto");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el ícono");
    } finally {
      setUploading(null);
    }
  }

  /**
   * «Quitar margen» a un ícono subido antes del recorte: se sube recortado y el
   * elemento cambia de archivo y proporción; conserva su tamaño, su giro y sus
   * lugares (como el tamaño es el lado mayor, el dibujo ahora lo ocupa entero).
   */
  async function trimIcon(id: string) {
    const element = byId.get(id);
    if (uploading || !element?.fileId) return;
    setError(null);
    setNotice(null);
    setUploading("icon");
    setTrimming(id);
    try {
      const res = await fetch(fileUrl(element.fileId)).catch(() => null);
      if (!res?.ok) throw new Error("No se pudo leer el ícono: quítalo y vuelve a subirlo.");
      const blob = await res.blob();
      const icon = await prepare(new File([blob], "icono", { type: blob.type }));
      if (!icon) return warn(EMPTY_ICON);
      if (!icon.trimmed) {
        rememberInspection(element.fileId, { ratio: icon.ratio, margin: false });
        return warn(NO_MARGIN);
      }
      const prepared = candidate(icon.blob);
      if (await iconExists([prepared], id)) return warn(SAME_TRIMMED);
      const fileId = await uploadIcon(icon, prepared);
      setConfig((c) => ({
        ...c,
        elements: c.elements.map((e) => (e.id === id ? { ...e, fileId, ratio: icon.ratio } : e)),
      }));
      announce(`${nameOf(id)}: margen quitado, ahora se ve solo su dibujo`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar el margen");
    } finally {
      setUploading(null);
      setTrimming(null);
    }
  }

  /** Un clic en la fila: el elemento va al panel «Seleccionado». No coloca nada. */
  function select(id: string, viaKeyboard: boolean) {
    setChosen(null);
    setPicked(null);
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
    setPicked(null);
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
  /** El elemento del panel «Seleccionado»: el elegido en la lista o el del lugar elegido. */
  const selectedId = panelId ?? (picked !== null ? zones[picked]?.elementId : undefined);
  const selected = (selectedId && byId.get(selectedId)) || null;

  /** Tamaño o giro de un elemento: lo toman todos sus lugares. */
  function changeElement(id: string, patch: Pick<ImageElement, "size" | "rotation">) {
    setConfig((c) => ({ ...c, elements: c.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }
  const hint = removing
    ? "Fuera de la foto: suéltalo para quitar este lugar."
    : chosen
      ? `Haz clic en la foto donde va «${nameOf(chosen)}» (Esc para cancelar).`
      : elements.length === 0
        ? "Primero agrega los íconos o etiquetas que el alumno colocará."
        : "Arrastra un elemento de la lista a la foto para marcar dónde va (o pulsa su botón «Colocar», la mira, y haz clic en la foto). Arrástralo de nuevo para moverlo, o sácalo de la foto para quitarlo. Un clic en un lugar o en la lista lo elige para cambiar su tamaño y su giro.";

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
              // Solo con «Colocar» un clic crea un lugar; si no, suelta lo elegido
              if (chosen) placeAt(chosen, p, false);
              else {
                setPicked(null);
                setPanelId(null);
              }
            }}
            tabIndex={0}
            role="application"
            aria-label="Foto: pulsa «Colocar» en un elemento de la lista, mueve la mira con las flechas y pulsa Enter para colocarlo"
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
                  dense={dense}
                  picked={picked === i}
                  lifted={active === `zone:${i}`}
                  onClick={(e) => {
                    setChosen(null);
                    setPanelId(null);
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
              {edgeWarning(edgeNumbers, edgeKinds)}
            </p>
          )}
        </div>

        <div className="relative space-y-2 rounded-xl" {...panelDrop.dropProps}>
          {elements.length > 0 && (
            <ElementPanel
              element={selected}
              name={selected ? nameOf(selected.id) : ""}
              boardWidth={board.width}
              onChange={(patch) => selected && changeElement(selected.id, patch)}
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
                    selected={selected?.id === element.id}
                    placing={chosen === element.id}
                    margin={element.kind === "icon" && !!element.fileId && !!inspected.get(element.fileId)?.margin}
                    trimming={trimming === element.id}
                    busy={uploading !== null}
                    onSelect={(e) => select(element.id, e.detail === 0)}
                    onPlace={(e) => startPlacing(element.id, e.detail === 0)}
                    onTrim={() => void trimIcon(element.id)}
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
                  <ItemFace item={elementView(activeElement)} boardWidth={board.width} dense={dense} />
                </span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  );
}

/**
 * Un elemento de la lista. Clic: lo elige para el panel «Seleccionado» (no
 * coloca nada). Se coloca arrastrándolo a la foto o con su botón «Colocar» y
 * un clic en la foto. Un ícono con margen transparente ofrece quitárselo.
 */
function ElementRow({
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
  onSelect: (e: React.MouseEvent) => void;
  onPlace: (e: React.MouseEvent) => void;
  onTrim: () => void;
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
          ref={setNodeRef}
          type="button"
          {...listeners}
          data-element={element.id}
          onClick={onSelect}
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
          onClick={onPlace}
        >
          <Crosshair aria-hidden />
        </Button>
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
      </div>
      {(margin || trimming) && (
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
            onClick={() => !busy && onTrim()}
          >
            {trimming ? <Loader2 className="animate-spin" aria-hidden /> : <Crop aria-hidden />}
            {trimming ? "Quitando…" : "Quitar margen"}
          </Button>
        </div>
      )}
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
  dense: boolean;
  picked: boolean;
  /** Va en la mano: se ve el fantasma, y el botón sigue montado (invisible) para no cortar el arrastre. */
  lifted: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: `zone:${index}` });
  const view = elementView(element);
  // El botón mide la ficha sin girar (los avisos lo miden así); el anillo, el
  // número y la «×» van en una capa que gira con ella, con su contenido derecho
  const turn = view.rotation ? { transform: `rotate(${view.rotation}deg)` } : undefined;
  const upright = view.rotation ? { transform: `rotate(${-view.rotation}deg)` } : undefined;
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
        className="group/zone relative block cursor-grab touch-none outline-none active:cursor-grabbing"
      >
        <ItemFace item={view} boardWidth={boardWidth} dense={dense} />
        <span aria-hidden className="pointer-events-none absolute inset-0" style={turn}>
          <span
            className={cn(
              "absolute inset-0 group-focus-visible/zone:ring-4 group-focus-visible/zone:ring-primary/40",
              element.kind === "icon" ? "rounded-[12px]" : "rounded-full",
              picked && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          />
          <span
            className="absolute -right-2 -top-2 flex size-[18px] items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground ring-2 ring-white"
            style={upright}
          >
            {number}
          </span>
        </span>
      </button>
      {picked && (
        <span className="pointer-events-none absolute inset-0" style={turn}>
          <button
            type="button"
            aria-label={`Quitar el lugar ${number}`}
            title="Quitar este lugar"
            onClick={onRemove}
            style={upright}
            className="pointer-events-auto absolute -left-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow ring-2 ring-white outline-none hover:bg-destructive/90 focus-visible:ring-4 focus-visible:ring-destructive/40"
          >
            <X className="size-3" strokeWidth={3} aria-hidden />
          </button>
        </span>
      )}
    </BoardSpot>
  );
}
