"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStableHandler } from "@/components/exam/image-dnd";
import { TOUCH_AREA } from "@/components/exam/image-pieces";
import { MIN_ICON_PX, elementView, iconBoxPx, iconSizeRange, textPx, type Guide } from "@/lib/image-layout";
import { TEXT_SIZE_RANGE, clamp, normalizeRotation, round4, type ImageElement } from "@/lib/image-questions";
import { cn } from "@/lib/utils";
import { OUTSIDE, placement, type Placement } from "./transform-box-placement";
import { isTypingTarget } from "./use-editor-history";

/**
 * Caja de transformación del editor de «arrastrar a la imagen»: sobre un lugar
 * seleccionado (con lugares de un solo elemento), un marco índigo con cuatro
 * tiradores en las esquinas y una bolita arriba. Estirar desde una esquina
 * cambia el tamaño del elemento desde el centro, sin deformarlo (manda la
 * distancia del puntero al centro), con imán a las guías (Alt lo apaga); la
 * bolita lo gira (Mayús: de 15° en 15°). Cambia el elemento entero, como el
 * panel «Seleccionado». Cada gesto es un solo paso del historial (ninguno si
 * al final todo quedó igual) y Esc a medio gesto lo deshace. Con teclado: + y
 * − cambian el tamaño un 5 %, [ y ] giran 15° (sobre un lugar sin seleccionar,
 * ese pasa a ser la selección, como con las flechas).
 *
 * Sin `aria-keyshortcuts`: esas teclas cambian de lugar con la distribución
 * del teclado (en el español, [ y ] van con AltGr), así que se dicen en el
 * título y al pulsar el tirador con el teclado.
 *
 * La bolita va sobre el marco y la lectura del valor debajo, si caben en el
 * lienzo; con un lugar pegado a la orilla se acomodan de otro modo
 * (`transform-box-placement.ts`).
 */

type Kind = "stretch" | "turn";

export type TransformActions = {
  start: (kind: Kind) => void;
  /** `factor`: distancia del puntero al centro sobre la del principio. */
  stretch: (factor: number, altKey: boolean) => void;
  /** `delta`: grados girados desde el principio. */
  turn: (delta: number, shiftKey: boolean) => void;
  end: () => void;
  /** Esc a medio gesto: todo vuelve a como estaba. */
  cancel: () => void;
  /** Un tirador pulsado con el teclado: se dice cómo usarlo. */
  help: (kind: Kind) => void;
};

/** Paso de + y − (proporción) y de [ y ] (grados). */
const SIZE_STEP = 1.05;
const TURN_STEP = 15;
/** Distancia (en diagonal, px) de la esquina de la ficha al centro de su tirador: el marco va 6 px por fuera. */
const FRAME_PAD = 6 * Math.SQRT2;

/** Esquinas: dónde va el tirador y hacia dónde apunta desde el centro. */
const CORNERS = [
  { at: "-left-[11px] -top-[11px]", dx: -1, dy: -1 },
  { at: "-right-[11px] -top-[11px]", dx: 1, dy: -1 },
  { at: "-right-[11px] -bottom-[11px]", dx: 1, dy: 1 },
  { at: "-left-[11px] -bottom-[11px]", dx: -1, dy: 1 },
];
const CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];

/** Cursor de una esquina con el marco girado: la flecha de doble punta más cercana a su dirección. */
function cornerCursor(dx: number, dy: number, rotation: number): string {
  const a = (Math.atan2(dy, dx) * 180) / Math.PI + rotation;
  return CURSORS[Math.round((((a % 180) + 180) % 180) / 45) % 4];
}

const HANDLE = cn(
  "pointer-events-auto absolute touch-none border-[1.5px] border-primary bg-white shadow-sm outline-none",
  "focus-visible:ring-4 focus-visible:ring-primary/40",
  TOUCH_AREA
);

/** Fracción del ancho → porcentaje con un decimal (como el panel). */
const toPercent = (size: number) => Math.round(size * 1000) / 10;
/** El giro guardado (el panel deja −180 tal cual). */
const rawRotation = (e: ImageElement) => (typeof e.rotation === "number" && Number.isFinite(e.rotation) ? e.rotation : 0);

