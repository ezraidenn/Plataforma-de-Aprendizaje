"use client";

import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { newZoneKey } from "@/lib/image-editor-value";
import {
  MAX_ZONES,
  clamp01,
  freeSpot,
  round4,
  type ImageDragConfig,
  type ImageZone,
  type Point,
} from "@/lib/image-questions";
import { joinY, plural } from "@/lib/plural";
import type { Area } from "./image-canvas";
import { revealSoon } from "./use-canvas-zoom";
import { isTypingTarget, type HistoryOptions } from "./use-editor-history";

/**
 * Selección de lugares en el editor de «arrastrar»: clic, Mayús+clic, recuadro,
 * Ctrl+A y, con teclado, Espacio sobre un lugar para sumarlo o quitarlo. Con lo
 * seleccionado: arrastrar uno mueve el grupo (sin salirse de la foto, con el
 * imán de `snapShift`), las flechas lo mueven 0.5 % (Mayús: 5 %), Ctrl+D lo
 * duplica y Supr lo quita. Si lo movido queda encimado con otro lugar, lo
 * avisa el editor (a partir de los lugares, no de lo que se hizo).
 * Cada cambio a los lugares es un paso del historial (las flechas seguidas, uno).
 *
 * La selección son índices de `zones`. Se guarda junto al arreglo al que se
 * refieren y, en cuanto los lugares cambian (deshacer, quitar otro), se
 * reubica por identidad y se vuelve a anclar al arreglo nuevo. Si solo se
 * movieron (mismo número de lugares, cada uno del mismo elemento), siguen los
 * mismos índices. Cambiar la selección corta la racha de flechas del historial.
 */

type SetConfig = (fn: (c: ImageDragConfig) => ImageDragConfig, options?: HistoryOptions) => ImageDragConfig;

/** Desplazamiento al duplicar, en x y en y (fracciones de la foto). */
const DUPLICATE_OFFSET = 0.03;
/** Pasos de las flechas: fracción del ancho (el vertical se corrige con la proporción). */
const NUDGE = 0.005;
const NUDGE_BIG = 0.05;
const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

type Picked = { of: ImageZone[]; picked: number[] };

/** Los índices seleccionados en `zones`, aunque la selección se haya hecho sobre otro arreglo. */
function resolve(sel: Picked, zones: ImageZone[]): Set<number> {
  const out = new Set<number>();
  for (const i of sel.picked) {
    if (sel.of === zones) {
      if (i < zones.length) out.add(i);
      continue;
    }
    const j = zones.indexOf(sel.of[i]);
    if (j >= 0) out.add(j);
    // Movidos (son objetos nuevos) pero los mismos lugares en el mismo orden
    else if (sel.of.length === zones.length && zones[i]?.elementId === sel.of[i]?.elementId) out.add(i);
  }
  return out;
}

/** Cuánto se puede mover un grupo sin que ningún centro salga de la foto. */
function clampShift(points: Point[], dx: number, dy: number): { dx: number; dy: number } {
  if (points.length === 0) return { dx: 0, dy: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    dx: Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx)),
    dy: Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy)),
  };
}

