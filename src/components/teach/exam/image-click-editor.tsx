"use client";

import { useMemo, useRef } from "react";
import { BoardCursor, BoardSpot, ImageBoard, SpotArea, useCrosshair } from "@/components/exam/image-board";
import { DropVeil, useFileDrop } from "@/components/exam/image-dnd";
import { plural } from "@/lib/plural";
import {
  MAX_SPOTS,
  PRECISION_RADIUS,
  fileUrl,
  readingNumbers,
  round4,
  type ImageClickConfig,
  type Point,
} from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * «Señalar en la imagen» en el editor del maestro: clic en la foto marca un
 * punto correcto y clic en un punto lo quita; con teclado, flechas y Enter
 * marcan y Supr quita. Cada punto dibuja su círculo de acierto según la
 * precisión. Soltar un archivo sobre la foto la cambia.
 */
export function ClickEditor({
  imageFileId,
  aspect,
  config,
  setConfig,
  uploading,
  setNotice,
  announce,
  onPhotoFile,
}: {
  imageFileId: string;
  /** Alto / ancho de la foto (una cualquiera mientras se mide). */
  aspect: number;
  config: ImageClickConfig;
  setConfig: (fn: (c: ImageClickConfig) => ImageClickConfig) => void;
  uploading: boolean;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  /** Un archivo soltado sobre la foto la cambia. */
  onPhotoFile: (file: File) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const { spots } = config;
  const numbers = useMemo(() => readingNumbers(spots, aspect), [spots, aspect]);
  /** Índices de los puntos en orden de lectura: el orden de Tab. */
  const ordered = useMemo(() => spots.map((_, i) => i).sort((a, b) => numbers[a] - numbers[b]), [spots, numbers]);
  const full = spots.length >= MAX_SPOTS;
  const crosshair = useCrosshair(aspect, (p) => addSpot(p));
  const boardDrop = useFileDrop(onPhotoFile, !uploading);

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
    // El botón desaparece: el foco vuelve a la foto para no perderse
    if (viaKeyboard) boardRef.current?.focus();
  }

  const n = spots.length;
  return (
    <div className="space-y-2">
      <ImageBoard
        ref={boardRef}
        imageUrl={fileUrl(imageFileId)}
        aspect={aspect}
        onPointer={(p) => addSpot(p)}
        tabIndex={0}
        role="application"
        aria-label="Foto: mueve la mira con las flechas y pulsa Enter para marcar un punto correcto"
        onKeyDown={crosshair.onKeyDown}
        {...boardDrop.dropProps}
        className={cn(
          "group outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
          full ? "cursor-default" : "cursor-crosshair"
        )}
      >
        <BoardCursor x={crosshair.cursor.x} y={crosshair.cursor.y} />
        {ordered.map((i) => (
          <SpotArea key={`a${i}`} x={spots[i].x} y={spots[i].y} radius={PRECISION_RADIUS[config.precision]} />
        ))}
        {ordered.map((i) => (
          <BoardSpot key={`p${i}`} x={spots[i].x} y={spots[i].y} className="z-10">
            <button
              type="button"
              aria-label={`Punto ${numbers[i]}: pulsa para quitarlo`}
              title="Quitar este punto"
              onClick={(e) => removeSpot(i, e.detail === 0)}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  removeSpot(i, true);
                }
              }}
              className="flex size-[22px] items-center justify-center rounded-full bg-success text-[11px] font-bold text-white shadow-md ring-2 ring-white outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-4 focus-visible:ring-primary/40 motion-reduce:transition-none"
            >
              {numbers[i]}
            </button>
          </BoardSpot>
        ))}
        <DropVeil show={boardDrop.over} text="Suelta la foto para cambiarla (los puntos se conservan)" />
      </ImageBoard>
      <p className="text-xs text-muted-foreground">
        Haz clic en la foto para marcar cada punto correcto y en un punto para quitarlo. El círculo verde es el margen:
        cuenta cualquier clic del alumno que caiga dentro.
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
