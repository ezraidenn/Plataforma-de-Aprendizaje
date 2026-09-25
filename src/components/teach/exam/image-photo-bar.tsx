"use client";

import type { ReactNode } from "react";
import { Check, Crop, ImageUp, Loader2, RotateCcw, RotateCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isFullCrop } from "@/lib/photo-crop";
import { cn } from "@/lib/utils";
import { CROP_CHOICES, outsideText, type PhotoTools } from "./image-photo-tools";
import { blockEditorShortcut, isUndoKey } from "./use-editor-history";

/**
 * Lo que se ve de las herramientas de la foto (`usePhotoTools`): su grupo en
 * la barra del lienzo (Recortar foto, Girar ⟲ ⟳, Cambiar foto) y, mientras
 * se recorta, la barra del recorte que va en lugar de la de siempre.
 */

const spinner = <Loader2 className="animate-spin" aria-hidden />;

/** Recortar, girar y cambiar la foto: su grupo en la barra. */
export function PhotoButtons({ photo }: { photo: PhotoTools }) {
  const { busy, locked, what } = photo;
  const changing = photo.uploading === "photo" && busy === null;
  return (
    <div role="group" aria-label="La foto" className="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-photo-tool="crop"
        aria-disabled={locked}
        aria-busy={busy === "crop" || undefined}
        className="aria-disabled:opacity-50"
        title={`Recortar la foto: los ${what[1]} se recolocan solos`}
        onClick={photo.startCrop}
      >
        {busy === "crop" ? spinner : <Crop aria-hidden />}
        Recortar foto
      </Button>
      {(["ccw", "cw"] as const).map((dir) => (
        <Button
          key={dir}
          type="button"
          size="icon-sm"
          variant="outline"
          data-photo-tool={dir}
          aria-label={dir === "cw" ? "Girar a la derecha" : "Girar a la izquierda"}
          title={`Girar la foto 90° a la ${dir === "cw" ? "derecha" : "izquierda"}: los ${what[1]} giran con ella`}
          aria-disabled={locked}
          aria-busy={busy === dir || undefined}
          className="aria-disabled:opacity-50"
          onClick={() => photo.rotate(dir)}
        >
          {busy === dir ? spinner : dir === "cw" ? <RotateCw aria-hidden /> : <RotateCcw aria-hidden />}
        </Button>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-photo-tool="change"
        // Mientras sube no se deshabilita del todo: así el foco no se pierde (ni Ctrl+Z)
        aria-disabled={photo.uploading !== null}
        className="aria-disabled:opacity-50"
        title={`Cambiar la foto por otra: los ${what[1]} se conservan`}
        onClick={photo.changePhoto}
      >
        {changing ? spinner : <ImageUp aria-hidden />}
        {changing ? "Subiendo…" : "Cambiar foto"}
      </Button>
    </div>
  );
}

/**
 * Las teclas de la barra del recorte no son atajos del editor (Ctrl+A, Supr…) ni del navegador (Ctrl+A, Ctrl+D).
 * Esc y Tab siguen, y también Ctrl+Z: el editor dice que mientras se recorta
 * no se deshace.
 */
function keepKeys(e: React.KeyboardEvent) {
  if (e.key === "Escape" || e.key === "Tab" || isUndoKey(e)) return;
  e.stopPropagation();
  blockEditorShortcut(e);
}

/**
 * La barra mientras se recorta: proporción, el zoom (`zoom`), Cancelar y
 * Aplicar y, debajo, cuántos lugares o puntos quedan fuera (siempre en el
 * mismo sitio: el lienzo no brinca a medio arrastre). Las teclas, en la pista
 * de abajo del lienzo (`CROP_HINT`).
 */
export function CropBar({ photo, zoom }: { photo: PhotoTools; zoom: ReactNode }) {
  const { crop, outside, what } = photo;
  if (!crop) return null;
  const working = photo.busy === "crop";
  const same = isFullCrop(crop.rect);
  return (
    <div className="space-y-1.5" onKeyDown={keepKeys}>
      <div
        role="group"
        aria-label="Recortar la foto"
        className="flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-xl border border-primary/40 bg-primary/5 p-1.5"
      >
        <span className="flex items-center gap-1.5 px-1.5 text-sm font-semibold text-primary">
          <Crop className="size-4" aria-hidden />
          Recortar foto
        </span>
        <div role="group" aria-label="Proporción" className="inline-flex overflow-hidden rounded-lg border bg-background">
          {CROP_CHOICES.map(({ choice, label, title }) => (
            <button
              key={choice}
              type="button"
              aria-pressed={choice === crop.choice}
              title={title}
              onClick={() => photo.choose(choice)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                choice === crop.choice
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
        {zoom}
        {/* Juntos y a la derecha, también si la barra se parte en dos filas */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-disabled={working}
            aria-keyshortcuts="Escape"
            className="aria-disabled:opacity-50"
            title="Cancelar el recorte (Esc)"
            onClick={photo.cancelCrop}
          >
            <X aria-hidden />
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            aria-disabled={working || same}
            aria-busy={working || undefined}
            className="aria-disabled:opacity-60"
            title={same ? "Mueve el rectángulo o sus tiradores para recortar" : "Aplicar el recorte (Enter sobre el rectángulo)"}
            onClick={photo.applyCrop}
          >
            {working ? spinner : <Check aria-hidden />}
            {working ? "Recortando…" : "Aplicar recorte"}
          </Button>
        </div>
      </div>
      <p
        role="status"
        className={cn(
          "flex items-start gap-1.5 text-xs",
          outside > 0 ? "font-medium text-amber-700 dark:text-warning" : "text-muted-foreground"
        )}
      >
        {outside > 0 && <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />}
        {outside > 0 ? `${outsideText(outside, what)}.` : `Todos los ${what[1]} quedan dentro del recorte.`}
      </p>
    </div>
  );
}
