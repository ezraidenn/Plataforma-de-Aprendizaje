"use client";

import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { FOCUS_OUTLINE } from "@/components/exam/image-pieces";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import {
  BANK,
  PlaceBank,
  PlaceChip,
  PlaceDnd,
  byAttr,
  groupColumns,
  useFocusAfter,
  viaKeyboard,
} from "@/components/student/place-kit";
import type { RunnerQuestion } from "@/components/student/types";
import { iconNumbers, imageItemName, parseMapAnswer } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * «Clasificar en grupos», lo que ve el alumno: las tarjetas en el banco,
 * arriba, y los grupos como columnas. Cada tarjeta va a un grupo arrastrándola,
 * tocándola y tocando el grupo, o con el teclado (Enter en la tarjeta, Enter en
 * el grupo, Escape cancela). Una tarjeta puesta se puede cambiar de grupo o
 * devolver al banco. Respuesta: `{ fichaDeTarjeta: fichaDeGrupo }`, en el orden
 * en que se pusieron (así se ven dentro de cada grupo).
 */

type CategorizeView = NonNullable<RunnerQuestion["categorize"]>;
type Card = CategorizeView["cards"][number];

const cardsWord = (n: number) => (n === 0 ? "vacío" : n === 1 ? "1 tarjeta" : `${n} tarjetas`);

export function CategorizeControl({
  config,
  answerText,
  onChange,
}: {
  config: CategorizeView;
  /** Lo guardado: `{ fichaDeTarjeta: fichaDeGrupo }` en JSON. */
  answerText: string;
  onChange: (next: Record<string, string>) => void;
}) {
  /** Tarjeta elegida con un toque (o con Enter). */
  const [selected, setSelected] = useState<string | null>(null);
  /** Tarjeta que va en la mano (arrastre). */
  const [dragging, setDragging] = useState<string | null>(null);
  /** Grupo (o banco) donde caería si se suelta ahora. */
  const [hot, setHot] = useState<string | null>(null);
  const { live, announce } = useAnnouncer();
  const { rootRef, focusLater } = useFocusAfter();

  const cards = useMemo(() => new Map(config.cards.map((k) => [k.token, k])), [config.cards]);
  const groupName = useMemo(() => new Map(config.groups.map((g) => [g.token, g.name])), [config.groups]);
  // «Ícono N» con la misma numeración que la revisión
  const names = useMemo(() => {
    const icons = iconNumbers(config.cards.map((k) => k.fileId));
    return new Map(config.cards.map((k) => [k.token, imageItemName(k, icons)]));
  }, [config.cards]);

  // Lo guardado, solo con tarjetas y grupos que existen
  const placement = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [card, group] of Object.entries(parseMapAnswer(answerText))) {
      if (cards.has(card) && groupName.has(group)) out[card] = group;
    }
    return out;
  }, [answerText, cards, groupName]);

  const bank = config.cards.filter((k) => !placement[k.token]);
  const nameOf = (token: string) => names.get(token) ?? "";

  function place(card: string, group: string, keyboard: boolean) {
    setSelected(null);
    const from = placement[card];
    if (from !== group) {
      // Al final de su grupo nuevo: sale del mapa y vuelve a entrar
      const next = { ...placement };
      delete next[card];
      next[card] = group;
      onChange(next);
    }
    announce(`${nameOf(card)} ${from === group ? "ya estaba" : "quedó"} en ${groupName.get(group)}`);
    // Con teclado se sigue con la próxima tarjeta del banco; si ya no hay, con la que se puso
    if (keyboard) focusLater("[data-bank-item]", byAttr("data-token", card));
  }

  function unplace(card: string, keyboard: boolean) {
    setSelected(null);
    if (!placement[card]) return;
    const next = { ...placement };
    delete next[card];
    onChange(next);
    announce(`${nameOf(card)} volvió al banco`);
    if (keyboard) focusLater(byAttr("data-token", card));
  }

  function onCardClick(token: string, e: React.MouseEvent) {
    const keyboard = viaKeyboard(e);
    if (selected === token) {
      setSelected(null);
      announce("Elección cancelada");
      return;
    }
    // Con otra tarjeta elegida, tocar una ya puesta es tocar su grupo
    const group = placement[token];
    if (selected && group) {
      place(selected, group, keyboard);
      return;
    }
    setSelected(token);
    announce(`Elegiste ${nameOf(token)}. Ahora elige su grupo`);
    if (keyboard) focusLater("[data-group-target]");
  }

  function onGroupClick(group: string, e: React.MouseEvent) {
    if (!selected) {
      announce("Primero elige una tarjeta");
      return;
    }
    place(selected, group, viaKeyboard(e));
  }

  const chip = (k: Card, group?: string) => (
    <PlaceChip
      key={k.token}
      token={k.token}
      face={k}
      label={group ? `${nameOf(k.token)}, en ${groupName.get(group)}` : nameOf(k.token)}
      selected={selected === k.token}
      faded={dragging === k.token}
      data-bank-item={group ? undefined : ""}
      onClick={(e) => onCardClick(k.token, e)}
    />
  );

  return (
    <div
      ref={rootRef}
      className="space-y-3"
      // Con una tarjeta elegida, Esc la suelta: un diálogo alrededor (la vista previa) no se cierra
      data-choosing={selected ? "" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) {
          e.preventDefault();
          const token = selected;
          setSelected(null);
          announce("Elección cancelada");
          // El foco vuelve a la tarjeta que se había elegido
          focusLater(byAttr("data-token", token));
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Arrastra cada tarjeta a su grupo, o tócala y después toca el grupo.
        <span className="sr-only"> Con el teclado: Enter en una tarjeta, Enter en su grupo; Escape cancela.</span>
      </p>
      <PlaceDnd
        ghost={dragging ? (cards.get(dragging) ?? null) : null}
        onStart={(token) => {
          setSelected(null);
          setDragging(token);
        }}
        onOver={setHot}
        onDrop={(token, target) => {
          setDragging(null);
          setHot(null);
          if (target && groupName.has(target)) place(token, target, false);
          // En el banco o fuera de todo: una tarjeta puesta vuelve al banco
          else if (placement[token]) unplace(token, false);
        }}
        onCancel={() => {
          setDragging(null);
          setHot(null);
        }}
      >
        <PlaceBank
          title="Tarjetas"
          empty={bank.length === 0 ? "Todas las tarjetas están en un grupo. Puedes moverlas o devolverlas aquí." : null}
          hot={hot === BANK}
          canReturn={!!selected && !!placement[selected]}
          onReturn={(e) => selected && unplace(selected, viaKeyboard(e))}
        >
          {bank.map((k) => chip(k))}
        </PlaceBank>

        <div className={cn("grid gap-2.5", groupColumns(config.groups.length))}>
          {config.groups.map((g) => {
            const inside = Object.keys(placement).filter((k) => placement[k] === g.token);
            return (
              <GroupBox
                key={g.token}
                token={g.token}
                name={g.name}
                count={inside.length}
                hot={hot === g.token}
                dragging={!!dragging}
                choosing={!!selected}
                onPick={(e) => onGroupClick(g.token, e)}
              >
                {inside.map((k) => chip(cards.get(k)!, g.token))}
              </GroupBox>
            );
          })}
        </div>
      </PlaceDnd>
      <LiveRegion live={live} />
    </div>
  );
}

