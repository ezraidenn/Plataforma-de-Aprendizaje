"use client";

import { useEffect, useRef, useState } from "react";
import {
  alignDeltas,
  boxBounds,
  distributeDeltas,
  elementBox,
  elementView,
  iconBoxPx,
  snapMove,
  snapScale,
  unionBounds,
  type AlignMode,
  type Bounds,
  type Guide,
} from "@/lib/image-layout";
import { clamp01, round4, type ImageDragConfig, type ImageElement, type ImageZone, type Point } from "@/lib/image-questions";
import type { HistoryOptions } from "./use-editor-history";

/**
 * Herramientas del lienzo del editor de «arrastrar a la imagen»: la caja de
 * cada lugar (con su giro), el imán con sus guías al mover o estirar, y
 * alinear y repartir lo seleccionado.
 *
 * Cajas: un ícono mide lo que dice su tamaño (`iconBoxPx`); una etiqueta se
 * mide en pantalla sin su giro (`offsetWidth` no incluye la transformación).
 * Las dos, en fracciones del ancho de la foto, pasan por `elementBox` y
 * `boxBounds`: la caja envolvente de lo que se ve, ya girado.
 *
 * Imán: a menos de SNAP_PX de pantalla, el borde o el centro de lo que se
 * mueve (o el borde de lo que se estira) se pega a los de los lugares que no
 * se mueven, a los bordes y el centro de la foto y, con la cuadrícula, a sus
 * líneas. Alt sostenido lo apaga. Las guías rojas se ven mientras dura el gesto.
 */

type SetConfig = (fn: (c: ImageDragConfig) => ImageDragConfig, options?: HistoryOptions) => ImageDragConfig;
export type Delta = { dx: number; dy: number };
/** Distancia entre dos cajas vecinas tras repartir (en coordenadas de la foto). */
export type DistanceMark = { from: Point; to: Point; label: string };

/** Separación de la cuadrícula (fracción de cada lado de la foto). */
export const GRID_STEP = 0.1;
/** El imán pega a menos de esto (px de pantalla). */
const SNAP_PX = 6;
/** Tiempo que se ven las distancias tras repartir. */
const DISTANCES_MS = 1500;
const NONE: Guide[] = [];

const sameGuides = (a: Guide[], b: Guide[]) =>
  a.length === b.length && a.every((g, k) => g.axis === b[k].axis && g.at === b[k].at);

/** Porcentaje con un decimal, sin «.0». */
const percent = (n: number) => String(Math.round(n * 1000) / 10);

/** Las distancias entre cajas vecinas a lo largo de un eje. */
function distanceMarks(boxes: Bounds[], axis: "x" | "y"): DistanceMark[] {
  const lo = (b: Bounds) => (axis === "x" ? b.left : b.top);
  const hi = (b: Bounds) => (axis === "x" ? b.right : b.bottom);
  const sorted = [...boxes].sort((a, b) => lo(a) - lo(b));
  return sorted.slice(1).map((b, k) => {
    const a = sorted[k];
    const label = `= ${percent(lo(b) - hi(a))} %`;
    if (axis === "x") {
      const y = (a.top + a.bottom + b.top + b.bottom) / 4;
      return { from: { x: hi(a), y }, to: { x: lo(b), y }, label };
    }
    const x = (a.left + a.right + b.left + b.right) / 4;
    return { from: { x, y: hi(a) }, to: { x, y: lo(b) }, label };
  });
}

