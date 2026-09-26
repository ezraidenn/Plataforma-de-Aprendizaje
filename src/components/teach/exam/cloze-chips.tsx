"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useReportDraft, type ReportDraft } from "./use-pending-drafts";

/**
 * Fichas editables del editor de «Completar el texto»: las variantes o las
 * opciones incorrectas de un hueco, y los distractores del banco. Cada ficha
 * se quita con su ×; «+ …» abre un campo en línea: Enter agrega y lo deja
 * listo para otra, Esc lo cierra. Lo que no se puede agregar (repetido, con
 * «|», …) se dice bajo el campo mientras se escribe, y lo escrito sin agregar
 * se avisa al editor (`report`): así «Guardar» no lo pierde en silencio. Al
 * llegar al máximo, el campo se cierra.
 */
export function ChipField({
  items,
  tone,
  noun,
  context,
  max,
  problemOf,
  onAdd,
  onRemove,
  report,
}: {
  items: string[];
  /** «ok»: verde (variantes aceptadas); «bad»: rojo (incorrectas, distractores). */
  tone: "ok" | "bad";
  /** Qué se agrega: «variante», «incorrecta», «distractor» (el botón dice «+ variante»). */
  noun: string;
  /** Para leer cada botón: «del hueco 1», «del banco». */
  context: string;
  max?: number;
  /** Por qué no se puede agregar lo escrito (null: se puede). */
  problemOf: (value: string) => string | null;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
  /** A quién avisar lo escrito sin agregar. */
  report?: ReportDraft;
}) {
  /** Lo que se escribe; null = cerrado. */
  const [draft, setDraft] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** A dónde va el foco tras quitar o agregar una ficha, o cerrar el campo: la × de esa ficha o «+ …». */
  const refocus = useRef<number | "add" | null>(null);
  const problemId = useId();
  const full = max !== undefined && items.length >= max;
  const problem = draft?.trim() ? problemOf(draft) : null;
  // Con el tope lleno no hay campo a la vista: nada pendiente que trabe «Guardar»
  useReportDraft(report, `${noun} ${context}`, full ? null : draft);

  useEffect(() => {
    const target = refocus.current;
    if (target === null) return;
    refocus.current = null;
    const root = rootRef.current;
    const removes = root?.querySelectorAll<HTMLElement>("[data-chip-remove]") ?? [];
    const el = typeof target === "number" ? (removes[target] ?? removes[target - 1]) : null;
    (el ?? root?.querySelector<HTMLElement>("[data-chip-add]"))?.focus();
  });

  function add() {
    const value = (draft ?? "").trim();
    if (!value || problem || full) return;
    onAdd(value);
    if (max !== undefined && items.length + 1 >= max) {
      // Ya no cabe otra: el campo se cierra y el foco queda en la ficha nueva
      refocus.current = items.length;
      setDraft(null);
    } else {
      setDraft("");
    }
  }

  function close() {
    refocus.current = "add";
    setDraft(null);
  }

  const chip = tone === "ok" ? "bg-success/12 ring-success/40" : "bg-destructive/10 ring-destructive/30";

  return (
    <div ref={rootRef} className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${i}-${item}`}
          className={cn("inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2 text-xs font-medium ring-1 ring-inset", chip)}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
          <button
            type="button"
            data-chip-remove=""
            aria-label={`Quitar «${item}» ${context}`}
            onClick={() => {
              refocus.current = i;
              onRemove(i);
            }}
            className="rounded-full p-0.5 text-muted-foreground outline-none hover:bg-background hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {full ? (
        <span className="text-xs text-muted-foreground">Máximo {max}</span>
      ) : draft !== null ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            onBlur={() => {
              // Vacío y sin foco: se cierra solo; con algo escrito se queda (y «Guardar» avisa que falta agregarlo)
              if (!draft.trim()) setDraft(null);
            }}
            aria-label={`Nueva ${noun === "distractor" ? "palabra de más" : noun} ${context}`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            placeholder={noun === "distractor" ? "Palabra y Enter" : `${noun[0].toUpperCase()}${noun.slice(1)} y Enter`}
            className="h-7 w-40 text-xs"
          />
          <button
            type="button"
            aria-label="Cerrar sin agregar"
            onClick={close}
            className="rounded-full p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-3.5" aria-hidden />
          </button>
          {problem && (
            <span id={problemId} role="status" className="w-full text-xs text-amber-700 dark:text-warning">
              {problem}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          data-chip-add=""
          aria-label={`Agregar ${noun} ${context}`}
          onClick={() => setDraft("")}
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground outline-none hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="size-3" aria-hidden />
          {noun}
        </button>
      )}
    </div>
  );
}