/** Un grupo: su nombre (el botón para poner ahí la tarjeta elegida) y las tarjetas que tiene. */
function GroupBox({
  token,
  name,
  count,
  hot,
  dragging,
  choosing,
  onPick,
  children,
}: {
  token: string;
  name: string;
  count: number;
  /** La tarjeta arrastrada caería aquí. */
  hot: boolean;
  /** Hay una tarjeta en la mano: todos los grupos se marcan como destino. */
  dragging: boolean;
  /** Hay una tarjeta elegida: también se marcan (con el dedo no hay «pasar encima») y se iluminan al pasar. */
  choosing: boolean;
  onPick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: token });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-32 min-w-0 flex-col gap-2 rounded-xl border-2 border-dashed bg-card p-2 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
        (dragging || choosing) && "border-primary/40",
        choosing && "cursor-pointer hover:border-primary/60 hover:bg-primary/5",
        hot && "border-solid border-primary bg-primary/5 ring-4 ring-primary/15"
      )}
      onClick={(e) => {
        // Tocar el grupo fuera de sus tarjetas, con una elegida, la pone aquí
        if (choosing && !(e.target as Element).closest("button")) onPick(e);
      }}
    >
      <button
        type="button"
        data-group-target=""
        data-group={token}
        // Sin tarjeta elegida no son paradas de Tab: al elegir, el foco llega solo
        tabIndex={choosing ? 0 : -1}
        aria-label={`Grupo ${name}, ${cardsWord(count)}`}
        onClick={onPick}
        className={cn(
          "rounded-md px-1 py-0.5 text-center text-sm font-semibold text-foreground/80 [overflow-wrap:break-word]",
          choosing && "hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10",
          FOCUS_OUTLINE
        )}
      >
        {name}
      </button>
      {/* items-center: un texto junto a un ícono no se estira a su alto */}
      <div className="flex flex-wrap content-start items-center justify-center gap-1.5">{children}</div>
    </div>
  );
}