/** El marco con sus tiradores. Va dentro del lugar (en su `BoardSpot`), del tamaño de la ficha sin girar. */
export const TransformBox = memo(function TransformBox({
  rotation,
  readout,
  actions,
  layout,
}: {
  rotation: number;
  /** El valor mientras dura el gesto («12.5 %», «30°»). */
  readout: string | null;
  actions: TransformActions;
  /** Cambia si la ficha se mueve o cambia de tamaño (o la foto, con el zoom): se vuelve a ver dónde cabe la bolita. */
  layout: string;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<Placement>(OUTSIDE);
  useLayoutEffect(() => {
    const next = placement(box.current, rotation);
    setPlace((prev) => (prev.knob === next.knob && prev.readout === next.readout && prev.far === next.far ? prev : next));
  }, [rotation, layout]);
  const drag = useRef<{
    kind: Kind;
    pointer: number;
    handle: HTMLElement;
    cx: number;
    cy: number;
    d0: number;
    a0: number;
  } | null>(null);
  /** Esc mientras dura el gesto (se quita al terminar). */
  const escape = useRef<((e: KeyboardEvent) => void) | null>(null);

  const stopListening = () => {
    if (escape.current) window.removeEventListener("keydown", escape.current, true);
    escape.current = null;
  };

  // Si el marco desaparece a medio gesto (deshacer, otra selección), el gesto se cierra igual: queda como un paso
  useEffect(
    () => () => {
      if (escape.current) window.removeEventListener("keydown", escape.current, true);
      escape.current = null;
      if (!drag.current) return;
      drag.current = null;
      actions.end();
    },
    [actions]
  );

  const angle = (x: number, y: number, c: { cx: number; cy: number }) => (Math.atan2(y - c.cy, x - c.cx) * 180) / Math.PI;

  /**
   * Termina el gesto. Tras Esc el botón sigue apretado: el tirador conserva el
   * puntero hasta que se suelte (y no hace nada con él), así el clic al soltar
   * no cae en la foto, que soltaría la selección.
   */
  const finish = (how: "end" | "cancel") => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    stopListening();
    if (how === "end") {
      try {
        if (d.handle.hasPointerCapture(d.pointer)) d.handle.releasePointerCapture(d.pointer);
      } catch {
        // Ya no la tenía
      }
    }
    actions[how]();
  };

  const down = (kind: Kind) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !frame.current || drag.current) return;
    // Girar no mueve el centro: el del marco (girado o no) es el de la ficha
    const r = frame.current.getBoundingClientRect();
    const c = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    drag.current = {
      kind,
      pointer: e.pointerId,
      handle: e.currentTarget,
      ...c,
      d0: Math.max(4, Math.hypot(e.clientX - c.cx, e.clientY - c.cy)),
      a0: angle(e.clientX, e.clientY, c),
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el gesto sigue mientras el puntero esté sobre el tirador
    }
    // Esc deshace el gesto y nada más (no suelta la selección)
    escape.current = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      k.preventDefault();
      k.stopPropagation();
      finish("cancel");
    };
    window.addEventListener("keydown", escape.current, true);
    actions.start(kind);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    // El botón se soltó sin que llegara el pointerup (Alt+Tab, captura perdida): el gesto termina
    if (e.buttons === 0) return finish("end");
    if (d.kind === "stretch") {
      // El tirador está a FRAME_PAD de la esquina de la ficha, y ese tramo no crece: así sigue al puntero
      const pad = Math.min(FRAME_PAD, d.d0 / 2);
      actions.stretch(Math.max(0, Math.hypot(e.clientX - d.cx, e.clientY - d.cy) - pad) / (d.d0 - pad), e.altKey);
    } else actions.turn(angle(e.clientX, e.clientY, d) - d.a0, e.shiftKey);
  };
  const up = (e: React.PointerEvent) => {
    if (drag.current && e.pointerId === drag.current.pointer) finish("end");
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
  const inside = place.knob === "inside";
  return (
    <span
      ref={box}
      data-transform=""
      // Con la bolita dentro, la caja va sobre la ficha (si no, la ficha taparía la bolita)
      className={cn("pointer-events-none absolute inset-0", inside && "z-[2]")}
      style={turn}
    >
      <span ref={frame} aria-hidden className="absolute -inset-1.5 rounded-[3px] border-[1.5px] border-primary" />
      {CORNERS.map(({ at, dx, dy }, k) => (
        <button
          key={at}
          type="button"
          aria-label="Estirar"
          title="Estirar o encoger desde el centro (teclado: + y −; Alt apaga el imán)"
          // Uno solo en el orden de Tab y para el lector de pantalla: los cuatro hacen lo mismo
          tabIndex={k === 0 ? 0 : -1}
          aria-hidden={k === 0 ? undefined : true}
          className={cn(HANDLE, "size-2.5 rounded-[2px]", at)}
          style={{ cursor: cornerCursor(dx, dy, rotation) }}
          {...gesture("stretch")}
        />
      ))}
      {!inside && (
        <span
          aria-hidden
          className={cn(
            "absolute left-1/2 -ml-[0.75px] h-4 border-l-[1.5px] border-primary",
            place.knob === "above" ? "-top-[22px]" : "-bottom-[22px]"
          )}
        />
      )}
      <button
        type="button"
        aria-label="Girar"
        title="Girar (Mayús: de 15° en 15°; teclado: [ y ])"
        data-knob={place.knob}
        className={cn(
          HANDLE,
          "left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full active:cursor-grabbing",
          place.knob === "above" ? "-top-[34px]" : place.knob === "below" ? "-bottom-[34px]" : "top-1"
        )}
        {...gesture("turn")}
      />
      {readout && (
        <span
          data-readout={place.far ? `${place.readout}-lejos` : place.readout}
          className={cn(
            "absolute left-1/2 -translate-x-1/2",
            place.readout === "below" && (place.far ? "top-full mt-[42px]" : "top-full mt-3"),
            place.readout === "above" && (place.far ? "bottom-full mb-[42px]" : "bottom-full mb-3"),
            place.readout === "inside" && "top-1/2 -translate-y-1/2"
          )}
          style={upright}
        >
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
  several,
  keyTarget,
  boardNode,
  boardWidth,
  aspect,
  measure,
  change,
  nameOf,
  gesture,
  snap,
  announce,
}: {
  element: ImageElement | null;
  target: number | null;
  /** La selección tiene lugares de varios elementos: + − [ ] no aplican. */
  several: boolean;
  /** + − [ ] con el foco en el lugar `zone` (o fuera de un lugar, null): el elemento al que tocan. Un lugar sin seleccionar pasa a ser la selección. */
  keyTarget: (zone: number | null) => ImageElement | null;
  boardNode: HTMLElement | null;
  boardWidth: number;
  aspect: number;
  /** Tamaño sin girar del lugar, en fracciones del ancho de la foto. */
  measure: (i: number) => { w: number; h: number } | null;
  /** Cambia el elemento (todos sus lugares). */
  change: (id: string, patch: Pick<ImageElement, "size" | "rotation">) => void;
  /** Nombre del elemento para decirlo («Ícono 2», o el texto de la etiqueta). */
  nameOf: (id: string) => string;
  gesture: { begin: () => void; commit: () => void; cancel: () => void };
  snap: {
    snapStretch: (i: number, rel: { w: number; h: number }, altKey: boolean) => { scale: number; guides: Guide[] } | null;
    showGuides: (guides: Guide[]) => void;
    end: () => void;
  };
  announce: (text: string) => void;
}) {
  const [readout, setReadout] = useState<string | null>(null);
  /** El gesto en curso: cómo estaba todo al empezar y lo último que se aplicó. */
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
    now: { size: number; rotation: number };
  } | null>(null);

  const rangeOf = (icon: boolean) => (icon ? iconSizeRange(aspect) : TEXT_SIZE_RANGE);
  const sizeSaid = (id: string, size: number) => `${nameOf(id)}: ${toPercent(size)} % del ancho de la foto`;
  const turnSaid = (id: string, r: number) => `${nameOf(id)}: giro de ${r}°`;

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
      now: { size: view.size, rotation },
    };
    gesture.begin();
    setReadout(kind === "stretch" ? `${toPercent(view.size)} %` : `${Math.round(rotation)}°`);
  });

  const stretch = useStableHandler((factor: number, altKey: boolean) => {
    const g = open.current;
    if (!g || g.kind !== "stretch") return;
    let size = clamp(g.shown * factor, ...g.range);
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
      const pulled = clamp(size * snapped.scale, ...g.range);
      // Si el tope no deja llegar a la guía, no se dibuja
      if (Math.abs(pulled - size * snapped.scale) < 1e-9) guides = snapped.guides;
      size = pulled;
    }
    snap.showGuides(guides);
    size = round4(size);
    // Un temblor que no cambia el tamaño no toca nada
    if (size === g.now.size) return;
    g.now.size = size;
    change(g.id, { size });
    setReadout(`${toPercent(size)} %`);
  });

  const turn = useStableHandler((delta: number, shiftKey: boolean) => {
    const g = open.current;
    if (!g || g.kind !== "turn") return;
    let r = g.rotation + delta;
    if (shiftKey) r = Math.round(r / TURN_STEP) * TURN_STEP;
    r = normalizeRotation(Math.round(r));
    // Con Mayús, moverse dentro del mismo múltiplo de 15° no toca nada
    if (r === normalizeRotation(g.now.rotation)) return;
    g.now.rotation = r;
    change(g.id, { rotation: r });
    setReadout(`${r}°`);
  });

  const end = useStableHandler(() => {
    const g = open.current;
    open.current = null;
    snap.end();
    setReadout(null);
    // Si al final todo quedó como estaba (se estiró y se volvió), no queda paso en el historial
    const same = !g || (g.now.size === g.size && normalizeRotation(g.now.rotation) === normalizeRotation(g.rotation));
    if (same) gesture.cancel();
    else gesture.commit();
    if (g && !same) announce(g.kind === "stretch" ? sizeSaid(g.id, g.now.size) : turnSaid(g.id, g.now.rotation));
  });

  const cancel = useStableHandler(() => {
    const g = open.current;
    open.current = null;
    gesture.cancel();
    snap.end();
    setReadout(null);
    if (g) announce(g.kind === "stretch" ? "Estirar cancelado" : "Giro cancelado");
  });

  const help = useStableHandler((kind: Kind) =>
    announce(
      kind === "stretch"
        ? "Para cambiar el tamaño: + lo agranda y − lo achica un 5 %. Con el ratón, arrastra una esquina."
        : "Para girar: ] gira 15° a la derecha y [ a la izquierda. Con el ratón, arrastra la bolita."
    )
  );

  const actions = useMemo<TransformActions>(
    () => ({ start, stretch, turn, end, cancel, help }),
    [start, stretch, turn, end, cancel, help]
  );

  /** + − [ ]: sobre un lugar, la foto, el editor o un tirador. true si la atendió. */
  function onKeyDown(e: React.KeyboardEvent): boolean {
    const sizeKey = e.key === "+" || e.key === "=" || e.key === "-";
    const turnKey = e.key === "[" || e.key === "]";
    if ((!sizeKey && !turnKey) || e.defaultPrevented || isTypingTarget(e.target)) return false;
    // Ctrl + y Ctrl − son el zoom del navegador (AltGr, que en Windows es Ctrl+Alt, sí cuenta)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) return false;
    const el = e.target as HTMLElement;
    const zone = el.closest<HTMLElement>("[data-zone]");
    const here = !!zone || !!el.closest("[data-transform]") || el === boardNode || el.hasAttribute("data-drag-editor");
    if (!here) return false;
    // Sobre un lugar sin seleccionar, ese pasa a ser la selección: se cambia lo que tiene el foco
    const subject = keyTarget(zone ? Number(zone.dataset.zone) : null);
    if (!subject) {
      if (!several) return false;
      e.preventDefault();
      announce("El tamaño y el giro son de cada elemento: selecciona lugares de uno solo");
      return true;
    }
    e.preventDefault();
    const view = elementView(subject);
    if (sizeKey) {
      const grow = e.key !== "-";
      const size = round4(clamp(grow ? view.size * SIZE_STEP : view.size / SIZE_STEP, ...rangeOf(view.kind === "icon")));
      if (size === view.size) {
        announce(`${nameOf(subject.id)}: ya está en el tamaño ${grow ? "máximo" : "mínimo"}`);
        return true;
      }
      change(subject.id, { size });
      announce(sizeSaid(subject.id, size));
      return true;
    }
    const r = normalizeRotation(Math.round(rawRotation(subject) + (e.key === "]" ? TURN_STEP : -TURN_STEP)));
    change(subject.id, { rotation: r });
    announce(turnSaid(subject.id, r));
    return true;
  }

  return { actions, readout, onKeyDown };
}