export function useCanvasTools({
  boardNode,
  boardWidth,
  aspect,
  zones,
  byId,
  magnet,
  grid,
  setConfig,
  announce,
}: {
  boardNode: HTMLElement | null;
  boardWidth: number;
  aspect: number;
  zones: ImageZone[];
  byId: ReadonlyMap<string, ImageElement>;
  /** Interruptor «Imán» de la barra. */
  magnet: boolean;
  /** Cuadrícula encendida: el imán también pega a sus líneas. */
  grid: boolean;
  setConfig: SetConfig;
  announce: (text: string) => void;
}) {
  const [guides, setGuides] = useState<Guide[]>(NONE);
  /** Centro (ya con imán) de un lugar solo que va en la mano: lo marca la regla. */
  const [held, setHeld] = useState<Point | null>(null);
  /** Distancias tras repartir, con los lugares a los que se refieren (si cambian, ya no se ven). */
  const [distances, setDistances] = useState<{ of: ImageZone[]; marks: DistanceMark[] } | null>(null);
  /** Alt sostenido (lo dicen el teclado y el puntero). */
  const alt = useRef(false);
  /** Hay un gesto con imán en curso. */
  const busy = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      alt.current = e.altKey;
      // A medio gesto, Alt solo apaga el imán: el navegador no abre su menú
      if (e.key === "Alt" && busy.current) e.preventDefault();
    };
    const onPointer = (e: PointerEvent) => {
      alt.current = e.altKey;
    };
    const reset = () => {
      alt.current = false;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("pointermove", onPointer, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("pointermove", onPointer, true);
      window.removeEventListener("blur", reset);
    };
  }, []);

  useEffect(() => {
    if (!distances) return;
    const timer = window.setTimeout(() => setDistances(null), DISTANCES_MS);
    return () => window.clearTimeout(timer);
  }, [distances]);

  const width = () => (boardWidth > 0 ? boardWidth : (boardNode?.getBoundingClientRect().width ?? 0));

  /** Tamaño sin girar de lo que hay en el lugar `i`, en fracciones del ANCHO de la foto (w y h). */
  function sizeOf(i: number): { w: number; h: number } | null {
    const W = width();
    const element = byId.get(zones[i]?.elementId ?? "");
    if (!element || W <= 0) return null;
    const view = elementView(element);
    if (view.kind === "icon") {
      const { w, h } = iconBoxPx(view.size, view.ratio, W);
      return { w: w / W, h: h / W };
    }
    const el = boardNode?.querySelector<HTMLElement>(`[data-zone="${i}"]`);
    return el && el.offsetWidth > 0 ? { w: el.offsetWidth / W, h: el.offsetHeight / W } : null;
  }

  /** Caja envolvente (con giro) del lugar `i` con su centro en `at`; `rel`: otro tamaño (al estirar). */
  function boundsOf(i: number, at: Point | undefined = zones[i], rel = sizeOf(i)): Bounds | null {
    const element = byId.get(zones[i]?.elementId ?? "");
    if (!element || !at || !rel) return null;
    return boxBounds(elementBox(at, rel, elementView(element).rotation, aspect));
  }

  /** Las cajas de los lugares que no cumplen `skip`. */
  const othersThan = (skip: (j: number) => boolean) =>
    zones.flatMap((_, j) => {
      const b = skip(j) ? null : boundsOf(j);
      return b ? [b] : [];
    });

  /** Umbrales del imán; null si está apagado (interruptor o Alt). */
  function snapOptions(altKey = alt.current) {
    const W = width();
    if (!magnet || altKey || W <= 0) return null;
    return { tx: SNAP_PX / W, ty: SNAP_PX / (W * aspect), grid: grid ? GRID_STEP : null };
  }

  function showGuides(next: Guide[]) {
    busy.current = true;
    setGuides((prev) => (sameGuides(prev, next) ? prev : next));
  }

  /** Un grupo en la mano, desplazado `d`: el desplazamiento con imán (y sus guías). */
  function snapShift(indices: Set<number>, d: Delta): Delta {
    const opts = snapOptions();
    const moving = opts
      ? [...indices].flatMap((i) => {
          const z = zones[i];
          const b = z && boundsOf(i, { x: z.x + d.dx, y: z.y + d.dy });
          return b ? [b] : [];
        })
      : [];
    if (!opts || moving.length === 0) {
      showGuides(NONE);
      return d;
    }
    const s = snapMove(unionBounds(moving), othersThan((j) => indices.has(j)), opts);
    showGuides(s.guides);
    return { dx: d.dx + s.dx, dy: d.dy + s.dy };
  }

  /** Un lugar solo en la mano con su centro en `p`: dónde queda con el imán. Sin tocar el estado (lo usa el fantasma al dibujarse). */
  function snapPoint(i: number, p: Point): { p: Point; guides: Guide[] } {
    const opts = snapOptions();
    const b = opts && boundsOf(i, p);
    if (!opts || !b) return { p, guides: NONE };
    const s = snapMove(b, othersThan((j) => j === i), opts);
    return { p: { x: clamp01(p.x + s.dx), y: clamp01(p.y + s.dy) }, guides: s.guides };
  }

  /** El lugar solo se movió (null: está fuera de la foto): sus guías y la marca de las reglas. */
  function hold(i: number, p: Point | null) {
    const s = p && snapPoint(i, p);
    showGuides(s ? s.guides : NONE);
    setHeld(s ? s.p : null);
  }

  /**
   * Estirar el elemento del lugar `i` hasta el tamaño `rel` (sin girar, en
   * fracciones del ancho): el factor del imán, o null. Sus otros lugares no
   * cuentan como guías (cambian con él).
   */
  function snapStretch(i: number, rel: { w: number; h: number }, altKey: boolean) {
    const opts = snapOptions(altKey);
    const z = zones[i];
    const b = opts && z ? boundsOf(i, z, rel) : null;
    if (!opts || !b) return null;
    return snapScale(b, z, othersThan((j) => zones[j].elementId === z.elementId), opts);
  }

  /** Terminó el gesto: fuera guías. */
  function end() {
    busy.current = false;
    setGuides(NONE);
    setHeld(null);
  }

  /** Mueve los lugares `list` lo que dice cada delta, sin salir de la foto. Los lugares nuevos, o null si nada cambió. */
  function applyDeltas(list: number[], deltas: Delta[]): ImageZone[] | null {
    const moves = new Map(list.map((i, k) => [i, deltas[k]]));
    let changed = false as boolean;
    const next = setConfig((c) => {
      const moved = c.zones.map((z, j) => {
        const d = moves.get(j);
        if (!d) return z;
        const x = round4(clamp01(z.x + d.dx));
        const y = round4(clamp01(z.y + d.dy));
        if (x === z.x && y === z.y) return z;
        changed = true;
        return { ...z, x, y };
      });
      return changed ? { ...c, zones: moved } : c;
    });
    return changed ? next.zones : null;
  }

  /** Las cajas de `list`; null si alguna no se pudo medir. */
  function boxesOf(list: number[], at: (i: number) => Point | undefined = (i) => zones[i]): Bounds[] | null {
    const boxes = list.map((i) => boundsOf(i, at(i)));
    return boxes.every((b): b is Bounds => b !== null) ? boxes : null;
  }

  /** Alinear lo seleccionado por su caja visible (con giro). */
  function align(list: number[], mode: AlignMode, said: string) {
    if (list.length < 2) return announce("Selecciona al menos 2 lugares para alinearlos");
    const boxes = boxesOf(list);
    if (!boxes) return;
    const moved = applyDeltas(list, alignDeltas(boxes, mode));
    announce(moved ? `${list.length} lugares alineados ${said}` : `Ya estaban alineados ${said}`);
  }

  /** Repartir lo seleccionado con el mismo espacio entre cajas; las distancias se ven un momento. */
  function distribute(list: number[], axis: "x" | "y") {
    if (list.length < 3) return announce("Selecciona al menos 3 lugares para repartirlos");
    const boxes = boxesOf(list);
    if (!boxes) return;
    const moved = applyDeltas(list, distributeDeltas(boxes, axis).deltas);
    const now = moved ?? zones;
    // Ya en su sitio (recortados a la foto): cada distancia es la real
    const placed = boxesOf(list, (i) => now[i]);
    const marks = placed ? distanceMarks(placed, axis) : [];
    setDistances({ of: now, marks });
    const how = axis === "x" ? "en horizontal" : "en vertical";
    const gaps = [...new Set(marks.map((m) => m.label.slice(2)))].join(", ");
    announce(`${moved ? `${list.length} lugares repartidos` : "Ya estaban repartidos"} ${how}: ${gaps} entre cada uno`);
  }

  return {
    guides,
    held,
    distances: distances && distances.of === zones ? distances.marks : null,
    sizeOf,
    snapShift,
    snapPoint,
    hold,
    snapStretch,
    showGuides,
    end,
    align,
    distribute,
  };
}
