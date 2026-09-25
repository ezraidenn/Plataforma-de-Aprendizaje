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
  textPx,
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
 * `boxBounds`: la caja envolvente de lo que se ve, ya girado. Los gestos (el
 * imán) miden con la foto como se ve; alinear y repartir, con la foto al
 * 100 % (`fit`): lo que queda no depende del zoom (con zoom, un ícono puede
 * dejar de verse al mínimo legible y cambiar de tamaño relativo).
 *
 * Imán: a menos de SNAP_PX de pantalla, el borde o el centro de lo que se
 * mueve (o el borde de lo que se estira) se pega a los de los lugares que no
 * se mueven, a los bordes y el centro de la foto y, con la cuadrícula, a sus
 * líneas. Alt sostenido lo apaga. Las guías rojas se ven mientras dura el gesto.
 */

type SetConfig = (fn: (c: ImageDragConfig) => ImageDragConfig, options?: HistoryOptions) => ImageDragConfig;
export type Delta = { dx: number; dy: number };
/** Distancia entre dos cajas vecinas tras repartir (en coordenadas de la foto), a lo largo de `axis`. */
export type DistanceMark = { axis: "x" | "y"; from: Point; to: Point; label: string };

/** El imán pega a menos de esto (px de pantalla; con el zoom, la foto se mide ya ampliada). */
export const SNAP_PX = 6;
/** Tiempo que se ven las distancias tras repartir. */
const DISTANCES_MS = 1500;
const NONE: Guide[] = [];

/**
 * Tamaño sin girar de un elemento, en fracciones del ANCHO de la foto, con la
 * foto a `W` px. Un ícono, por su geometría (`iconBoxPx`); una etiqueta, por
 * lo que mide en pantalla (`label`, con la foto a `shown` px) llevado a `W`
 * con su letra: su relleno va en `em` y crece con ella.
 */
export function elementSizeAt(
  element: ImageElement,
  W: number,
  label: HTMLElement | null | undefined,
  shown: number
): { w: number; h: number } | null {
  if (W <= 0) return null;
  const view = elementView(element);
  if (view.kind === "icon") {
    const { w, h } = iconBoxPx(view.size, view.ratio, W);
    return { w: w / W, h: h / W };
  }
  if (!label || label.offsetWidth <= 0 || shown <= 0) return null;
  const k = textPx(view.size, W) / textPx(view.size, shown);
  return { w: (label.offsetWidth * k) / W, h: (label.offsetHeight * k) / W };
}

const sameGuides = (a: Guide[], b: Guide[]) =>
  a.length === b.length && a.every((g, k) => g.axis === b[k].axis && g.at === b[k].at);

/** Porcentaje con un decimal, sin «.0». */
const percent = (n: number) => String(Math.round(n * 1000) / 10);

/**
 * Las distancias entre cajas vecinas a lo largo de un eje. Si un hueco es el
 * de `common` (el espacio que dio repartir) salvo el redondeo de los centros a
 * cuatro decimales, se dice ese: así «2.65 %» no sale como «2.7» y «2.6».
 */
function distanceMarks(boxes: Bounds[], axis: "x" | "y", common?: number): DistanceMark[] {
  const lo = (b: Bounds) => (axis === "x" ? b.left : b.top);
  const hi = (b: Bounds) => (axis === "x" ? b.right : b.bottom);
  const sorted = [...boxes].sort((a, b) => lo(a) - lo(b));
  return sorted.slice(1).map((b, k) => {
    const a = sorted[k];
    const gap = lo(b) - hi(a);
    const label = `= ${percent(common !== undefined && Math.abs(gap - common) < 5e-4 ? common : gap)} %`;
    if (axis === "x") {
      const y = (a.top + a.bottom + b.top + b.bottom) / 4;
      return { axis, from: { x: hi(a), y }, to: { x: lo(b), y }, label };
    }
    const x = (a.left + a.right + b.left + b.right) / 4;
    return { axis, from: { x, y: hi(a) }, to: { x, y: lo(b) }, label };
  });
}

