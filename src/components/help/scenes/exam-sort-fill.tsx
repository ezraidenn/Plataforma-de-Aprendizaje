"use client";

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { BoardSpot } from "@/components/exam/image-board";
import { IconArt } from "@/components/exam/image-pieces";
import { ChipFace, chipLook } from "@/components/student/place-kit";
import { parseCloze } from "@/lib/cloze";
import { cn } from "@/lib/utils";
import { useSceneClock } from "../use-scene-clock";
import { MiniBadge } from "../mini/basics";
import { MiniCursor } from "../mini/cursor";
import {
  FILL_BANK_WORDS,
  FILL_CYCLE_MS,
  FILL_ROWS,
  FILL_SELECT_OPTIONS,
  fillStory,
  SORT_CONFIG,
  SORT_CYCLE_MS,
  sortStory,
  type FillRow,
  type FillState,
} from "./exam-sort-fill.story";

/**
 * «Clasificar en grupos» y «Completar el texto». Las tarjetas, los grupos, los
 * huecos y la revisión imitan lo que ve el alumno (`place-kit.tsx`,
 * `categorize-control.tsx`, `cloze-control.tsx` y `answer-review.tsx`) con la
 * misma cara de tarjeta (`chipLook` y `ChipFace`), a escala de la tarjeta del «?».
 */

/** Tarjeta de texto a escala de la escena (la cara es la del alumno). */
const TEXT_CHIP = "min-h-0 rounded-full px-2 py-[3px] text-[10px] leading-[13px]";
/** Tarjeta de ícono a escala de la escena. */
const ICON_CHIP = "min-h-0 min-w-0 rounded-lg p-[3px]";
/** Lo que va en la mano: la cara del «fantasma» del arrastre real (inclinada, con anillo y sombra). */
const GHOST = "-rotate-4 ring-2 ring-primary shadow-[0_12px_22px_-8px_rgb(15_23_42/0.45)]";
/** Revisión: la tarjeta bien o mal puesta, con su marca (el color solo no basta). */
const RESULT_RING = { ok: "ring-2 ring-success", bad: "ring-2 ring-destructive" };

function ResultMark({ ok }: { ok: boolean }) {
  const Icon = ok ? Check : X;
  return <Icon className={cn("size-2.5 shrink-0", ok ? "text-success" : "text-destructive")} strokeWidth={3.5} />;
}

// ─── Clasificar en grupos ─────────────────────────────────────────────────────

