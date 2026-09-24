"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BoardCursor, BoardSpot, ImageBoard } from "@/components/exam/image-board";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import { clamp01, fileUrl, parseClickAnswer, round4, type Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * «Señalar en la imagen», lo que ve el alumno: cada clic en la foto pone una
 * marca numerada (hasta `marks`) y un clic en una marca la quita. Con teclado,
 * la foto se enfoca, las flechas mueven una mira (Mayús: pasos largos), Enter
 * marca, y Supr borra la marca enfocada.
 */

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

export function ImageClickControl({
  image,
  config,
  answerText,
  onChange,
}: {
  image: string;
  config: { aspect: number; marks: number };
  /** Lo guardado: `[{ x, y }, …]` en JSON. */
  answerText: string;
  onChange: (marks: Point[]) => void;
}) {
  const max = config.marks;
  const value = useMemo(() => parseClickAnswer(answerText, max), [answerText, max]);
  const full = value.length >= max;
  const [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });
  /** Quiso poner una marca de más: se le dice también a la vista. */
  const [blocked, setBlocked] = useState(false);
  const { live, announce } = useAnnouncer();
  const boardRef = useRef<HTMLDivElement>(null);

  function add(p: Point) {
    // La mira sigue al último clic: si luego usa el teclado, parte de ahí
    setCursor(p);
    if (full) {
      setBlocked(true);
      announce(`Ya pusiste ${max === 1 ? "tu marca" : `tus ${max} marcas`}. Quita una para moverla`);
      return;
    }
    onChange([...value, { x: round4(p.x), y: round4(p.y) }]);
    announce(`Marca ${value.length + 1} puesta`);
  }

  function remove(i: number, viaKeyboard: boolean) {
    setBlocked(false);
    onChange(value.filter((_, j) => j !== i));
    announce(`Marca ${i + 1} quitada`);
    // El botón desaparece: el foco vuelve a la foto para no perderse
    if (viaKeyboard) boardRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    // Pasos iguales en pantalla: en vertical se corrigen con la proporción
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step / config.aspect],
      ArrowDown: [0, step / config.aspect],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      // Las flechas mueven la mira, no cambian de pregunta
      e.stopPropagation();
      setCursor((c) => ({ x: clamp01(c.x + move[0]), y: clamp01(c.y + move[1]) }));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      add(cursor);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Toca la foto para marcar {max === 1 ? "el punto" : `los ${max} puntos`}. Toca una marca para quitarla.
      </p>
      <ImageBoard
        ref={boardRef}
        imageUrl={fileUrl(image)}
        aspect={config.aspect}
        onPointer={(p) => add(p)}
        tabIndex={0}
        role="application"
        aria-label="Foto: mueve la mira con las flechas y pulsa Enter para poner una marca"
        onKeyDown={onKeyDown}
        className={cn(
          "group touch-manipulation outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
          full ? "cursor-default" : "cursor-crosshair"
        )}
      >
        <BoardCursor x={cursor.x} y={cursor.y} />
        {value.map((m, i) => (
          <BoardSpot key={i} x={m.x} y={m.y} className="z-10">
            <button
              type="button"
              aria-label={`Marca ${i + 1}: pulsa para quitarla`}
              title="Quitar marca"
              onClick={(e) => remove(i, e.detail === 0)}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  remove(i, true);
                }
                // Tampoco aquí las flechas cambian de pregunta
                if (ARROWS.includes(e.key)) e.stopPropagation();
              }}
              className="flex size-[26px] items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-md ring-2 ring-white outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-4 focus-visible:ring-primary/40 motion-reduce:transition-none"
            >
              {i + 1}
            </button>
          </BoardSpot>
        ))}
      </ImageBoard>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm tabular-nums text-muted-foreground">
          {value.length} de {max} {max === 1 ? "marca" : "marcas"}
          {blocked && full && (
            <span className="font-medium text-foreground"> · Quita una para ponerla en otro lugar</span>
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={value.length === 0}
          onClick={() => {
            setBlocked(false);
            onChange([]);
            announce("Quitaste todas las marcas");
            // El botón queda deshabilitado: el foco pasa a la foto para seguir marcando
            boardRef.current?.focus();
          }}
        >
          Quitar todas
        </Button>
      </div>
      <LiveRegion live={live} />
    </div>
  );
}
