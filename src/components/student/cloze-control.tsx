"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { renderBold } from "@/components/exam/render-bold";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BANK,
  FOCUS_OUTLINE,
  PlaceBank,
  PlaceChip,
  PlaceDnd,
  byAttr,
  useFocusAfter,
  viaKeyboard,
} from "@/components/student/place-kit";
import type { RunnerQuestion } from "@/components/student/types";
import { parseMapAnswer } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * «Completar el texto», lo que ve el alumno: el texto con sus huecos y, según
 * el modo que eligió el maestro, un cuadro para escribir, una lista para elegir
 * o un lugar donde poner una palabra del banco. Respuesta:
 * `{ fichaDeHueco: texto | fichaDePalabra | fichaDeOpción }`.
 */

type ClozeView = NonNullable<RunnerQuestion["cloze"]>;
type Word = NonNullable<ClozeView["words"]>[number];

/** Ancho inicial de un cuadro para escribir, en `ch`: el mismo en todos, no delata la respuesta. */
const WRITE_MIN_CH = 8;
/** Lo más que se puede escribir en un hueco. */
const WRITE_MAX = 100;

/**
 * El texto con cada hueco dibujado por `blank` (su ficha y su número, desde 1).
 * Las negritas se leen por trozo y los saltos de línea se respetan.
 */
function ClozeText({ pieces, blank }: { pieces: ClozeView["pieces"]; blank: (token: string, n: number) => ReactNode }) {
  let n = 0;
  return (
    <div className="whitespace-pre-line text-base leading-[2.6]">
      {pieces.map((p, i) =>
        p.kind === "text" ? <Fragment key={i}>{renderBold(p.text)}</Fragment> : <Fragment key={p.token}>{blank(p.token, ++n)}</Fragment>
      )}
    </div>
  );
}

export function ClozeControl({
  config,
  answerText,
  onChange,
}: {
  config: ClozeView;
  /** Lo guardado: `{ fichaDeHueco: … }` en JSON. */
  answerText: string;
  onChange: (next: Record<string, string>) => void;
}) {
  if (config.mode === "bank") return <ClozeBank config={config} answerText={answerText} onChange={onChange} />;

  const answer = parseMapAnswer(answerText);
  const set = (blank: string, value: string) => onChange({ ...answer, [blank]: value });
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {config.mode === "write" ? "Escribe lo que falta en cada hueco." : "Elige lo que va en cada hueco."}
      </p>
      <ClozeText
        pieces={config.pieces}
        blank={(token, n) =>
          config.mode === "write" ? (
            <input
              type="text"
              aria-label={`Hueco ${n}`}
              value={answer[token] ?? ""}
              onChange={(e) => set(token, e.target.value)}
              maxLength={WRITE_MAX}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              // Crece con lo escrito; vacíos, todos del mismo ancho
              style={{ width: `${Math.max(WRITE_MIN_CH, (answer[token] ?? "").length + 2)}ch` }}
              className="mx-0.5 inline-block h-8 max-w-full rounded-t-md border-0 border-b-2 border-muted-foreground/60 bg-muted/60 px-1.5 align-middle font-semibold text-primary outline-none transition-colors focus-visible:border-primary focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
            />
          ) : (
            <SelectBlank n={n} value={answer[token] ?? ""} options={config.options?.[token] ?? []} onChange={(v) => set(token, v)} />
          )
        }
      />
    </div>
  );
}

