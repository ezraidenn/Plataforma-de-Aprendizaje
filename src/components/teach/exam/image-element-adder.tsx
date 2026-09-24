"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EDITOR_IMAGE_ACCEPT } from "@/lib/upload-client";
import { MAX_ELEMENTS, MAX_LABEL, type ImageElement } from "@/lib/image-questions";
import { DUPLICATE } from "./use-editor-icons";

/**
 * Bajo la lista de elementos del editor de «arrastrar»: agregar un ícono (abre
 * el selector de archivos) o una etiqueta de texto (un campo con su botón; una
 * etiqueta repetida se avisa y no se agrega). Enter agrega y deja el campo
 * listo para otra; Esc lo cierra.
 */
export function ElementAdder({
  elements,
  uploading,
  announce,
  onIconFile,
  onAddLabel,
}: {
  elements: ImageElement[];
  uploading: "photo" | "icon" | null;
  announce: (text: string) => void;
  onIconFile: (file: File) => void;
  /** Una etiqueta nueva, ya revisada (no vacía ni repetida). */
  onAddLabel: (text: string) => void;
}) {
  const iconInput = useRef<HTMLInputElement>(null);
  const textButton = useRef<HTMLButtonElement>(null);
  /** Al cerrar el campo, el foco vuelve a «Texto». */
  const refocus = useRef(false);
  /** Etiqueta nueva que se escribe; null = cerrado. */
  const [label, setLabel] = useState<string | null>(null);
  const full = elements.length >= MAX_ELEMENTS;
  const taken = (text: string) =>
    elements.some((e) => e.kind === "text" && (e.text ?? "").trim().toLowerCase() === text.trim().toLowerCase());

  useEffect(() => {
    if (label !== null || !refocus.current) return;
    refocus.current = false;
    textButton.current?.focus();
  }, [label]);

  function add() {
    const text = (label ?? "").trim();
    if (!text || full) return;
    // El aviso ya se ve bajo el campo; aquí solo se dice en voz alta
    if (taken(text)) return announce(DUPLICATE);
    onAddLabel(text);
    setLabel("");
  }

  function close() {
    refocus.current = true;
    setLabel(null);
  }

  return (
    <>
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
      {label !== null ? (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <Input
              autoFocus
              data-label-input=""
              value={label}
              maxLength={MAX_LABEL}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
              }}
              placeholder="Texto de la etiqueta"
              aria-label="Texto de la etiqueta nueva"
              className="h-9"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0"
              aria-label="Cerrar sin agregar"
              onClick={close}
            >
              <X aria-hidden />
            </Button>
          </div>
          {label.trim() && taken(label) ? (
            <p className="text-xs text-amber-700 dark:text-warning">{DUPLICATE}</p>
          ) : (
            <Button type="button" size="sm" className="w-full" disabled={!label.trim() || full} onClick={add}>
              Agregar etiqueta
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-add-icon=""
            aria-label="Agregar ícono"
            disabled={full}
            // Mientras sube no se deshabilita del todo: así el foco no se pierde
            aria-disabled={uploading !== null}
            className="aria-disabled:opacity-60"
            onClick={() => uploading === null && iconInput.current?.click()}
          >
            {uploading === "icon" ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            {uploading === "icon" ? "Subiendo…" : "Ícono"}
          </Button>
          <Button
            ref={textButton}
            type="button"
            size="sm"
            variant="outline"
            data-add-text=""
            aria-label="Agregar etiqueta de texto"
            disabled={full}
            onClick={() => setLabel("")}
          >
            <Plus aria-hidden />
            Texto
          </Button>
        </div>
      )}
      {full && <p className="text-xs text-muted-foreground">Llegaste al máximo de {MAX_ELEMENTS} elementos.</p>}
    </>
  );
}
