"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoardCursor, BoardSpot, SpotArea, useCrosshair } from "@/components/exam/image-board";
import { DropVeil, useFileDrop } from "@/components/exam/image-dnd";
import { gridStepFor } from "@/lib/image-layout";
import { plural } from "@/lib/plural";
import {
  MAX_SPOTS,
  PRECISION_RADIUS,
  clamp01,
  fileUrl,
  readingNumbers,
  round4,
  type ImageClickConfig,
  type Point,
} from "@/lib/image-questions";
import { cn } from "@/lib/utils";
import { ImageCanvas } from "./image-canvas";
import { CanvasToolbar, useCanvasPrefs } from "./image-canvas-toolbar";
import { CROP_HINT, type PhotoTools } from "./image-photo-tools";
import { crosshairKeys, revealSoon, useCanvasZoom } from "./use-canvas-zoom";
import type { HistoryOptions } from "./use-editor-history";
import { useSpotDrag } from "./use-spot-drag";

/**
 * «Señalar en la imagen» en el editor del maestro, sobre el mismo lienzo que
 * «arrastrar» (zoom, reglas, cuadrícula y guías) y con su barra: Deshacer y
 * Rehacer, Imán, Reglas, Cuadrícula, zoom y la foto (recortar, girar,
 * cambiar: los puntos se recolocan solos). Clic en la foto marca un punto
 * correcto; arrastrar un punto lo mueve (con imán a la línea de otros puntos,
 * a los bordes y el centro de la foto y a la cuadrícula) y un clic en él sin
 * moverlo lo quita. Con teclado: en la foto, flechas y Enter marcan (la mira);
 * sobre un punto, las flechas lo mueven 0.5 % (Mayús: 5 %) y Supr lo quita.
 * Cada punto dibuja su círculo de acierto según la precisión. Todo cambio pasa
 * por el historial del editor. Soltar un archivo sobre la foto la cambia.
 */

