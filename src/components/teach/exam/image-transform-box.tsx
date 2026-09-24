"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useStableHandler } from "@/components/exam/image-dnd";
import { TOUCH_AREA } from "@/components/exam/image-pieces";
import {
  MIN_ICON_PX,
  TEXT_SIZE_RANGE,
  elementView,
  iconBoxPx,
  iconSizeRange,
  normalizeRotation,
  textPx,
  type Guide,
} from "@/lib/image-layout";
import { round4, type ImageElement } from "@/lib/image-questions";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "./use-editor-history";

/**
 * Caja de transformación del editor de «arrastrar a la imagen»: sobre un lugar
 * seleccionado (con lugares de un solo elemento), un marco índigo con cuatro
 * tiradores en las esquinas y una bolita arriba. Estirar desde una esquina
 * cambia el tamaño del elemento desde el centro, sin deformarlo (manda la
 * distancia del puntero al centro), con imán a las guías (Alt lo apaga); la
 * bolita lo gira (Mayús: de 15° en 15°). Cambia el elemento entero, como el
 * panel «Seleccionado», y cada gesto es un solo paso del historial. Con
 * teclado: + y − cambian el tamaño un 5 %, [ y ] giran 15°.
 */

type Kind = "stretch" | "turn";

export type TransformActions = {
  start: (kind: Kind) => void;
  /** `factor`: distancia del puntero al centro sobre la del principio. */
  stretch: (factor: number, altKey: boolean) => void;
  /** `delta`: grados girados desde el principio. */
  turn: (delta: number, shiftKey: boolean) => void;
  end: () => void;
  /** Un tirador pulsado con el teclado: se dice cómo usarlo. */
  help: (kind: Kind) => void;
};

/** Paso de + y − (proporción) y de [ y ] (grados). */
const SIZE_STEP = 1.05;
const TURN_STEP = 15;
/** Distancia (en diagonal, px) de la esquina de la ficha al centro de su tirador: el marco va 6 px por fuera. */
const FRAME_PAD = 6 * Math.SQRT2;

const CORNERS = [
  "-left-[11px] -top-[11px] cursor-nwse-resize",
  "-right-[11px] -top-[11px] cursor-nesw-resize",
  "-right-[11px] -bottom-[11px] cursor-nwse-resize",
  "-left-[11px] -bottom-[11px] cursor-nesw-resize",
];

const HANDLE = cn(
  "pointer-events-auto absolute touch-none border-[1.5px] border-primary bg-white shadow-sm outline-none",
  "focus-visible:ring-4 focus-visible:ring-primary/40",
  TOUCH_AREA
);

const clampTo = (n: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, n));
/** Fracción del ancho → porcentaje con un decimal (como el panel). */
const toPercent = (size: number) => Math.round(size * 1000) / 10;
/** El giro guardado (el panel deja −180 tal cual). */
const rawRotation = (e: ImageElement) => (typeof e.rotation === "number" && Number.isFinite(e.rotation) ? e.rotation : 0);

