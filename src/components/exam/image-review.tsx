"use client";

import { Check, X } from "lucide-react";
import { BoardSpot, ImageBoard, ItemFace, SpotArea, useElementWidth } from "@/components/exam/image-board";
import type { ReviewBoard } from "@/components/student/types";
import { fileUrl, iconNumbers, iconPx, imageItemName, readingOrder } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Revisión de una pregunta sobre imagen. Arrastrar: «Tu respuesta» (cada lugar
 * con lo que puso el alumno, verde o rojo) y, si no quedó todo bien,
 * «Solución». Señalar: los puntos correctos (verdes si se acertaron, rojos
 * punteados si no) con las marcas numeradas del alumno encima. Los lugares y
 * puntos se numeran en orden de lectura, igual que al responder.
 */
export function ImageReview({ board, showSolution = true }: { board: ReviewBoard; showSolution?: boolean }) {
  if (board.kind === "click") return <ClickReview board={board} />;
  const zones = readingOrder(board.zones, board.aspect);
  const icons = iconNumbers(board.iconFiles);
  return (
    <div className={GRID}>
      <DragThumb board={board} zones={zones} mine />
      {showSolution && <DragThumb board={board} zones={zones} mine={false} />}
      {/* Lo mismo en texto, para quien no ve las miniaturas */}
      <ul className="sr-only">
        {zones.map((z, i) => {
          const expected = imageItemName(z.expected, icons);
          return (
            <li key={i}>
              Lugar {i + 1}:{" "}
              {z.correct
                ? `correcto, ${expected}`
                : z.placed
                  ? `pusiste ${imageItemName(z.placed, icons)}; iba ${expected}`
                  : `vacío; iba ${expected}`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Solo la solución, para la vista previa del maestro: en arrastrar, cada lugar
 * con lo que va; en señalar, los puntos correctos con su margen de acierto.
 */
export function ImageSolution({ board }: { board: ReviewBoard }) {
  if (board.kind === "click") {
    return (
      <div className={GRID}>
        <figure className="space-y-1.5" aria-hidden>
          <figcaption className="text-xs font-semibold text-muted-foreground">Solución</figcaption>
          <ImageBoard imageUrl={fileUrl(board.image)} aspect={board.aspect}>
            {board.spots.map((s, i) => (
              <SpotArea key={i} x={s.x} y={s.y} radius={board.radius} />
            ))}
          </ImageBoard>
        </figure>
        <p className="self-center text-xs text-muted-foreground">
          Cada círculo es un punto correcto ({board.spots.length} en total): cuenta cualquier marca que caiga dentro.
        </p>
      </div>
    );
  }
  const zones = readingOrder(board.zones, board.aspect);
  const icons = iconNumbers(board.iconFiles);
  return (
    <div className={GRID}>
      <DragThumb board={board} zones={zones} mine={false} />
      {/* Lo mismo en texto, para quien no ve la miniatura */}
      <ul className="sr-only">
        {zones.map((z, i) => (
          <li key={i}>
            Lugar {i + 1}: {imageItemName(z.expected, icons)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lado a lado en escritorio, apiladas en celular; lo que asome del borde no abre desplazamiento de lado. */
const GRID = "grid gap-3 overflow-x-clip [overflow-clip-margin:12px] sm:grid-cols-2";

type DragBoard = Extract<ReviewBoard, { kind: "drag" }>;
type ClickBoard = Extract<ReviewBoard, { kind: "click" }>;

function DragThumb({ board, zones, mine }: { board: DragBoard; zones: DragBoard["zones"]; mine: boolean }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const px = iconPx(board.iconSize, width);
  return (
    <figure className="space-y-1.5" aria-hidden>
      <figcaption className="text-xs font-semibold text-muted-foreground">{mine ? "Tu respuesta" : "Solución"}</figcaption>
      <ImageBoard ref={ref} imageUrl={fileUrl(board.image)} aspect={board.aspect}>
        {zones.map((z, i) => {
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
  const spots = readingOrder(board.spots, board.aspect);
  return (
    <div className={GRID}>
      <figure className="space-y-1.5" aria-hidden>
        <figcaption className="text-xs font-semibold text-muted-foreground">Tu respuesta y la solución</figcaption>
        <ImageBoard imageUrl={fileUrl(board.image)} aspect={board.aspect}>
          {spots.map((s, i) => (
            <SpotArea key={`p${i}`} x={s.x} y={s.y} radius={board.radius} missed={!s.hit} />
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
      <ul className="space-y-1.5 self-center text-xs text-muted-foreground" aria-hidden>
        <li className="flex items-center gap-2">
          <span className="size-3.5 shrink-0 rounded-full border-2 border-success bg-success/20" />
          Punto que señalaste bien
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3.5 shrink-0 rounded-full border-2 border-dashed border-destructive bg-destructive/10" />
          Punto que faltó
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3.5 shrink-0 rounded-full bg-primary" />
          Tus marcas, en el orden en que las pusiste
        </li>
      </ul>
      {/* Lo mismo en texto, para quien no ve la miniatura */}
      <ul className="sr-only">
        {spots.map((s, i) => (
          <li key={i}>
            Punto {i + 1}: {s.hit ? "acertado" : "no señalado"}
          </li>
        ))}
        <li>
          Pusiste {board.marks.length} de {spots.length} {spots.length === 1 ? "marca" : "marcas"}
        </li>
      </ul>
    </div>
  );
}