/** Pasos de las flechas sobre un punto: fracción del ancho (el vertical se corrige con la proporción). */
const NUDGE = 0.005;
const NUDGE_BIG = 0.05;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function ClickEditor({
  imageFileId,
  aspect,
  config,
  setConfig,
  history,
  photo,
  uploading,
  setNotice,
  announce,
  onPhotoFile,
}: {
  imageFileId: string;
  /** Alto / ancho de la foto (una cualquiera mientras se mide). */
  aspect: number;
  config: ImageClickConfig;
  /** Cambia la config (un paso del historial) y devuelve la nueva. */
  setConfig: (fn: (c: ImageClickConfig) => ImageClickConfig, options?: HistoryOptions) => ImageClickConfig;
  /** Deshacer y Rehacer, para la barra. */
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  /** Recortar, girar y cambiar la foto (la barra y el rectángulo del recorte). */
  photo: PhotoTools;
  uploading: boolean;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  /** Un archivo soltado sobre la foto la cambia. */
  onPhotoFile: (file: File) => void;
}) {
  const [boardNode, setBoardNode] = useState<HTMLDivElement | null>(null);
  const { prefs, toggle } = useCanvasPrefs();
  const zoom = useCanvasZoom({ rulers: prefs.rulers });
  const grid = prefs.grid ? gridStepFor(zoom.zoom) : null;
  const { spots } = config;
  const numbers = useMemo(() => readingNumbers(spots, aspect), [spots, aspect]);
  /** Índices de los puntos en orden de lectura: el orden de Tab. */
  const ordered = useMemo(() => spots.map((_, i) => i).sort((a, b) => numbers[a] - numbers[b]), [spots, numbers]);
  const full = spots.length >= MAX_SPOTS;
  /** El punto con el foco: lo marcan las reglas. */
  const [focused, setFocused] = useState<number | null>(null);
  /** El punto que debe conservar el foco tras moverse (su botón puede cambiar de sitio en el orden). */
  const focusAfter = useRef<number | null>(null);
  const crosshair = useCrosshair(aspect, (p) => addSpot(p));
  const boardDrop = useFileDrop(onPhotoFile, !uploading);
  const drag = useSpotDrag({ spots, boardNode, magnet: prefs.magnet, grid, onDrop: moveSpot });

  useEffect(() => {
    const i = focusAfter.current;
    if (i === null) return;
    focusAfter.current = null;
    const el = boardNode?.querySelector<HTMLElement>(`[data-spot="${i}"]`);
    if (el && document.activeElement !== el) el.focus();
  });

  function addSpot(p: Point) {
    crosshair.setCursor(p);
    if (full) {
      const text = `Ya marcaste ${MAX_SPOTS} puntos, el máximo: quita uno para marcar otro.`;
      setNotice(text);
      announce(text);
      return;
    }
    const spot = { x: round4(p.x), y: round4(p.y) };
    setConfig((c) => (c.spots.length >= MAX_SPOTS ? c : { ...c, spots: [...c.spots, spot] }));
    setNotice(null);
    announce(`Punto ${readingNumbers([...spots, spot], aspect)[spots.length]} marcado`);
  }

  function removeSpot(i: number, viaKeyboard: boolean) {
    setConfig((c) => ({ ...c, spots: c.spots.filter((_, j) => j !== i) }));
    setNotice(null);
    announce(`Punto ${numbers[i]} quitado`);
    // El botón desaparece: el foco vuelve a la foto para no perderse (y Ctrl+Z sigue a mano)
    if (viaKeyboard || boardNode?.contains(document.activeElement)) boardNode?.focus({ preventScroll: true });
  }

  /** Un punto soltado en otro sitio: un paso del historial. */
  function moveSpot(i: number, p: Point) {
    const next = setConfig((c) => (c.spots[i] ? { ...c, spots: c.spots.map((s, j) => (j === i ? p : s)) } : c));
    setNotice(null);
    announce(`Punto ${readingNumbers(next.spots, aspect)[i]} movido`);
    focusAfter.current = i;
  }

  /** Flechas sobre un punto: lo mueven; seguidas sobre el mismo punto, un solo paso para deshacer. */
  function nudge(i: number, key: string, big: boolean) {
    const [sx, sy] = ARROWS[key];
    const d = big ? NUDGE_BIG : NUDGE;
    setConfig(
      (c) => {
        const s = c.spots[i];
        if (!s) return c;
        const x = round4(clamp01(s.x + sx * d));
        const y = round4(clamp01(s.y + (sy * d) / aspect));
        return x === s.x && y === s.y ? c : { ...c, spots: c.spots.map((q, j) => (j === i ? { x, y } : q)) };
      },
      { coalesce: `punto:${i}` }
    );
    focusAfter.current = i;
    // Con zoom, si sale de la vista se lleva a ella
    revealSoon(boardNode, `[data-spot="${i}"]`);
  }

  // Reglas: el punto que va en la mano o el que tiene el foco
  const rulerMark = drag.moving?.at ?? (focused !== null ? (spots[focused] ?? null) : null);
  const n = spots.length;
  return (
    <div
      // Un clic en un hueco deja aquí el foco: Ctrl+Z sigue a mano
      tabIndex={-1}
      role="group"
      aria-label="Puntos en la foto"
      data-click-editor=""
      className="min-w-0 space-y-2 outline-none"
    >
      <CanvasToolbar
        history={history}
        prefs={prefs}
        onToggle={toggle}
        zoom={zoom}
        photo={photo}
        what="puntos"
        announce={announce}
      />
      <ImageCanvas
        ref={setBoardNode}
        zoom={zoom}
        imageUrl={fileUrl(imageFileId)}
        aspect={aspect}
        rulers={prefs.rulers}
        rulerMark={rulerMark}
        grid={grid}
        guides={drag.guides}
        cover={photo.cover}
        onPointer={(p) => addSpot(p)}
        tabIndex={0}
        role="application"
        aria-label="Foto: mueve la mira con las flechas y pulsa Enter para marcar un punto correcto"
        onKeyDown={(e) => crosshairKeys(e, crosshair.onKeyDown, boardNode)}
        onFocus={(e) => {
          const spot = (e.target as HTMLElement).closest<HTMLElement>("[data-spot]");
          setFocused(spot ? Number(spot.dataset.spot) : null);
        }}
        onBlur={() => setFocused(null)}
        {...boardDrop.dropProps}
        className={cn(
          "group outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
          full ? "cursor-default" : "cursor-crosshair"
        )}
      >
        <BoardCursor x={crosshair.cursor.x} y={crosshair.cursor.y} />
        {ordered.map((i) => {
          const at = drag.at(i);
          return <SpotArea key={`a${i}`} x={at.x} y={at.y} radius={PRECISION_RADIUS[config.precision]} />;
        })}
        {ordered.map((i) => {
          const at = drag.at(i);
          return (
            <BoardSpot key={`p${i}`} x={at.x} y={at.y} className={drag.moving?.index === i ? "z-20" : "z-10"}>
              <button
                type="button"
                data-spot={i}
                aria-label={`Punto ${numbers[i]}: pulsa para quitarlo; las flechas lo mueven`}
                title="Clic: quitar este punto. Arrástralo para moverlo (Alt apaga el imán)"
                {...drag.handlers(i)}
                onClick={(e) => {
                  if (!drag.consumeClick(e.detail === 0)) removeSpot(i, e.detail === 0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Delete" || e.key === "Backspace") {
                    e.preventDefault();
                    removeSpot(i, true);
                  } else if (ARROWS[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    nudge(i, e.key, e.shiftKey);
                  }
                }}
                className="flex size-[22px] cursor-grab touch-none items-center justify-center rounded-full bg-success text-[11px] font-bold text-white shadow-md ring-2 ring-white outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-4 focus-visible:ring-primary/40 active:cursor-grabbing motion-reduce:transition-none"
              >
                {numbers[i]}
              </button>
            </BoardSpot>
          );
        })}
        <DropVeil show={boardDrop.over} text="Suelta la foto para cambiarla (los puntos se conservan)" />
      </ImageCanvas>
      <p className="text-xs text-muted-foreground">
        {photo.crop
          ? CROP_HINT
          : "Haz clic en la foto para marcar cada punto correcto; arrastra un punto para moverlo y haz clic en él para quitarlo. El círculo verde es el margen: cuenta cualquier clic del alumno que caiga dentro."}
      </p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {n} de {MAX_SPOTS} puntos
        {n > 0 &&
          ` · El alumno pondrá ${n} ${plural(n, "marca", "marcas")}${
            n > 1 ? `; cada punto acertado vale 1/${n} de la pregunta` : ""
          }.`}
      </p>
    </div>
  );
}
