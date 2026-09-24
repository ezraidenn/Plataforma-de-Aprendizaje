"use client";

import { Check, X } from "lucide-react";
import { BoardSpot, ImageBoard, ItemFace, fileUrl, iconPx, useElementWidth } from "@/components/exam/image-board";
import type { ReviewBoard } from "@/components/student/types";
import { cn } from "@/lib/utils";

/**
 * Revisión de una pregunta sobre imagen. Arrastrar: «Tu respuesta» (cada lugar
 * con lo que puso el alumno, verde o rojo) y, si no quedó todo bien,
 * «Solución». Señalar: los puntos correctos (verdes si se acertaron, rojos
 * punteados si no) con las marcas numeradas del alumno encima.
 */
export function ImageReview({ board, showSolution = true }: { board: ReviewBoard; showSolution?: boolean }) {
  if (board.kind === "click") return <ClickReview board={board} />;
  return (
    <div className={GRID}>
      <DragThumb board={board} mine />
      {showSolution && <DragThumb board={board} mine={false} />}
    </div>
  );
}

/** Lado a lado en escritorio, apiladas en celular; lo que asome del borde no abre desplazamiento de lado. */
const GRID = "grid gap-3 overflow-x-clip [overflow-clip-margin:12px] sm:grid-cols-2";

type DragBoard = Extract<ReviewBoard, { kind: "drag" }>;
type ClickBoard = Extract<ReviewBoard, { kind: "click" }>;

function DragThumb({ board, mine }: { board: DragBoard; mine: boolean }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const px = iconPx(board.iconSize, width);
  const title = mine ? "Tu respuesta" : "Solución";
  return (
    <figure className="space-y-1.5">
      <figcaption className="text-xs font-semibold text-muted-foreground">{title}</figcaption>
      <ImageBoard ref={ref} imageUrl={fileUrl(board.image)} aspect={board.aspect} aria-hidden>
        {board.zones.map((z, i) => {
          const item = mine ? z.placed : z.expected;
          return (
            <BoardSpot key={i} x={z.x} y={z.y}>
              {item ? (
                <span className="relative block">
                  <ItemFace
                    item={item}
                    px={px}
                    dense
                    className={cn(mine && "ring-2", mine && (z.correct ? "ring-success" : "ring-destructive"))}
                  />
                  {mine && <Verdict ok={z.correct} />}
                </span>
              ) : (
                // Lugar vacío en la respuesta del alumno: sombra roja
                <span className="block size-6 rounded-full border-2 border-dashed border-destructive bg-destructive/15" />
              )}
            </BoardSpot>
          );
        })}
      </ImageBoard>
      {mine && (
        <ul className="sr-only">
          {board.zones.map((z, i) => (
            <li key={i}>
              Lugar {i + 1}: {z.correct ? "correcto" : z.placed ? "incorrecto" : "vacío"}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Palomita o tache en la esquina: el color solo no basta para todos. */
function Verdict({ ok }: { ok: boolean }) {
  const Icon = ok ? Check : X;
  return (
    <span
      className={cn(
        "absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full text-white ring-2 ring-white",
        ok ? "bg-success" : "bg-destructive"
      )}
    >
      <Icon className="size-2.5" strokeWidth={3.5} aria-hidden />
    </span>
  );
}

function ClickReview({ board }: { board: ClickBoard }) {
  return (
    <div className={GRID}>
      <figure className="space-y-1.5">
        <figcaption className="text-xs font-semibold text-muted-foreground">Tu respuesta y la solución</figcaption>
        <ImageBoard imageUrl={fileUrl(board.image)} aspect={board.aspect} aria-hidden>
          {board.spots.map((s, i) => (
            <BoardSpot
              key={`p${i}`}
              x={s.x}
              y={s.y}
              className={cn(
                "rounded-full border-2",
                s.hit ? "border-success bg-success/20" : "border-dashed border-destructive bg-destructive/10"
              )}
              // El radio de acierto es una fracción del ancho de la foto
              style={{ width: `${board.radius * 200}%`, aspectRatio: "1" }}
            />
          ))}
          {board.marks.map((m, i) => (
            <BoardSpot key={`m${i}`} x={m.x} y={m.y} className="z-10">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow ring-2 ring-white">
                {i + 1}
              </span>
            </BoardSpot>
          ))}
        </ImageBoard>
      </figure>
      <ul className="space-y-1.5 self-center text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="size-3.5 shrink-0 rounded-full border-2 border-success bg-success/20" aria-hidden />
          Punto que señalaste bien
        </li>
        <li className="flex items-center gap-2">
          <span
            className="size-3.5 shrink-0 rounded-full border-2 border-dashed border-destructive bg-destructive/10"
            aria-hidden
          />
          Punto que faltó
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3.5 shrink-0 rounded-full bg-primary" aria-hidden />
          Tus marcas, en el orden en que las pusiste
        </li>
      </ul>
    </div>
  );
}