export function useCanvasTools({
  boardNode,
  boardWidth,
  fit,
  aspect,
  zones,
  byId,
  magnet,
  grid,
  setConfig,
  setNotice,
  announce,
}: {
  boardNode: HTMLElement | null;
  boardWidth: number;
  /** Ancho de la foto al 100 % (px): con él se alinea y reparte. */
  fit: number;
  aspect: number;
  zones: ImageZone[];
  byId: ReadonlyMap<string, ImageElement>;
  /** Interruptor «Imán» de la barra. */
  magnet: boolean;
  /** Cuadrícula encendida (su separación): el imán también pega a sus líneas. */
  grid: number | null;
  setConfig: SetConfig;
  /** Aviso a la vista de algo que no se hizo. */
  setNotice: (n: string | null) => void;
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
  /** Lo medido para el gesto en curso (ver `gestureBoxes`). */
  const cache = useRef<{
    of: ImageZone[];
    key: string;
    others: Bounds[];
    sizes: Map<number, { w: number; h: number } | null>;
  } | null>(null);

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

  /** Tamaño sin girar de lo que hay en el lugar `i`, en fracciones del ANCHO de la foto, con la foto a `W` px (sin él, como se ve). */
  function sizeOf(i: number, W = width()): { w: number; h: number } | null {
    const element = byId.get(zones[i]?.elementId ?? "");
    if (!element) return null;
    return elementSizeAt(element, W, boardNode?.querySelector<HTMLElement>(`[data-zone="${i}"]`), width());
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
    return { tx: SNAP_PX / W, ty: SNAP_PX / (W * aspect), grid };
  }

  function showGuides(next: Guide[]) {
    busy.current = true;
    setGuides((prev) => (sameGuides(prev, next) ? prev : next));
  }

  /**
   * Lo que no cambia mientras dura un gesto (las cajas de los lugares quietos
   * y el tamaño de los que se mueven) se mide una vez, no en cada movimiento.
   * Vale mientras sean los mismos lugares, el mismo gesto y el mismo ancho.
   */
  function gestureBoxes(key: string, skip: (j: number) => boolean, moving: number[]) {
    const fullKey = `${key}@${width()}`;
    const c = cache.current;
    if (c && c.of === zones && c.key === fullKey) return c;
    const next = { of: zones, key: fullKey, others: othersThan(skip), sizes: new Map(moving.map((i) => [i, sizeOf(i)])) };
    cache.current = next;
    return next;
  }

  /**
   * Un grupo en la mano, desplazado `d`: el desplazamiento con imán, ya
   * recortado por `clamp` (sin salir de la foto), y sus guías. Si la orilla no
   * deja llegar a una guía, se dibujan solo las que de verdad se tocan.
   */
  function snapShift(indices: Set<number>, d: Delta, clamp: (d: Delta) => Delta = (x) => x): Delta {
    const opts = snapOptions();
    const list = [...indices];
    const g = opts ? gestureBoxes(`grupo:${list.join(",")}`, (j) => indices.has(j), list) : null;
    const movingAt = (at: Delta) =>
      list.flatMap((i) => {
        const z = zones[i];
        const b = z && g ? boundsOf(i, { x: z.x + at.dx, y: z.y + at.dy }, g.sizes.get(i) ?? null) : null;
        return b ? [b] : [];
      });
    const moving = movingAt(d);
    if (!opts || !g || moving.length === 0) {
      showGuides(NONE);
      return clamp(d);
    }
    const s = snapMove(unionBounds(moving), g.others, opts);
    const snapped = { dx: d.dx + s.dx, dy: d.dy + s.dy };
    const kept = clamp(snapped);
    const touching =
      kept.dx === snapped.dx && kept.dy === snapped.dy
        ? s.guides
        : snapMove(unionBounds(movingAt(kept)), g.others, { tx: 1e-9, ty: 1e-9, grid: opts.grid }).guides;
    showGuides(touching);
    return kept;
  }

  /**
   * Un lugar solo en la mano con su centro en `p`: dónde queda con el imán.
   * Sin tocar el estado: lo calcula el fantasma al dibujarse, y el arrastre
   * publica ese mismo resultado con `hold`.
   */
  function snapPoint(i: number, p: Point): { p: Point; guides: Guide[] } {
    const opts = snapOptions();
    const g = opts ? gestureBoxes(`uno:${i}`, (j) => j === i, [i]) : null;
    const b = opts && g ? boundsOf(i, p, g.sizes.get(i) ?? null) : null;
    if (!opts || !g || !b) return { p, guides: NONE };
    const s = snapMove(b, g.others, opts);
    return { p: { x: clamp01(p.x + s.dx), y: clamp01(p.y + s.dy) }, guides: s.guides };
  }

  /** El lugar solo se movió (null: está fuera de la foto): sus guías y la marca de las reglas, si cambiaron. */
  function hold(s: { p: Point; guides: Guide[] } | null) {
    showGuides(s ? s.guides : NONE);
    const at = s?.p ?? null;
    setHeld((prev) => (prev === at || (prev && at && prev.x === at.x && prev.y === at.y) ? prev : at));
  }

  /**
   * Estirar el elemento del lugar `i` hasta el tamaño `rel` (sin girar, en
   * fracciones del ancho): el factor del imán, o null. Sus otros lugares no
   * cuentan como guías (cambian con él).
   */
  function snapStretch(i: number, rel: { w: number; h: number }, altKey: boolean) {
    const opts = snapOptions(altKey);
    const z = zones[i];
    if (!opts || !z) return null;
    const g = gestureBoxes(`estirar:${i}`, (j) => zones[j].elementId === z.elementId, []);
    const b = boundsOf(i, z, rel);
    return b && snapScale(b, z, g.others, opts);
  }

  /** Terminó el gesto: fuera guías (y lo medido para él). */
  function end() {
    busy.current = false;
    cache.current = null;
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

  /** Las cajas de `list` con la foto al 100 % (no dependen del zoom); null si alguna no se pudo medir. */
  function boxesOf(list: number[], at: (i: number) => Point | undefined = (i) => zones[i]): Bounds[] | null {
    const W = fit > 0 ? fit : width();
    const boxes = list.map((i) => boundsOf(i, at(i), sizeOf(i, W)));
    return boxes.every((b): b is Bounds => b !== null) ? boxes : null;
  }

  /** Una etiqueta sin medir (aún no se dibuja): se dice en lugar de no hacer nada. */
  const UNMEASURED = "No se pudo medir un lugar: espera un momento e inténtalo otra vez";

  /** Alinear lo seleccionado por su caja visible (con giro). */
  function align(list: number[], mode: AlignMode, said: string) {
    if (list.length < 2) return announce("Selecciona al menos 2 lugares para alinearlos");
    const boxes = boxesOf(list);
    if (!boxes) return announce(UNMEASURED);
    const moved = applyDeltas(list, alignDeltas(boxes, mode));
    announce(moved ? `${list.length} lugares alineados ${said}` : `Ya estaban alineados ${said}`);
  }

  /** Repartir lo seleccionado con el mismo espacio entre cajas; las distancias se ven un momento. */
  function distribute(list: number[], axis: "x" | "y") {
    if (list.length < 3) return announce("Selecciona al menos 3 lugares para repartirlos");
    const boxes = boxesOf(list);
    if (!boxes) return announce(UNMEASURED);
    const { deltas, gap } = distributeDeltas(boxes, axis);
    // Las cajas suman más que el tramo: con el mismo espacio se encimarían
    if (gap < 0) {
      const text = `No caben con el mismo espacio ${axis === "x" ? "a lo ancho" : "a lo alto"}: sepáralos más o achícalos antes de repartir.`;
      setNotice(text);
      return announce(text);
    }
    const moved = applyDeltas(list, deltas);
    setNotice(null);
    const now = moved ?? zones;
    // Ya en su sitio (recortados a la foto): cada distancia es la real
    const placed = boxesOf(list, (i) => now[i]);
    const marks = placed ? distanceMarks(placed, axis, gap) : [];
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