export function useDragSelection({
  zones,
  aspect,
  numbers,
  setConfig,
  setNotice,
  announce,
  boardNode,
  focusAfter,
  onSelectZones,
  endRun,
  snapShift,
}: {
  zones: ImageZone[];
  aspect: number;
  /** «Lugar N» de cada índice. */
  numbers: number[];
  setConfig: SetConfig;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  /** La foto: recibe el foco cuando desaparece el lugar que lo tenía. */
  boardNode: HTMLElement | null;
  /** Selector de lo que debe tomar el foco en el siguiente render. */
  focusAfter: RefObject<string | null>;
  /** Se eligieron lugares: lo elegido en la lista (o para colocar) se suelta. */
  onSelectZones: () => void;
  /** Corta la racha del historial (las flechas sobre otra selección son otro paso). */
  endRun: () => void;
  /** Imán del grupo en la mano: el desplazamiento pegado a las guías y ya recortado con `clamp`. */
  snapShift?: (
    indices: Set<number>,
    d: { dx: number; dy: number },
    clamp: (d: { dx: number; dy: number }) => { dx: number; dy: number }
  ) => { dx: number; dy: number };
}) {
  const [state, setState] = useState<Picked>({ of: zones, picked: [] });
  const selected = useMemo(() => resolve(state, zones), [state, zones]);
  // Si los lugares cambiaron, la selección (ya reubicada) se ancla a los de ahora:
  // así un deshacer después no la compara con un arreglo viejo
  if (state.of !== zones) setState({ of: zones, picked: [...selected] });
  /** Arrastre en grupo en curso: qué lugares y cuánto se han movido (ya acotado a la foto), para dibujarlos. */
  const [shift, setShift] = useState<{ indices: Set<number>; dx: number; dy: number } | null>(null);
  /** Los lugares del grupo en la mano (al momento, sin esperar un render). */
  const group = useRef<Set<number> | null>(null);

  const byReading = (list: Iterable<number>) => [...list].sort((a, b) => numbers[a] - numbers[b]);
  const count = (n: number) => `${n} ${plural(n, "lugar seleccionado", "lugares seleccionados")}`;

  function pick(indices: number[], of: ImageZone[] = zones) {
    setState({ of, picked: indices });
    endRun();
    if (indices.length > 0) onSelectZones();
  }

  const clear = useCallback(() => {
    setState((s) => (s.picked.length ? { of: s.of, picked: [] } : s));
    endRun();
  }, [endRun]);

  /** Mayús+clic o Espacio: suma o quita un lugar. */
  function toggle(i: number, viaKeyboard: boolean) {
    const next = new Set(selected);
    const had = next.delete(i);
    if (!had) next.add(i);
    pick([...next]);
    if (viaKeyboard) {
      announce(`Lugar ${numbers[i]} ${had ? "fuera de la selección" : "seleccionado"}: ${next.size ? count(next.size) : "ninguno seleccionado"}`);
    }
  }

  /** Clic en un lugar: lo selecciona solo a él (si ya lo era, lo suelta); con Mayús, lo suma o lo quita. */
  function click(i: number, additive: boolean, viaKeyboard: boolean) {
    if (additive) return toggle(i, viaKeyboard);
    if (selected.size === 1 && selected.has(i)) {
      clear();
      if (viaKeyboard) announce("Selección quitada");
      return;
    }
    pick([i]);
    if (viaKeyboard) {
      announce(`Lugar ${numbers[i]} seleccionado: flechas para moverlo, Supr para quitarlo, Espacio en otro lugar para sumarlo`);
    }
  }

  function all() {
    if (zones.length === 0) return announce("Aún no hay lugares en la foto");
    pick(zones.map((_, i) => i));
    announce(`Todos seleccionados: ${count(zones.length)}`);
  }

  /** Recuadro: los lugares cuyo centro queda dentro (con Mayús, se suman a los que ya estaban). */
  function selectArea(area: Area, additive: boolean) {
    const inside = zones.flatMap((z, i) =>
      z.x >= area.left && z.x <= area.right && z.y >= area.top && z.y <= area.bottom ? [i] : []
    );
    const next = additive ? [...new Set([...selected, ...inside])] : inside;
    pick(next);
    announce(next.length ? count(next.length) : "Ningún lugar en el recuadro");
  }

  /**
   * Mueve estos lugares juntos, sin que ninguno salga de la foto. Un grupo se
   * mueve rígido y predecible: si queda encimado con otro lugar no se corre
   * (lo avisa el editor, y el maestro decide cómo separarlos).
   */
  function moveBy(indices: number[], dx: number, dy: number, options?: HistoryOptions) {
    const moving = new Set(indices);
    setConfig((c) => {
      const d = clampShift(
        c.zones.filter((_, j) => moving.has(j)),
        dx,
        dy
      );
      if (d.dx === 0 && d.dy === 0) return c;
      return {
        ...c,
        zones: c.zones.map((z, j) =>
          moving.has(j) ? { ...z, x: round4(clamp01(z.x + d.dx)), y: round4(clamp01(z.y + d.dy)) } : z
        ),
      };
    }, options);
  }

  /** Flechas: mueven lo seleccionado; sobre un lugar que no lo estaba, ese pasa a ser la selección. */
  function nudge(key: string, big: boolean, focused: number | null) {
    const [sx, sy] = ARROW_STEPS[key];
    let indices = [...selected];
    if (focused !== null && !selected.has(focused)) {
      indices = [focused];
      pick(indices);
    }
    const d = big ? NUDGE_BIG : NUDGE;
    // Flechas seguidas sobre los mismos lugares: un solo paso para deshacer
    moveBy(indices, sx * d, (sy * d) / aspect, { coalesce: `mover:${[...indices].sort((a, b) => a - b).join(",")}` });
    // Si cambia su número, el botón cambia de sitio en el orden: el foco lo sigue
    if (focused !== null) focusAfter.current = `[data-zone="${focused}"]`;
    // Con zoom, lo movido que sale de la vista se lleva a ella (el que tiene el foco, o el primero)
    const shown = focused ?? indices[0];
    if (shown !== undefined) revealSoon(boardNode, `[data-zone="${shown}"]`);
  }

  /** Ctrl+D: cada seleccionado da un lugar nuevo del mismo elemento, un poco desplazado; quedan seleccionados los nuevos. */
  function duplicate(viaKeyboard: boolean) {
    const list = byReading(selected);
    if (list.length === 0) return announce("Selecciona primero los lugares que quieres duplicar");
    if (zones.length + list.length > MAX_ZONES) {
      const left = MAX_ZONES - zones.length;
      const text =
        left > 0
          ? `No caben: duplicar ${list.length} lugares pasaría del máximo de ${MAX_ZONES} (quedan ${left}).`
          : `Ya hay ${MAX_ZONES} lugares, el máximo: quita uno para agregar otro.`;
      setNotice(text);
      announce(text);
      return;
    }
    const added: ImageZone[] = [];
    for (const i of list) {
      const z = zones[i];
      const p = { x: round4(clamp01(z.x + DUPLICATE_OFFSET)), y: round4(clamp01(z.y + DUPLICATE_OFFSET)) };
      const at = freeSpot(p, [...zones, ...added], aspect) ?? p;
      // La copia es otro lugar: clave nueva (la del original sigue con él)
      added.push({ x: at.x, y: at.y, elementId: z.elementId, key: newZoneKey([...zones, ...added]) });
    }
    const next = setConfig((c) =>
      c.zones.length + added.length > MAX_ZONES ? c : { ...c, zones: [...c.zones, ...added] }
    );
    const first = next.zones.length - added.length;
    if (next.zones[first] !== added[0]) return;
    pick(
      added.map((_, k) => first + k),
      next.zones
    );
    setNotice(null);
    const n = added.length;
    announce(n === 1 ? "Lugar duplicado: el nuevo queda seleccionado" : `${n} lugares duplicados: los nuevos quedan seleccionados`);
    if (viaKeyboard) focusAfter.current = `[data-zone="${first}"]`;
  }

  /** Quita estos lugares. */
  function remove(indices: number[], viaKeyboard: boolean) {
    if (indices.length === 0) return;
    const gone = new Set(indices);
    const next = setConfig((c) => ({ ...c, zones: c.zones.filter((_, j) => !gone.has(j)) }));
    setState({ of: next.zones, picked: [] });
    setNotice(null);
    const nums = indices.map((i) => numbers[i]).sort((a, b) => a - b);
    announce(nums.length === 1 ? `Lugar ${nums[0]} quitado` : `Lugares ${joinY(nums)} quitados`);
    // El botón desaparece: el foco vuelve a la foto para no perderse (y Ctrl+Z sigue a mano)
    if (viaKeyboard || boardNode?.contains(document.activeElement)) boardNode?.focus({ preventScroll: true });
  }

  /**
   * Empieza a arrastrarse un lugar. Si es parte de una selección de varios, se
   * mueve el grupo (true); si no, pasa a ser lo seleccionado y va solo (false).
   */
  function startDrag(i: number): boolean {
    if (selected.has(i) && selected.size > 1) {
      group.current = new Set(selected);
      setShift({ indices: group.current, dx: 0, dy: 0 });
      return true;
    }
    group.current = null;
    pick([i]);
    return false;
  }

  /** Lo arrastrado en grupo, en píxeles desde donde empezó, sobre la foto `rect`: con imán y sin salir de la foto. */
  const shiftFor = (indices: Set<number>, px: Point, rect: DOMRect) => {
    const raw = { dx: px.x / rect.width, dy: px.y / rect.height };
    const centers = zones.filter((_, j) => indices.has(j));
    const clamp = (d: { dx: number; dy: number }) => clampShift(centers, d.dx, d.dy);
    // El imán recorta antes de decidir qué guías se ven
    return snapShift ? snapShift(indices, raw, clamp) : clamp(raw);
  };

  /** El puntero se movió; false si no hay un grupo en la mano. */
  function dragGroup(px: Point, rect: DOMRect): boolean {
    const indices = group.current;
    if (!indices) return false;
    setShift({ indices, ...shiftFor(indices, px, rect) });
    return true;
  }

  /** Se soltó: el grupo queda donde iba (un paso del historial); false si no había grupo. */
  function dropGroup(px: Point, rect: DOMRect | undefined): boolean {
    const indices = group.current;
    group.current = null;
    setShift(null);
    if (!indices) return false;
    if (rect) {
      const d = shiftFor(indices, px, rect);
      moveBy([...indices], d.dx, d.dy);
    }
    return true;
  }

  function cancelDrag() {
    group.current = null;
    setShift(null);
  }

  /** Dónde se dibuja un lugar: movido, si va en el grupo que se arrastra. */
  function at(i: number): Point {
    const z = zones[i];
    return shift?.indices.has(i) ? { x: z.x + shift.dx, y: z.y + shift.dy } : z;
  }

  /**
   * Teclas del editor (en el editor y en la foto): Ctrl+A, Ctrl+D; sobre un
   * lugar, la foto o la raíz del editor, Supr y flechas; sobre un lugar,
   * Espacio. Nada mientras se escribe en un campo.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.defaultPrevented || e.altKey || isTypingTarget(e.target)) return;
    const target = e.target as HTMLElement;
    const zoneEl = target.closest<HTMLElement>("[data-zone]");
    const focused = zoneEl ? Number(zoneEl.dataset.zone) : null;
    // La foto o la raíz del editor (donde cae el foco con un clic en un hueco)
    const onSurface = (!!boardNode && target === boardNode) || target.hasAttribute("data-drag-editor");
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey) return;
      if (key === "a") {
        e.preventDefault();
        all();
      } else if (key === "d") {
        e.preventDefault();
        duplicate(focused !== null);
      }
      return;
    }
    if (focused === null && !onSurface) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      const indices = focused !== null && !selected.has(focused) ? [focused] : byReading(selected);
      if (indices.length === 0) return;
      e.preventDefault();
      remove(indices, true);
    } else if (ARROW_STEPS[e.key] && (focused !== null || selected.size > 0)) {
      e.preventDefault();
      e.stopPropagation();
      nudge(e.key, e.shiftKey, focused);
    } else if (e.key === " " && focused !== null) {
      // Espacio no «pulsa» el botón (eso lo dejaría solo a él): lo suma o lo quita
      e.preventDefault();
      toggle(focused, true);
    }
  }

  /** Espacio al soltarse sobre un lugar: tampoco «pulsa» el botón (en ningún navegador). */
  function onKeyUp(e: React.KeyboardEvent) {
    if (e.key === " " && !isTypingTarget(e.target) && (e.target as HTMLElement).closest("[data-zone]")) e.preventDefault();
  }

  return {
    selected,
    /** Hay un grupo en la mano. */
    groupDragging: shift !== null,
    clear,
    click,
    /** Solo este lugar queda seleccionado (sin alternar, como las flechas sobre uno que no lo estaba). */
    only: (i: number) => pick([i]),
    selectArea,
    duplicate,
    remove,
    startDrag,
    dragGroup,
    dropGroup,
    cancelDrag,
    at,
    onKeyDown,
    onKeyUp,
  };
}
