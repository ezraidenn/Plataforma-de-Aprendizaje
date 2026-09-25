"use client";

import { useEffect, useRef, useState } from "react";
import { TOUCH_AREA } from "@/components/exam/image-pieces";
import { moveCrop, resizeCrop, scaleCrop, type CropHandle, type CropRect } from "@/lib/photo-crop";
import { cn } from "@/lib/utils";

/**
 * El rectángulo del recorte sobre la foto del editor (en `ImageCanvas`, encima
 * de todo): lo de fuera oscurecido, tiradores en las esquinas y en los lados, y
 * el rectángulo mismo, que se arrastra entero. Con una proporción fija, las
 * esquinas la conservan (la de enfrente queda quieta) y los lados cambian
 * también el otro lado, desde el centro (`photo-crop.ts`). Esc a medio
 * arrastre lo deja como estaba; si no, cancela el recorte (eso lo atiende
 * `usePhotoTools`).
 *
 * Con teclado, el rectángulo toma el foco: las flechas lo mueven 1 % (Mayús:
 * 5 %), + y − lo agrandan o achican desde el centro y Enter aplica el recorte.
 * Sus teclas no llegan al editor: no mueven lugares ni deshacen.
 */

const HANDLES: { handle: CropHandle; at: string; cursor: string }[] = [
  { handle: "nw", at: "-left-2 -top-2 size-3", cursor: "nwse-resize" },
  { handle: "ne", at: "-right-2 -top-2 size-3", cursor: "nesw-resize" },
  { handle: "se", at: "-bottom-2 -right-2 size-3", cursor: "nwse-resize" },
  { handle: "sw", at: "-bottom-2 -left-2 size-3", cursor: "nesw-resize" },
  { handle: "n", at: "-top-1.5 left-1/2 h-2 w-6 -translate-x-1/2", cursor: "ns-resize" },
  { handle: "s", at: "-bottom-1.5 left-1/2 h-2 w-6 -translate-x-1/2", cursor: "ns-resize" },
  { handle: "e", at: "-right-1.5 top-1/2 h-6 w-2 -translate-y-1/2", cursor: "ew-resize" },
  { handle: "w", at: "-left-1.5 top-1/2 h-6 w-2 -translate-y-1/2", cursor: "ew-resize" },
];
const CURSOR = Object.fromEntries(HANDLES.map((h) => [h.handle, h.cursor])) as Record<CropHandle, string>;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
/** Paso de las flechas (fracción del ancho; en vertical, lo mismo en pantalla) y de + y −. */
const NUDGE = 0.01;
const NUDGE_BIG = 0.05;
const SIZE_STEP = 1.05;

const pct = (n: number) => `${n * 100}%`;

export function CropCover({
  rect,
  ratio,
  aspect,
  busy,
  onChange,
  onApply,
}: {
  rect: CropRect;
  /** Alto / ancho fijo (en píxeles), o null: libre. */
  ratio: number | null;
  /** Alto / ancho de la foto. */
  aspect: number;
  /** Se está aplicando: el rectángulo ya no se mueve. */
  busy: boolean;
  onChange: (rect: CropRect) => void;
  onApply: () => void;
}) {
  /** El arrastre en curso: qué se arrastra, desde dónde (px) y el rectángulo y el tamaño de la foto al empezar. */
  const drag = useRef<{ kind: CropHandle | "move"; pointer: number; x: number; y: number; start: CropRect; w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState<CropHandle | "move" | null>(null);
  /** Esc mientras dura el arrastre (se quita al terminar). */
  const escape = useRef<((e: KeyboardEvent) => void) | null>(null);

  const stop = () => {
    if (escape.current) window.removeEventListener("keydown", escape.current, true);
    escape.current = null;
    drag.current = null;
    setDragging(null);
  };
  useEffect(
    () => () => {
      if (escape.current) window.removeEventListener("keydown", escape.current, true);
    },
    []
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const kind = (e.target as HTMLElement).closest<HTMLElement>("[data-crop-handle]")?.dataset.cropHandle as
      | CropHandle
      | "move"
      | undefined;
    // Sobre lo oscurecido no pasa nada (ni llega a la foto)
    if (!kind || e.button !== 0 || busy || drag.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const start = rect;
    drag.current = { kind, pointer: e.pointerId, x: e.clientX, y: e.clientY, start, w: r.width, h: r.height };
    setDragging(kind);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el arrastre sigue mientras el puntero esté sobre la foto
    }
    // Esc deshace el arrastre y nada más (el recorte sigue abierto)
    escape.current = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      k.preventDefault();
      k.stopPropagation();
      onChange(start);
      stop();
    };
    window.addEventListener("keydown", escape.current, true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    // El botón se soltó sin que llegara el pointerup: el arrastre termina donde iba
    if (e.buttons === 0) return stop();
    const dx = (e.clientX - d.x) / d.w;
    const dy = (e.clientY - d.y) / d.h;
    onChange(d.kind === "move" ? moveCrop(d.start, dx, dy) : resizeCrop(d.start, d.kind, { dx, dy }, ratio, aspect));
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (drag.current && e.pointerId === drag.current.pointer) stop();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab") return;
    // Nada de esto es del editor (mover lugares, Supr, Ctrl+Z…)
    e.stopPropagation();
    if (busy || drag.current) return;
    const arrow = ARROWS[e.key];
    if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      onChange(moveCrop(rect, arrow[0] * step, (arrow[1] * step) / aspect));
    } else if ((e.key === "+" || e.key === "=" || e.key === "-") && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      onChange(scaleCrop(rect, e.key === "-" ? 1 / SIZE_STEP : SIZE_STEP));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onApply();
    }
  };

  const box = { left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) };
  return (
    <div
      data-crop-cover=""
      className="absolute inset-0 z-40 touch-none rounded-[inherit]"
      style={dragging ? { cursor: dragging === "move" ? "move" : CURSOR[dragging] } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      {/* Lo de fuera, oscurecido: una sombra enorme del rectángulo, recortada a la foto */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
        <div className="absolute shadow-[0_0_0_9999px_rgb(2_6_23/0.58)]" style={box} />
      </div>
      <div
        data-crop-box=""
        data-crop-handle="move"
        tabIndex={0}
        role="application"
        aria-roledescription="recorte"
        aria-label="Recorte de la foto: arrástralo o usa sus tiradores. Flechas: moverlo; + y −: agrandarlo o achicarlo; Enter: aplicar; Esc: cancelar"
        onKeyDown={onKeyDown}
        className={cn(
          "absolute border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45)] outline-none focus-visible:ring-4 focus-visible:ring-primary/60",
          busy ? "cursor-progress" : "cursor-move"
        )}
        style={box}
      >
        {/* Tercios: ayudan a encuadrar */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/45" />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/45" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/45" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/45" />
        {!busy &&
          HANDLES.map(({ handle, at, cursor }) => (
            <span
              key={handle}
              aria-hidden
              data-crop-handle={handle}
              className={cn("absolute rounded-[2px] bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]", TOUCH_AREA, at)}
              style={{ cursor }}
            />
          ))}
      </div>
    </div>
  );
}