/** Una cuña de queso, «recortada» a su dibujo como los íconos que sube el maestro. */
const CHEESE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14" width="200" height="140">
<path d="M1 5.5 13 1l6 4.5V13H1z" fill="#facc15" stroke="#a16207" stroke-width="1" stroke-linejoin="round"/>
<path d="M1 5.5h18" stroke="#a16207" stroke-width="1"/>
<circle cx="6" cy="9.3" r="1.6" fill="#ca8a04"/>
<circle cx="12.5" cy="10.4" r="1.2" fill="#ca8a04"/>
<circle cx="15.6" cy="7.9" r="0.9" fill="#ca8a04"/>
</svg>`;
const CHEESE_SRC = `data:image/svg+xml,${encodeURIComponent(CHEESE_SVG)}`;
/** Lado mayor del ícono en la tarjeta (px). */
const ICON_LONG = 20;

/** Ancho de referencia del tablero (px): las posiciones son fracciones de él. */
const SORT_W = 294;
const BANK_H = 52;
/** Centro de la fila de tarjetas del banco, desde arriba (debajo de «Tarjetas», aun con la tarjeta levantada) */
const BANK_ROW_Y = 36;
/**
 * Centro de cada tarjeta en el banco (px), en el orden de SORT_CONFIG.cards:
 * medidos con sus anchos reales (57, 40, 64, 47 y 28 px) para dejar el mismo
 * espacio entre todas, que aún alcanza con la tarjeta del «?» en un celular.
 */
const BANK_X = [36, 95, 158, 224, 272];
const GROUPS_TOP = 60;
const GROUPS_H = 84;
const SORT_H = GROUPS_TOP + GROUPS_H;
/** Centro de cada columna de grupo (tres columnas de 94 px con 6 px entre ellas) */
const GROUP_X = [47, 147, 247];
/** Centro de la primera y la segunda tarjeta dentro de un grupo, desde arriba del tablero */
const SLOT_Y = [GROUPS_TOP + 30, GROUPS_TOP + 55];

/** Nombre del grupo al que va una tarjeta (para «iba en …»). */
const expectedGroup = (card: number) => SORT_CONFIG.groups.find((g) => g.id === SORT_CONFIG.cards[card].groupId)?.name ?? "";

/** Cara de una tarjeta de la escena; al revisar, con su anillo y su marca. */
function SortCard({ index, result = null, className }: { index: number; result?: boolean | null; className?: string }) {
  const card = SORT_CONFIG.cards[index];
  const ring = result === null ? null : RESULT_RING[result ? "ok" : "bad"];
  if (card.kind === "icon") {
    const ratio = card.ratio ?? 1;
    return (
      <span className={cn(chipLook("icon"), ICON_CHIP, ring, result !== null && "gap-1", className)}>
        <IconArt src={CHEESE_SRC} w={ICON_LONG} h={Math.round(ICON_LONG * ratio)} />
        {result !== null && <ResultMark ok={result} />}
      </span>
    );
  }
  return (
    <span className={cn(chipLook("text"), TEXT_CHIP, "gap-1", ring, className)}>
      <ChipFace face={{ kind: "text", text: card.text }} />
      {result !== null && <ResultMark ok={result} />}
    </span>
  );
}

/**
 * Clasificar en grupos: las tarjetas van del banco a su grupo; mientras una va
 * en la mano los grupos se marcan como destino y el que queda debajo se
 * ilumina. El aguacate cae en Verduras. Al revisar: ✓ y ✗ con «iba en …», 4 de
 * 5 tarjetas.
 */
export function SortScene() {
  const phase = useSceneClock(SORT_CYCLE_MS);
  const s = sortStory(phase);
  const percent = Math.round((s.ok / s.total) * 100);
  const at = (px: number, py: number) => ({ x: px / SORT_W, y: py / SORT_H });

  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-2.5 text-[11px]">
      <b className="text-[11.5px] leading-snug">Clasifica cada alimento en su grupo</b>
      <div className="relative mx-auto w-full max-w-[294px] shrink-0" style={{ height: SORT_H }}>
        {/* El banco, como el del alumno */}
        <div className="absolute inset-x-0 top-0 rounded-xl border border-dashed bg-muted/60" style={{ height: BANK_H }}>
          <span className="absolute left-2 top-1.5 text-[8.5px] font-bold uppercase tracking-wider text-foreground/80">Tarjetas</span>
          {s.bankEmpty && (
            <span className="absolute inset-x-2 animate-in fade-in text-center text-[9.5px] text-muted-foreground duration-300 motion-reduce:animate-none" style={{ top: BANK_ROW_Y - 7 }}>
              Todas las tarjetas están en un grupo.
            </span>
          )}
        </div>

        {/* Los grupos en columnas: con una tarjeta en la mano se marcan; el que queda debajo se ilumina */}
        <div className="absolute inset-x-0 grid grid-cols-3 gap-1.5" style={{ top: GROUPS_TOP, height: GROUPS_H }}>
          {SORT_CONFIG.groups.map((g, i) => (
            <div
              key={g.id}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-xl bg-card pt-1 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
                s.graded ? "border" : "border-2 border-dashed",
                !s.graded && s.held !== null && "border-primary/40",
                s.hot === i && "border-solid border-primary bg-primary/5 ring-4 ring-primary/15"
              )}
            >
              <span className="text-[10px] font-semibold text-foreground/80">{g.name}</span>
            </div>
          ))}
        </div>

        {/* Al tomar una tarjeta sale una copia: la del banco queda atenuada */}
        {s.held !== null && (
          <BoardSpot {...at(BANK_X[s.held], BANK_ROW_Y)}>
            <SortCard index={s.held} className="opacity-35" />
          </BoardSpot>
        )}

        {SORT_CONFIG.cards.map((card, i) => {
          const group = s.placedIn[i];
          const inHand = s.held === i;
          const slot = s.slot[i] ?? 0;
          const pos =
            group !== null
              ? at(GROUP_X[group], SLOT_Y[slot])
              : inHand && s.travelling && s.target !== null
                ? at(GROUP_X[s.target], SLOT_Y[slot])
                : at(BANK_X[i], BANK_ROW_Y);
          const result = s.graded && group !== null ? s.correct[i] : null;
          return (
            <BoardSpot
              key={card.id}
              {...pos}
              // Solo la de la mano se desliza: al reiniciar el ciclo, las puestas vuelven al banco sin rebobinar
              className={inHand ? "z-20 transition-[left,top] duration-[600ms] ease-in-out motion-reduce:transition-none" : "z-10"}
            >
              <span className={cn("relative block transition-transform duration-300 motion-reduce:transition-none", inHand && "-translate-y-1 scale-110")}>
                <SortCard index={i} result={result} className={cn(inHand && GHOST)} />
                {inHand && <MiniCursor at pressed />}
                {result === false && (
                  <span className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 animate-in fade-in whitespace-nowrap text-[8.5px] font-semibold text-destructive duration-300 motion-reduce:animate-none">
                    iba en {expectedGroup(i)}
                  </span>
                )}
              </span>
            </BoardSpot>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[9.5px] leading-snug text-slate-500">
          {s.graded ? "Cada tarjeta vale su parte." : "Arrastra, o toca la tarjeta y luego el grupo."}
        </span>
        {s.graded && (
          <MiniBadge tone="warn" className="shrink-0 whitespace-nowrap">
            {s.ok} de {s.total} tarjetas → {percent}%
          </MiniBadge>
        )}
      </div>
    </div>
  );
}

// ─── Completar el texto ───────────────────────────────────────────────────────

/** Un hueco en la revisión: lo contestado en verde con ✓, o rojo tachado con ✗ y la correcta al lado. */
function ReviewTag({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex animate-in fade-in items-center gap-0.5 rounded-[5px] px-1 align-baseline font-semibold leading-[16px] ring-1 ring-inset duration-300 motion-reduce:animate-none",
        ok ? "bg-success/12 ring-success/60" : "bg-destructive/10 line-through decoration-destructive decoration-2 ring-destructive/60"
      )}
    >
      <ResultMark ok={ok} />
      {text}
    </span>
  );
}

function Review({ ok, given, expected }: { ok: boolean; given: string; expected: string }) {
  return ok ? (
    <ReviewTag ok text={given} />
  ) : (
    <>
      <ReviewTag ok={false} text={given} />
      <span className="mx-0.5 inline-flex animate-in fade-in items-center rounded-[5px] bg-success/12 px-1 align-baseline font-semibold leading-[16px] ring-1 ring-inset ring-success/60 duration-300 motion-reduce:animate-none">
        {expected}
      </span>
    </>
  );
}

/** La oración de una fila, con su hueco dibujado por `blank`. */
function Sentence({ row, blank }: { row: FillRow; blank: (expected: string) => ReactNode }) {
  const { pieces, blanks } = parseCloze(row.config.text);
  return (
    <p className="text-[11px] leading-[24px]">
      {pieces.map((p, i) => (
        <Fragment key={i}>{p.kind === "text" ? p.text : blank(blanks[p.index].answers[0])}</Fragment>
      ))}
    </p>
  );
}

/** Una forma de contestar: su nombre y la oración; la que está en juego se marca. */
function RowCard({ row, active, relative, children }: { row: FillRow; active: boolean; relative?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white px-2 pb-1 pt-1 transition-[border-color,box-shadow] duration-300 motion-reduce:transition-none",
        relative && "relative",
        active && "border-cta/40 shadow-[0_0_0_3px_rgb(79_70_229/0.12)]"
      )}
    >
      <p className={cn("text-[8.5px] font-extrabold uppercase leading-[11px] tracking-[0.08em] transition-colors duration-300", active ? "text-cta" : "text-slate-500")}>
        {row.label}
      </p>
      {children}
    </div>
  );
}

/** Escribir: el cuadro del alumno (subrayado, del mismo ancho vacío) que se llena letra a letra. */
function WriteRow({ s }: { s: FillState }) {
  const row = FILL_ROWS[0];
  return (
    <RowCard row={row} active={s.active === "write"}>
      <Sentence
        row={row}
        blank={(expected) =>
          s.graded ? (
            <Review ok={s.results[0]} given={row.given} expected={expected} />
          ) : (
            <span
              className={cn(
                "relative mx-0.5 inline-block h-[18px] rounded-t-[4px] border-b-2 border-muted-foreground bg-muted/60 px-1 align-middle font-semibold leading-[16px] text-primary transition-colors duration-150 motion-reduce:transition-none",
                s.writeFocus && "border-primary bg-primary/5 ring-2 ring-ring/50"
              )}
              style={{ width: `${Math.max(8, s.typed.length + 2)}ch` }}
            >
              {s.typed}
              {s.writeFocus && <span className="animate-pulse font-normal text-slate-900 motion-reduce:animate-none">|</span>}
              {s.active === "write" && <MiniCursor at={s.cursor} pressed={s.pressed} />}
            </span>
          )
        }
      />
    </RowCard>
  );
}

type Point = { x: number; y: number };
/** Centro de un elemento dentro de su padre posicionado (sin contar transformaciones ni la animación del «?»). */
const centerOf = (el: HTMLElement): Point => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 });

/**
 * Banco: el hueco es el lugar punteado del alumno (todos del mismo tamaño);
 * «París» sale del banco (la del banco queda atenuada), viaja, el hueco se
 * ilumina y encaja. El camino se mide en la propia fila al tomarla.
 */
function BankRow({ s }: { s: FillState }) {
  const row = FILL_ROWS[1];
  const chipRef = useRef<HTMLSpanElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const [path, setPath] = useState<{ from: Point; to: Point } | null>(null);
  useLayoutEffect(() => {
    if (s.bankHeld && chipRef.current && slotRef.current) setPath({ from: centerOf(chipRef.current), to: centerOf(slotRef.current) });
  }, [s.bankHeld]);
  const chip = cn(chipLook("text"), TEXT_CHIP);
  const flying = s.bankHeld && path ? (s.bankTravelling ? path.to : path.from) : null;

  return (
    <RowCard row={row} active={s.active === "bank"} relative>
      <Sentence
        row={row}
        blank={(expected) =>
          s.graded ? (
            <Review ok={s.results[1]} given={row.given} expected={expected} />
          ) : s.bankPlaced ? (
            <span className={cn(chip, "mx-0.5 align-middle")}>{row.given}</span>
          ) : (
            <span
              ref={slotRef}
              className={cn(
                "mx-0.5 inline-block h-[18px] w-14 rounded-full border-2 border-dashed border-muted-foreground bg-muted/40 align-middle transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
                s.bankHeld && "border-primary",
                s.bankHot && "border-solid border-primary bg-primary/10 ring-4 ring-primary/15"
              )}
            />
          )
        }
      />
      <div className="mb-0.5 flex items-center gap-1.5 rounded-md border border-dashed bg-muted/60 px-1.5 py-[3px]">
        <span className="text-[8px] font-bold uppercase tracking-wider text-foreground/80">Palabras</span>
        {FILL_BANK_WORDS.map((word) =>
          word === row.given && s.bankPlaced ? null : (
            <span key={word} ref={word === row.given ? chipRef : undefined} className={cn(chip, word === row.given && s.bankHeld && "opacity-35")}>
              {word}
              {/* El puntero llega a la palabra antes de tomarla */}
              {word === row.given && s.active === "bank" && !s.bankHeld && <MiniCursor at={s.cursor} pressed={s.pressed} />}
            </span>
          )
        )}
      </div>
      {/* La palabra en la mano: el fantasma del arrastre, del banco al hueco */}
      {flying && (
        <span
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-[600ms] ease-in-out motion-reduce:transition-none"
          style={{ left: flying.x, top: flying.y }}
        >
          <span className="relative block -translate-y-0.5 scale-110">
            <span className={cn(chip, GHOST)}>{row.given}</span>
            <MiniCursor at pressed />
          </span>
        </span>
      )}
    </RowCard>
  );
}

/** Lista: la lista del alumno en el hueco («Elige…»); se abre, el puntero pasa por las opciones y elige una. */
function SelectRow({ s }: { s: FillState }) {
  const row = FILL_ROWS[2];
  return (
    <RowCard row={row} active={s.active === "select"}>
      <Sentence
        row={row}
        blank={(expected) =>
          s.graded ? (
            <Review ok={s.results[2]} given={row.given} expected={expected} />
          ) : (
            <span
              className={cn(
                "relative mx-0.5 inline-flex h-[20px] items-center gap-0.5 rounded-md border border-input bg-card pl-1.5 pr-1 align-middle text-[10.5px] font-semibold leading-none transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
                s.listOpen && "border-ring ring-2 ring-ring/50"
              )}
            >
              {s.listChosen ?? <span className="font-normal text-muted-foreground">Elige…</span>}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
              {s.active === "select" && !s.listOpen && <MiniCursor at={s.cursor} pressed={s.pressed} />}
              {s.listOpen && (
                // Hacia arriba: la fila es la última de la escena
                <span className="absolute bottom-full left-0 z-20 mb-1 block w-max min-w-full animate-in fade-in zoom-in-95 rounded-lg bg-popover p-0.5 shadow-md ring-1 ring-foreground/10 duration-100 motion-reduce:animate-none">
                  {FILL_SELECT_OPTIONS.map((option, i) => (
                    <span
                      key={option}
                      className={cn("relative block rounded-md py-0.5 pl-1.5 pr-4 text-[10px] font-normal", s.listHover === i && "bg-accent text-accent-foreground")}
                    >
                      {option}
                      {s.listHover === i && <MiniCursor at pressed={s.pressed} />}
                    </span>
                  ))}
                </span>
              )}
            </span>
          )
        }
      />
    </RowCard>
  );
}

/**
 * Completar el texto: la misma oración en las tres formas de contestar, que se
 * llenan por turno (escribe, arrastra del banco, elige de la lista). Al revisar,
 * cada hueco con ✓ o ✗ y la respuesta correcta al lado de la falla.
 */
export function FillScene() {
  const phase = useSceneClock(FILL_CYCLE_MS);
  const s = fillStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-2.5 text-[11px]">
      <WriteRow s={s} />
      <BankRow s={s} />
      <SelectRow s={s} />
      <p className="mt-auto text-[9.5px] leading-snug text-slate-500">
        {s.graded ? `«${FILL_ROWS[0].given}» vale: no importan mayúsculas ni acentos.` : "El maestro elige una forma por pregunta."}
      </p>
    </div>
  );
}
