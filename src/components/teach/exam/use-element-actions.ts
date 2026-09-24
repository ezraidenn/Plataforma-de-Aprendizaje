"use client";

import type { RefObject } from "react";
import { DEFAULT_TEXT_SIZE } from "@/lib/image-layout";
import {
  MAX_ELEMENTS,
  MAX_ZONES,
  freeSpot,
  readingNumbers,
  round4,
  type ImageDragConfig,
  type ImageElement,
  type ImageZone,
  type Point,
} from "@/lib/image-questions";
import { plural } from "@/lib/plural";
import type { HistoryOptions } from "./use-editor-history";
import { newElementId } from "./use-editor-icons";

/**
 * Lo que se hace con los elementos del editor de «arrastrar a la imagen»:
 * colocar uno en la foto (soltándolo, con «Colocar» y un clic, o con la mira y
 * Enter), quitarlo junto con sus lugares, agregar una etiqueta y elegirlo en la
 * lista (para el panel «Seleccionado» o para colocarlo). Lo elegido (`chosen`,
 * `panelId`) vive en el editor; aquí solo se cambia.
 */
export function useElementActions({
  elements,
  listed,
  zones,
  aspect,
  byId,
  chosen,
  setChosen,
  panelId,
  setPanelId,
  setConfig,
  setNotice,
  announce,
  nameOf,
  clearSelection,
  focusAfter,
  boardNode,
}: {
  elements: ImageElement[];
  /** Los elementos en el orden de la lista. */
  listed: ImageElement[];
  zones: ImageZone[];
  aspect: number;
  byId: ReadonlyMap<string, ImageElement>;
  /** Elemento elegido para colocarlo con un clic en la foto. */
  chosen: string | null;
  setChosen: (id: string | null) => void;
  /** Elemento elegido en la lista para el panel «Seleccionado». */
  panelId: string | null;
  setPanelId: (id: string | null) => void;
  setConfig: (fn: (c: ImageDragConfig) => ImageDragConfig, options?: HistoryOptions) => ImageDragConfig;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  nameOf: (id: string) => string;
  clearSelection: () => void;
  /** Selector de lo que debe tomar el foco en el siguiente render. */
  focusAfter: RefObject<string | null>;
  boardNode: HTMLElement | null;
}) {
  function placeAt(elementId: string, p: Point, viaKeyboard: boolean) {
    setChosen(null);
    // Un elemento que ya no está (se deshizo su alta) no deja un lugar sin nada
    if (!byId.has(elementId)) return;
    if (zones.length >= MAX_ZONES) {
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
    if (viaKeyboard) boardNode?.focus();
  }

  return { placeAt, removeElement, addLabel, select, startPlacing };
}
