"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CARDS, MAX_CARD_TEXT } from "@/lib/categorize";
import { EDITOR_IMAGE_ACCEPT } from "@/lib/upload-client";
import { useReportDraft, type ReportDraft } from "./use-pending-drafts";

/**
 * Bajo las tarjetas de un grupo del editor de «Clasificar en grupos»: «+ Texto»
 * (un campo en línea: Enter agrega y lo deja listo para otra, Esc lo cierra) y
 * «+ Ícono» (el selector de archivos). Lo escrito sin agregar se avisa al
 * editor (`report`), así «Guardar» no lo pierde en silencio. Con la última
 * tarjeta que cabe el campo se cierra y, en lugar de los botones, dice «Máximo
 * 30 tarjetas» (también si se llenó desde otro grupo con el campo abierto).
 */
export function CardAdder({
  groupId,
  label,
  uploading,
  busy,
  left,
  report,
  problemOf,
  onAddText,
  onIconFile,
}: {
  groupId: string;
  /** Nombre del grupo, o «Grupo N» mientras no tiene. */
  label: string;
  /** Sube un ícono a este grupo. */
  uploading: boolean;
  /** Hay una subida en curso (en cualquier grupo): no se empieza otra. */
  busy: boolean;
  /** Cuántas tarjetas caben aún en la pregunta. */
  left: number;
  /** A quién avisar lo escrito sin agregar. */
  report?: ReportDraft;
  /** Por qué no puede ir este texto en una tarjeta (null: puede). */
  problemOf: (text: string) => string | null;
  onAddText: (text: string) => void;
  onIconFile: (file: File) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const textButton = useRef<HTMLButtonElement>(null);
  /** Texto nuevo que se escribe; null = cerrado. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Al cerrar el campo, el foco vuelve a «Texto». */
  const refocus = useRef(false);
  const problemId = useId();
  const full = left <= 0;
  const problem = draft?.trim() ? problemOf(draft) : null;
  // Lleno, no hay campo a la vista: nada pendiente que trabe «Guardar»
  useReportDraft(report, `text:${groupId}`, full ? null : draft);

  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    textButton.current?.focus();
  }, [draft]);

  // Se llenó con el campo abierto (desde otro grupo, o un ícono): se cierra
  useEffect(() => {
    if (full && draft !== null) setDraft(null);
  }, [full, draft]);

  function add() {
    const text = (draft ?? "").trim();
    if (!text || problem || full) return;
    onAddText(text);
    if (left > 1) {
      setDraft("");
      return;
    }
    // Era la última que cabía: el campo se cierra y el foco va a la tarjeta nueva
    setDraft(null);
    requestAnimationFrame(() => {
      const removes = rootRef.current?.closest("[data-group-col]")?.querySelectorAll<HTMLElement>("[data-card-remove]");
      removes?.[removes.length - 1]?.focus();
    });
  }

  function close() {
    refocus.current = true;
    setDraft(null);
  }

  return (
    // Al pie de la columna: los botones quedan a la misma altura en todos los grupos
    <div ref={rootRef} className="mt-auto">
      <input
        ref={iconInput}
        type="file"
        accept={EDITOR_IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onIconFile(file);
        }}
      />
      {full ? (
        <p className="py-1 text-center text-xs text-muted-foreground">Máximo {MAX_CARDS} tarjetas</p>
      ) : draft !== null ? (
        <div className="space-y-1">
          <div className="flex gap-1">
            <Input
              autoFocus
              value={draft}
              maxLength={MAX_CARD_TEXT}
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
              placeholder="Texto y Enter"
              aria-label={`Texto de la tarjeta nueva de ${label}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? problemId : undefined}
              className="h-8 text-sm"
            />
            <Button type="button" size="icon-sm" variant="ghost" className="size-8 shrink-0" aria-label="Cerrar sin agregar" onClick={close}>
              <X aria-hidden />
            </Button>
          </div>
          {problem && (
            <p id={problemId} role="status" className="text-xs text-amber-700 dark:text-warning">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          <Button
            ref={textButton}
            type="button"
            size="sm"
            variant="outline"
            data-add-text={groupId}
            aria-label={`Agregar tarjeta de texto a ${label}`}
            onClick={() => setDraft("")}
          >
            <Plus aria-hidden />
            Texto
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Agregar tarjeta con ícono a ${label}`}
            // Mientras sube no se deshabilita del todo: así el foco no se pierde
            aria-disabled={busy}
            className="aria-disabled:opacity-60"
            onClick={() => !busy && iconInput.current?.click()}
          >
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            {uploading ? "Subiendo…" : "Ícono"}
          </Button>
        </div>
      )}
    </div>
  );
}
