"use client";

import { useId, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowRightLeft, ChevronDown, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DropVeil, useFileDrop } from "@/components/exam/image-dnd";
import { ChipFace, chipLook } from "@/components/student/place-kit";
import { MAX_CARD_TEXT, MAX_GROUP_NAME, type CategorizeCard, type CategorizeGroup } from "@/lib/categorize";
import { cn } from "@/lib/utils";
import { CardAdder } from "./categorize-card-adder";
import type { ReportDraft } from "./use-pending-drafts";

/**
 * Una columna del editor de «Clasificar en grupos»: el nombre del grupo (se
 * escribe ahí mismo), sus tarjetas y los botones para agregarle un texto o un
 * ícono (también se puede soltar el archivo sobre la columna). Cada tarjeta se
 * arrastra a otro grupo tomándola por su texto o dibujo, o se mueve con su menú
 * (▾), que además cambia el texto; la × la quita. «+ Texto» y «+ Ícono» viven
 * en `categorize-card-adder.tsx`.
 */

/** Ids del arrastre: las tarjetas y los grupos no se confunden aunque compartan clave. */
export const cardDragId = (id: string) => `card:${id}`;
export const groupDropId = (id: string) => `group:${id}`;

const SMALL_BUTTON =
  "shrink-0 rounded-full p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary";

export type GroupRef = { id: string; label: string };

export function GroupColumn({
  group,
  index,
  label,
  cards,
  others,
  nameOf,
  canRemove,
  hot,
  dragging,
  uploading,
  busy,
  left,
  report,
  textProblem,
  onRename,
  onRenameDone,
  onRemove,
  onAddText,
  onIconFile,
  onMove,
  onRemoveCard,
  onEditText,
  onEditRejected,
}: {
  group: CategorizeGroup;
  index: number;
  /** Su nombre, o «Grupo N» mientras no tiene. */
  label: string;
  cards: CategorizeCard[];
  /** Los demás grupos, para «Mover a». */
  others: GroupRef[];
  nameOf: (card: CategorizeCard) => string;
  canRemove: boolean;
  /** La tarjeta arrastrada caería aquí. */
  hot: boolean;
  /** Tarjeta que va en la mano (se atenúa en su lugar). */
  dragging: string | null;
  /** Sube un ícono a este grupo. */
  uploading: boolean;
  /** Hay una subida en curso (en cualquier grupo): no se empieza otra. */
  busy: boolean;
  /** Cuántas tarjetas caben aún en la pregunta. */
  left: number;
  /** A quién avisar lo escrito sin agregar. */
  report?: ReportDraft;
  /** Por qué no puede ir este texto en una tarjeta (sin contar la tarjeta `except`); null: puede. */
  textProblem: (text: string, except?: string) => string | null;
  onRename: (name: string) => void;
  onRenameDone: () => void;
  onRemove: () => void;
  onAddText: (text: string) => void;
  onIconFile: (file: File) => void;
  onMove: (cardId: string, groupId: string) => void;
  onRemoveCard: (cardId: string) => void;
  onEditText: (cardId: string, text: string) => void;
  /** Un texto nuevo que no se pudo poner al salir del campo (vacío o repetido): se avisa, no se pierde en silencio. */
  onEditRejected: (message: string) => void;
}) {
  const full = left <= 0;
  const { setNodeRef } = useDroppable({ id: groupDropId(group.id) });
  const { over, dropProps } = useFileDrop(onIconFile, !busy && !full);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div
      ref={setNodeRef}
      data-group-col=""
      {...dropProps}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-2 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
        dragging && "border-dashed border-primary/40",
        hot && "border-solid border-primary bg-primary/5 ring-4 ring-primary/15"
      )}
    >
      <DropVeil show={over} text="Suelta la imagen: será una tarjeta de este grupo" />
      <div className="flex items-center gap-1">
        <Input
          data-group-name={group.id}
          value={group.name}
          maxLength={MAX_GROUP_NAME}
          placeholder={`Grupo ${index + 1}`}
          aria-label={`Nombre del grupo ${index + 1}`}
          onChange={(e) => onRename(e.target.value)}
          onBlur={onRenameDone}
          className="h-8 border-transparent bg-transparent px-1.5 text-center font-semibold shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Quitar el grupo ${label}`}
          title={canRemove ? `Quitar el grupo ${label}` : "Se necesitan al menos dos grupos"}
          disabled={!canRemove}
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          <X aria-hidden />
        </Button>
      </div>

      <div className="flex min-h-12 flex-wrap content-start items-center justify-center gap-1.5">
        {cards.length === 0 && <p className="px-1 text-center text-xs text-muted-foreground">Sin tarjetas: agrega una o arrástrala aquí</p>}
        {cards.map((card) =>
          editing === card.id ? (
            <CardTextEdit
              key={card.id}
              initial={card.text ?? ""}
              problemOf={(text) => textProblem(text, card.id)}
              onDone={(text) => {
                setEditing(null);
                if (text !== null) onEditText(card.id, text);
              }}
              onRejected={onEditRejected}
              cardId={card.id}
            />
          ) : (
            <EditorCard
              key={card.id}
              card={card}
              name={nameOf(card)}
              others={others}
              faded={dragging === card.id}
              onMove={(groupId) => onMove(card.id, groupId)}
              onRemove={() => onRemoveCard(card.id)}
              onEdit={() => setEditing(card.id)}
            />
          )
        )}
      </div>

      <CardAdder
        groupId={group.id}
        label={label}
        uploading={uploading}
        busy={busy}
        left={left}
        report={report}
        problemOf={(text) => textProblem(text)}
        onAddText={onAddText}
        onIconFile={onIconFile}
      />
    </div>
  );
}

