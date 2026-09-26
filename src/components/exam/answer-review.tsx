"use client";

import { Fragment } from "react";
import { Check, X } from "lucide-react";
import { renderBold } from "@/components/exam/render-bold";
import { groupColumns } from "@/components/student/categorize-control";
import { ChipFace, chipLook } from "@/components/student/place-kit";
import type { AnswerBoard } from "@/components/student/types";
import type { CategorizeBoard, CategorizeCardView } from "@/lib/categorize";
import type { ClozeBoard } from "@/lib/cloze";
import { iconNumbers, imageItemName } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Revisión de «Clasificar en grupos» y «Completar el texto», hermana de
 * `ImageReview`. Clasificar: cada grupo con las tarjetas que puso el alumno,
 * con ✓ o ✗ y, en las mal puestas, «iba en …»; aparte, las que dejó sin
 * poner. Completar: el texto con lo contestado en verde (bien) o rojo tachado
 * (mal) y la respuesta correcta al lado. Lo dibujado va oculto al lector de
 * pantalla: lo lee en la lista de abajo, tarjeta por tarjeta o hueco por hueco.
 */
export function AnswerReview({ board }: { board: AnswerBoard }) {
  return board.kind === "categorize" ? <CategorizeReview board={board} /> : <ClozeReview board={board} />;
}

function CategorizeReview({ board }: { board: CategorizeBoard }) {
  const icons = iconNumbers([...board.groups.flatMap((g) => g.cards), ...board.unplaced].map((c) => c.view.fileId));
  const name = (v: CategorizeCardView) => imageItemName(v, icons);
  return (
    <div className="space-y-2.5">
      <div aria-hidden className={cn("grid gap-2", groupColumns(board.groups.length))}>
        {board.groups.map((g, i) => (
          <div key={i} className="min-w-0 space-y-2 rounded-xl border bg-card p-2">
            <p className="text-center text-sm font-semibold text-foreground/80 [overflow-wrap:break-word]">{g.name}</p>
            {g.cards.length > 0 ? (
              <div className="flex flex-wrap items-start justify-center gap-x-1.5 gap-y-2">
                {g.cards.map((c, j) => (
                  <ReviewCard key={j} view={c.view} ok={c.correct} note={c.correct ? undefined : `iba en ${c.expectedGroup}`} />
                ))}
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">Sin tarjetas</p>
            )}
          </div>
        ))}
      </div>
      {board.unplaced.length > 0 && (
        <div aria-hidden className="space-y-2 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/80">Sin poner</p>
          <div className="flex flex-wrap items-start gap-x-1.5 gap-y-2">
            {board.unplaced.map((c, j) => (
              <ReviewCard key={j} view={c.view} ok={false} note={`iba en ${c.expectedGroup}`} />
            ))}
          </div>
        </div>
      )}
      {/* Lo mismo en texto, para quien no ve el tablero */}
      <ul className="sr-only">
        {board.groups.flatMap((g) =>
          g.cards.map((c, j) => (
            <li key={`${g.name}-${j}`}>
              {name(c.view)}: {c.correct ? `correcto, en ${g.name}` : `la pusiste en ${g.name}; iba en ${c.expectedGroup}`}
            </li>
          ))
        )}
        {board.unplaced.map((c, j) => (
          <li key={`sin-${j}`}>
            {name(c.view)}: sin poner; iba en {c.expectedGroup}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Una tarjeta de la revisión: con su palomita o tache (el color solo no basta) y, si falló, a dónde iba. */
function ReviewCard({ view, ok, note }: { view: CategorizeCardView; ok: boolean; note?: string }) {
  const Icon = ok ? Check : X;
  return (
    <span className="inline-flex max-w-full flex-col items-center gap-0.5">
      <span className={cn(chipLook(view.kind), "ring-2", ok ? "ring-success" : "ring-destructive")}>
        <ChipFace face={view} />
        <Icon className={cn("size-3.5 shrink-0", ok ? "text-success" : "text-destructive")} strokeWidth={3} />
      </span>
      {note && <span className="max-w-full text-center text-xs font-medium text-destructive [overflow-wrap:break-word]">{note}</span>}
    </span>
  );
}

type ClozeBlankReview = Extract<ClozeBoard["pieces"][number], { kind: "blank" }>;

function ClozeReview({ board }: { board: ClozeBoard }) {
  const blanks = board.pieces.filter((p): p is ClozeBlankReview => p.kind === "blank");
  return (
    <div>
      <div aria-hidden className="whitespace-pre-line text-base leading-[2.3]">
        {board.pieces.map((p, i) =>
          p.kind === "text" ? <Fragment key={i}>{renderBold(p.text)}</Fragment> : <ReviewBlank key={i} blank={p} />
        )}
      </div>
      {/* Lo mismo en texto, para quien no ve el texto marcado */}
      <ul className="sr-only">
        {blanks.map((b, i) => (
          <li key={i}>
            Hueco {i + 1}:{" "}
            {b.correct ? `correcto, ${b.given}` : b.given ? `pusiste ${b.given}; iba ${b.expected}` : `vacío; iba ${b.expected}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Un hueco en la revisión: lo contestado en verde, o en rojo tachado (o vacío) con la respuesta correcta al lado. */
function ReviewBlank({ blank }: { blank: ClozeBlankReview }) {
  const tag = "mx-0.5 inline-flex items-center gap-1 rounded-md px-1.5 align-baseline font-semibold leading-normal";
  if (blank.correct) {
    return (
      <span className={cn(tag, "bg-green-100 text-green-800")}>
        <Check className="size-3.5 shrink-0" strokeWidth={3} />
        {blank.given}
      </span>
    );
  }
  return (
    <>
      {blank.given ? (
        <span className={cn(tag, "bg-red-100 text-red-800 line-through decoration-2")}>
          <X className="size-3.5 shrink-0" strokeWidth={3} />
          {blank.given}
        </span>
      ) : (
        <span className="mx-0.5 inline-block h-6 w-14 rounded-md border-2 border-dashed border-destructive/60 bg-red-50 align-middle" />
      )}
      <span className={cn(tag, "bg-green-100 text-green-800")}>{blank.expected}</span>
    </>
  );
}
