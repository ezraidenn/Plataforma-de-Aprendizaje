"use client";

import { useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BoardSpot, ImageBoard, fileUrl } from "@/components/exam/image-board";
import type { Point } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * «Señalar en la imagen», lo que ve el alumno: cada clic en la foto pone una
 * marca numerada (hasta `marks`) y un clic en una marca la quita. Con teclado,
 * la foto se enfoca, las flechas mueven una mira (Mayús: pasos largos), Enter
 * marca, y Supr borra la marca enfocada.
 */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** Cuatro decimales bastan (una décima de píxel en una foto de mil). */
const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function ImageClickControl({
  image,
  config,
  value,
  onChange,
}: {
  image: string;
  config: { aspect: number; marks: number };
  value: Point[];
  onChange: (marks: Point[]) => void;
}) {
  const max = config.marks;
  const full = value.length >= max;
  const [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });
  const [live, setLive] = useState({ text: "", n: 0 });
  /** Quiso poner una marca de más: se le dice también a la vista. */
  const [blocked, setBlocked] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const announce = (text: string) => setLive((l) => ({ text, n: l.n + 1 }));

  function add(p: Point) {
    if (full) {
      setBlocked(true);
      announce(`Ya pusiste ${max === 1 ? "tu marca" : `tus ${max} marcas`}. Quita una para moverla`);
      return;
    }
    onChange([...value, { x: round(p.x), y: round(p.y) }]);
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
          "group outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
          full ? "cursor-default" : "cursor-crosshair"
        )}
      >
        {/* Mira para el teclado: solo se ve con el foco puesto desde el teclado */}
        <BoardSpot
          x={cursor.x}
          y={cursor.y}
          className="pointer-events-none hidden text-primary drop-shadow-[0_0_2px_white] group-focus-visible:block"
        >
          <Crosshair className="size-7" strokeWidth={2.5} aria-hidden />
        </BoardSpot>
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
          }}
        >
          Quitar todas
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {live.text}
        {/* Un carácter invisible alterno para que se repita el mismo aviso */}
        {live.n % 2 ? String.fromCharCode(0x200b) : ""}
      </p>
    </div>
  );
}