/** Un hueco en modo lista: la lista de shadcn en línea, con «Elige…» mientras está vacía. */
function SelectBlank({
  n,
  value,
  options,
  onChange,
}: {
  n: number;
  value: string;
  options: { token: string; text: string }[];
  onChange: (token: string) => void;
}) {
  const valid = options.some((o) => o.token === value);
  return (
    <Select value={valid ? value : ""} onValueChange={onChange}>
      <SelectTrigger
        aria-label={`Hueco ${n}`}
        className="mx-0.5 inline-flex max-w-full bg-card align-middle text-base font-semibold leading-normal *:data-[slot=select-value]:min-w-0 data-placeholder:font-normal"
      >
        <SelectValue placeholder="Elige…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.token} value={o.token}>
            {o.text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Palabras iguales (mismo texto) van juntas en el banco: son intercambiables.
 * El orden sale de TODAS las palabras, así una no cambia de sitio al ponerla o devolverla.
 */
function groupWords(all: Word[], isPlaced: (token: string) => boolean): [string, Word[]][] {
  const groups = new Map<string, Word[]>();
  for (const w of all) {
    const group = groups.get(w.text) ?? [];
    if (!isPlaced(w.token)) group.push(w);
    groups.set(w.text, group);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 0);
}

/**
 * Modo banco: las palabras se ponen en los huecos arrastrándolas, tocándolas y
 * tocando el hueco, o con el teclado (Enter en la palabra, Enter en el hueco,
 * Escape cancela). Los huecos vacíos miden todos lo mismo: no delatan la
 * respuesta. Si el hueco ya tiene una palabra, la nueva la reemplaza y la otra
 * vuelve al banco.
 */
function ClozeBank({
  config,
  answerText,
  onChange,
}: {
  config: ClozeView;
  answerText: string;
  onChange: (next: Record<string, string>) => void;
}) {
  /** Palabra elegida con un toque (o con Enter). */
  const [selected, setSelected] = useState<string | null>(null);
  /** Palabra que va en la mano (arrastre). */
  const [dragging, setDragging] = useState<string | null>(null);
  /** Hueco (o banco) donde caería si se suelta ahora. */
  const [hot, setHot] = useState<string | null>(null);
  const { live, announce } = useAnnouncer();
  const { rootRef, focusLater } = useFocusAfter();

  const all = useMemo(() => config.words ?? [], [config.words]);
  const words = useMemo(() => new Map(all.map((w) => [w.token, w.text])), [all]);
  const blankNo = useMemo(() => {
    let n = 0;
    return new Map(config.pieces.flatMap((p) => (p.kind === "blank" ? [[p.token, ++n] as const] : [])));
  }, [config.pieces]);

  // Lo guardado, solo con huecos y palabras que existen, y cada palabra una vez
  const placement = useMemo(() => {
    const used = new Set<string>();
    const out: Record<string, string> = {};
    for (const [blank, word] of Object.entries(parseMapAnswer(answerText))) {
      if (!blankNo.has(blank) || !words.has(word) || used.has(word)) continue;
      used.add(word);
      out[blank] = word;
    }
    return out;
  }, [answerText, blankNo, words]);
  const blankOf = useMemo(() => new Map(Object.entries(placement).map(([b, w]) => [w, b])), [placement]);
  const bank = groupWords(all, (token) => blankOf.has(token));
  const textOf = (token: string) => words.get(token) ?? "";

  function place(word: string, blank: string, keyboard: boolean) {
    setSelected(null);
    const from = blankOf.get(word);
    let text = `${textOf(word)} en el hueco ${blankNo.get(blank)}`;
    if (from !== blank) {
      const next = { ...placement };
      if (from) delete next[from];
      const previous = next[blank];
      next[blank] = word;
      onChange(next);
      if (previous) text += `; ${textOf(previous)} volvió al banco`;
    }
    announce(text);
    // Con teclado se sigue con la próxima palabra del banco; si ya no hay, en el hueco
    if (keyboard) focusLater("[data-bank-item]", byAttr("data-blank", blank));
  }

  function unplace(word: string, keyboard: boolean) {
    setSelected(null);
    const from = blankOf.get(word);
    if (!from) return;
    const next = { ...placement };
    delete next[from];
    onChange(next);
    announce(`${textOf(word)} volvió al banco`);
    // El foco sigue a la palabra, ya en el banco (junto con sus iguales)
    if (keyboard) focusLater(byAttr("data-word", textOf(word)));
  }

  function onWordClick(token: string, e: React.MouseEvent) {
    const keyboard = viaKeyboard(e);
    if (selected === token) {
      setSelected(null);
      announce("Elección cancelada");
      return;
    }
    // Con otra palabra elegida, tocar una ya puesta es tocar su hueco: la reemplaza
    const blank = blankOf.get(token);
    if (selected && blank) {
      place(selected, blank, keyboard);
      return;
    }
    setSelected(token);
    announce(`Elegiste ${textOf(token)}. Ahora elige su hueco`);
    if (keyboard) focusLater("[data-free-slot]", "[data-blank]");
  }

  function onSlotClick(blank: string, e: React.MouseEvent) {
    if (!selected) {
      announce("Primero elige una palabra del banco");
      return;
    }
    place(selected, blank, viaKeyboard(e));
  }

  return (
    <div
      ref={rootRef}
      className="space-y-3"
      // Con una palabra elegida, Esc la suelta: un diálogo alrededor (la vista previa) no se cierra
      data-choosing={selected ? "" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) {
          e.preventDefault();
          const token = selected;
          setSelected(null);
          announce("Elección cancelada");
          // El foco vuelve a la palabra que se había elegido (en su hueco o en el banco)
          focusLater(byAttr("data-token", token), byAttr("data-word", textOf(token)));
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Arrastra cada palabra a su hueco, o tócala y después toca el hueco.
        <span className="sr-only"> Con el teclado: Enter en una palabra, Enter en su hueco; Escape cancela.</span>
      </p>
      <PlaceDnd
        ghost={dragging ? { kind: "text", text: textOf(dragging) } : null}
        onStart={(token) => {
          setSelected(null);
          setDragging(token);
        }}
        onOver={setHot}
        onDrop={(token, target) => {
          setDragging(null);
          setHot(null);
          if (target && blankNo.has(target)) place(token, target, false);
          // En el banco o fuera de todo: una palabra puesta vuelve al banco
          else if (blankOf.has(token)) unplace(token, false);
        }}
        onCancel={() => {
          setDragging(null);
          setHot(null);
        }}
      >
        <ClozeText
          pieces={config.pieces}
          blank={(token, n) => {
            const word = placement[token];
            return (
              <Slot
                blank={token}
                n={n}
                word={word ? { token: word, text: textOf(word) } : null}
                hot={hot === token}
                dragging={dragging}
                selected={selected}
                onSlot={(e) => onSlotClick(token, e)}
                onWord={(e) => word && onWordClick(word, e)}
              />
            );
          }}
        />

        <PlaceBank
          title="Palabras"
          empty={bank.length === 0 ? "Todas las palabras están en un hueco. Puedes moverlas o devolverlas aquí." : null}
          hot={hot === BANK}
          canReturn={!!selected && blankOf.has(selected)}
          onReturn={(e) => selected && unplace(selected, viaKeyboard(e))}
        >
          {bank.map(([text, group]) => {
            const first = group[0];
            // Al arrastrar sale una copia: el número baja y, si no quedan, se atenúa
            const left = group.length - (dragging === first.token ? 1 : 0);
            return (
              <PlaceChip
                key={text}
                token={first.token}
                face={{ kind: "text", text }}
                label={group.length > 1 ? `${text}, ${group.length} iguales` : text}
                selected={selected === first.token}
                count={left}
                faded={left === 0}
                data-bank-item=""
                data-word={text}
                onClick={(e) => onWordClick(first.token, e)}
              />
            );
          })}
        </PlaceBank>
      </PlaceDnd>
      <LiveRegion live={live} />
    </div>
  );
}

/** Un hueco del banco: vacío, un lugar punteado (todos iguales); lleno, la palabra que se puede mover. */
function Slot({
  blank,
  n,
  word,
  hot,
  dragging,
  selected,
  onSlot,
  onWord,
}: {
  blank: string;
  n: number;
  word: Word | null;
  /** La palabra arrastrada caería aquí. */
  hot: boolean;
  /** Palabra en la mano, si hay. */
  dragging: string | null;
  /** Palabra elegida, si hay. */
  selected: string | null;
  onSlot: (e: React.MouseEvent) => void;
  onWord: (e: React.MouseEvent) => void;
}) {
  const { setNodeRef } = useDroppable({ id: blank });
  return (
    // Lleno, mide lo que la palabra: el tamaño lo da lo que puso el alumno, no la respuesta
    <span ref={setNodeRef} className="mx-0.5 inline-flex min-h-8 max-w-full items-center justify-center align-middle">
      {word ? (
        <PlaceChip
          token={word.token}
          face={{ kind: "text", text: word.text }}
          label={`Hueco ${n}: ${word.text}`}
          selected={selected === word.token}
          faded={dragging === word.token}
          data-blank={blank}
          className={cn("min-h-8 py-0.5 leading-normal", hot && "ring-4 ring-primary/40")}
          onClick={onWord}
        />
      ) : (
        <button
          type="button"
          data-blank={blank}
          data-free-slot=""
          aria-label={`Hueco ${n}`}
          // Sin palabra elegida no son paradas de Tab: al elegir, el foco llega solo
          tabIndex={selected ? 0 : -1}
          onClick={onSlot}
          className={cn(
            "h-8 w-24 rounded-full border-2 border-dashed border-muted-foreground/50 bg-muted/40 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
            FOCUS_OUTLINE,
            dragging && "border-primary/50",
            selected && "hover:border-solid hover:border-primary hover:bg-primary/10 focus-visible:bg-primary/10",
            hot && "border-solid border-primary bg-primary/10 ring-4 ring-primary/15"
          )}
        />
      )}
    </span>
  );
}