/** El marco con sus tiradores. Va dentro del lugar (en su `BoardSpot`), del tamaño de la ficha sin girar. */
export const TransformBox = memo(function TransformBox({
  rotation,
  readout,
  actions,
}: {
  rotation: number;
  /** El valor mientras dura el gesto («12.5 %», «30°»). */
  readout: string | null;
  actions: TransformActions;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ kind: Kind; pointer: number; cx: number; cy: number; d0: number; a0: number } | null>(null);

  // Si el marco desaparece a medio gesto (Esc, deshacer), el gesto se cierra igual: queda como un paso
  useEffect(
    () => () => {
      if (!drag.current) return;
      drag.current = null;
      actions.end();
    },
    [actions]
  );

  const angle = (x: number, y: number, c: { cx: number; cy: number }) => (Math.atan2(y - c.cy, x - c.cx) * 180) / Math.PI;

  const down = (kind: Kind) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !frame.current || drag.current) return;
    // Girar no mueve el centro: el del marco (girado o no) es el de la ficha
    const r = frame.current.getBoundingClientRect();
    const c = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    drag.current = {
      kind,
      pointer: e.pointerId,
      ...c,
      d0: Math.max(4, Math.hypot(e.clientX - c.cx, e.clientY - c.cy)),
      a0: angle(e.clientX, e.clientY, c),
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el gesto sigue mientras el puntero esté sobre el tirador
    }
    actions.start(kind);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (d.kind === "stretch") {
      // El tirador está a FRAME_PAD de la esquina de la ficha, y ese tramo no crece: así sigue al puntero
      const pad = Math.min(FRAME_PAD, d.d0 / 2);
      actions.stretch(Math.max(0, Math.hypot(e.clientX - d.cx, e.clientY - d.cy) - pad) / (d.d0 - pad), e.altKey);
    } else actions.turn(angle(e.clientX, e.clientY, d) - d.a0, e.shiftKey);
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    actions.end();
  };
  const gesture = (kind: Kind) => ({
    onPointerDown: down(kind),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
    onLostPointerCapture: up,
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) actions.help(kind);
    },
  });

  const turn = rotation ? { transform: `rotate(${rotation}deg)` } : undefined;
  const upright = rotation ? { transform: `rotate(${-rotation}deg)` } : undefined;
  return (
    <span data-transform="" className="pointer-events-none absolute inset-0" style={turn}>
      <span ref={frame} aria-hidden className="absolute -inset-1.5 rounded-[3px] border-[1.5px] border-primary" />
      {CORNERS.map((corner, k) => (
        <button
          key={corner}
          type="button"
          aria-label="Estirar"
          aria-keyshortcuts="+ -"
          title="Estirar o encoger desde el centro (teclado: + y −; Alt apaga el imán)"
          // Uno solo en el orden de Tab: los cuatro hacen lo mismo
          tabIndex={k === 0 ? 0 : -1}
          className={cn(HANDLE, "size-2.5 rounded-[2px]", corner)}
          {...gesture("stretch")}
        />
      ))}
      <span aria-hidden className="absolute -top-[22px] left-1/2 -ml-[0.75px] h-4 border-l-[1.5px] border-primary" />
      <button
        type="button"
        aria-label="Girar"
        aria-keyshortcuts="[ ]"
        title="Girar (Mayús: de 15° en 15°; teclado: [ y ])"
        className={cn(HANDLE, "-top-[34px] left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full active:cursor-grabbing")}
        {...gesture("turn")}
      />
      {readout && (
        <span className="absolute left-1/2 top-full mt-3 -translate-x-1/2" style={upright}>
          <span className="block whitespace-nowrap rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow">
            {readout}
          </span>
        </span>
      )}
    </span>
  );
});

/**
 * Lo que hacen los tiradores y las teclas sobre `element` (el único elemento
 * de la selección), con el marco en su lugar `target`.
 */