/** Una tarjeta del editor: su cara (se toma para arrastrarla), su menú y su ×. */
function EditorCard({
  card,
  name,
  others,
  faded,
  onMove,
  onRemove,
  onEdit,
}: {
  card: CategorizeCard;
  name: string;
  others: GroupRef[];
  faded: boolean;
  onMove: (groupId: string) => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: cardDragId(card.id) });
  /** Se eligió algo del menú: el foco lo decide esa acción, no el menú al cerrarse. */
  const acted = useRef(false);
  const hasMenu = others.length > 0 || card.kind === "text";
  const act = (fn: () => void) => () => {
    acted.current = true;
    fn();
  };
  return (
    <span ref={setNodeRef} className={cn(chipLook(card.kind), "gap-0.5 pr-1", faded && "opacity-35")}>
      <span
        {...listeners}
        title="Arrastra para cambiarla de grupo"
        className="flex min-w-0 cursor-grab touch-none items-center select-none active:cursor-grabbing"
      >
        <ChipFace face={card} />
      </span>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-card-menu={card.id} aria-label={`${name}: mover a otro grupo o cambiar`} className={SMALL_BUTTON}>
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-auto min-w-44"
            onCloseAutoFocus={(e) => {
              if (!acted.current) return;
              acted.current = false;
              e.preventDefault();
            }}
          >
            {others.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Mover a</DropdownMenuLabel>}
            {others.map((g) => (
              <DropdownMenuItem key={g.id} onSelect={act(() => onMove(g.id))}>
                <ArrowRightLeft aria-hidden />
                {g.label}
              </DropdownMenuItem>
            ))}
            {card.kind === "text" && (
              <>
                {others.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={act(onEdit)}>
                  <Pencil aria-hidden />
                  Cambiar texto
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        data-card-remove={card.id}
        aria-label={`Quitar ${name}`}
        onClick={onRemove}
        className={cn(SMALL_BUTTON, "hover:text-destructive")}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/**
 * Cambiar el texto de una tarjeta ahí mismo: Enter o salir guarda; Esc deja el
 * de antes. Si al salir el texto no sirve (vacío o repetido), la tarjeta se
 * queda como estaba y se avisa (`onRejected`).
 */
function CardTextEdit({
  cardId,
  initial,
  problemOf,
  onDone,
  onRejected,
}: {
  cardId: string;
  initial: string;
  problemOf: (text: string) => string | null;
  /** El texto nuevo, o null si no cambia. */
  onDone: (text: string | null) => void;
  onRejected: (message: string) => void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const problemId = useId();
  const empty = !text.trim();
  const problem = empty ? "Escribe el texto de la tarjeta" : problemOf(text);
  function finish(how: "enter" | "escape" | "blur") {
    if (done.current) return;
    done.current = true;
    const changed = text.trim() !== initial.trim();
    onDone(how !== "escape" && !problem && changed ? text.trim() : null);
    if (how === "blur" && problem && changed) {
      onRejected(`No se cambió «${initial.trim()}»: ${empty ? "el texto quedó vacío" : "ya hay otra tarjeta con ese texto"}`);
    }
    // Con Enter o Esc el foco vuelve al menú de la tarjeta (aparece en el siguiente
    // cuadro); al salir con un clic se queda donde se hizo clic, salvo que no haya caído en nada
    requestAnimationFrame(() => {
      if (how === "blur" && document.activeElement && document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>(`[data-card-menu="${CSS.escape(cardId)}"]`)?.focus();
    });
  }
  return (
    <span className="grid w-full gap-1">
      <Input
        autoFocus
        value={text}
        maxLength={MAX_CARD_TEXT}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!problem) finish("enter");
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish("escape");
          }
        }}
        onBlur={() => finish("blur")}
        aria-label="Texto de la tarjeta"
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        className="h-8 text-sm"
      />
      {problem && (
        <span id={problemId} role="status" className="text-xs text-amber-700 dark:text-warning">
          {problem}
        </span>
      )}
    </span>
  );
}