export function useTransformTool({
  element,
  target,
  boardNode,
  boardWidth,
  aspect,
  measure,
  change,
  gesture,
  snap,
  announce,
}: {
  element: ImageElement | null;
  target: number | null;
  boardNode: HTMLElement | null;
  boardWidth: number;
  aspect: number;
  /** Tamaño sin girar del lugar, en fracciones del ancho de la foto. */
  measure: (i: number) => { w: number; h: number } | null;
  /** Cambia el elemento (todos sus lugares). */
  change: (id: string, patch: Pick<ImageElement, "size" | "rotation">) => void;
  gesture: { begin: () => void; commit: () => void };
  snap: {
    snapStretch: (i: number, rel: { w: number; h: number }, altKey: boolean) => { scale: number; guides: Guide[] } | null;
    showGuides: (guides: Guide[]) => void;
    end: () => void;
  };
  announce: (text: string) => void;
}) {
  const [readout, setReadout] = useState<string | null>(null);
  /** El gesto en curso: cómo estaba todo al empezar. */
  const open = useRef<{
    kind: Kind;
    id: string;
    index: number;
    size: number;
    rotation: number;
    /** Tamaño que se ve (con el mínimo legible) y su caja sin girar. */
    shown: number;
    rel: { w: number; h: number };
    icon: boolean;
    ratio: number;
    range: readonly [number, number];
    last: string;
  } | null>(null);

  const rangeOf = (icon: boolean) => (icon ? iconSizeRange(aspect) : TEXT_SIZE_RANGE);

  const start = useStableHandler((kind: Kind) => {
    const rel = target !== null ? measure(target) : null;
    if (!element || target === null || !rel || boardWidth <= 0) return;
    const view = elementView(element);
    const icon = view.kind === "icon";
    const rotation = rawRotation(element);
    open.current = {
      kind,
      id: element.id,
      index: target,
      size: view.size,
      rotation,
      shown: icon ? Math.max(view.size, MIN_ICON_PX / boardWidth) : textPx(view.size, boardWidth) / boardWidth,
      rel,
      icon,
      ratio: view.ratio,
      range: rangeOf(icon),
      last: kind === "stretch" ? `${toPercent(view.size)} %` : `${Math.round(rotation)}°`,
    };
    gesture.begin();
    setReadout(open.current.last);
  });

  const stretch = useStableHandler((factor: number, altKey: boolean) => {
    const g = open.current;
    if (!g || g.kind !== "stretch") return;
    let size = clampTo(g.shown * factor, g.range);
    // La caja al tamaño nuevo: la del ícono sale de su tamaño; la de la etiqueta crece con su letra
    const relAt = (s: number) => {
      if (g.icon) {
        const { w, h } = iconBoxPx(s, g.ratio, boardWidth);
        return { w: w / boardWidth, h: h / boardWidth };
      }
      const k = textPx(s, boardWidth) / (g.shown * boardWidth);
      return { w: g.rel.w * k, h: g.rel.h * k };
    };
    const snapped = snap.snapStretch(g.index, relAt(size), altKey);
    let guides: Guide[] = [];
    if (snapped) {
      const pulled = clampTo(size * snapped.scale, g.range);
      // Si el tope no deja llegar a la guía, no se dibuja
      if (Math.abs(pulled - size * snapped.scale) < 1e-9) guides = snapped.guides;
      size = pulled;
    }
    snap.showGuides(guides);
    size = round4(size);
    change(g.id, { size });
    g.last = `${toPercent(size)} %`;
    setReadout(g.last);
  });

  const turn = useStableHandler((delta: number, shiftKey: boolean) => {
    const g = open.current;
    if (!g || g.kind !== "turn") return;
    let r = g.rotation + delta;
    if (shiftKey) r = Math.round(r / TURN_STEP) * TURN_STEP;
    r = normalizeRotation(Math.round(r));
    change(g.id, { rotation: r });
    g.last = `${r}°`;
    setReadout(g.last);
  });

  const end = useStableHandler(() => {
    const g = open.current;
    open.current = null;
    gesture.commit();
    snap.end();
    setReadout(null);
    if (g) announce(g.kind === "stretch" ? `Tamaño: ${g.last} del ancho de la foto` : `Giro: ${g.last}`);
  });

  const help = useStableHandler((kind: Kind) =>
    announce(
      kind === "stretch"
        ? "Para cambiar el tamaño: + lo agranda y − lo achica un 5 %. Con el ratón, arrastra una esquina."
        : "Para girar: ] gira 15° a la derecha y [ a la izquierda. Con el ratón, arrastra la bolita."
    )
  );

  const actions = useMemo<TransformActions>(() => ({ start, stretch, turn, end, help }), [start, stretch, turn, end, help]);

  /** + − [ ]: sobre un lugar, la foto, el editor o un tirador. true si la atendió. */
  function onKeyDown(e: React.KeyboardEvent): boolean {
    if (!element || target === null || e.defaultPrevented || isTypingTarget(e.target)) return false;
    // Ctrl + y Ctrl − son el zoom del navegador (AltGr, que en Windows es Ctrl+Alt, sí cuenta)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) return false;
    const el = e.target as HTMLElement;
    const here = !!el.closest("[data-zone], [data-transform]") || el === boardNode || el.hasAttribute("data-drag-editor");
    if (!here) return false;
    const view = elementView(element);
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      const grow = e.key !== "-";
      const size = round4(clampTo(grow ? view.size * SIZE_STEP : view.size / SIZE_STEP, rangeOf(view.kind === "icon")));
      if (size === view.size) {
        announce(grow ? "Ya está en el tamaño máximo" : "Ya está en el tamaño mínimo");
        return true;
      }
      change(element.id, { size });
      announce(`Tamaño: ${toPercent(size)} % del ancho de la foto`);
      return true;
    }
    if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      const r = normalizeRotation(Math.round(rawRotation(element) + (e.key === "]" ? TURN_STEP : -TURN_STEP)));
      change(element.id, { rotation: r });
      announce(`Giro: ${r}°`);
      return true;
    }
    return false;
  }

  return { actions, readout, onKeyDown };
}
