"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { Check, Crop, ImageUp, Loader2, RotateCcw, RotateCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStableHandler } from "@/components/exam/image-dnd";
import { shapedImageValue as shaped, type ImageQuestionValue } from "@/lib/image-editor-value";
import { cropConfig, rotateConfig } from "@/lib/image-layout";
import { transformPhoto } from "@/lib/image-processing";
import {
  fileUrl,
  validAspect,
  type ImageClickConfig,
  type ImageDragConfig,
  type ImageQuestionType,
} from "@/lib/image-questions";
import { FULL_CROP, cropRatio, fitCropRatio, isFullCrop, type CropChoice, type CropRect } from "@/lib/photo-crop";
import { plural } from "@/lib/plural";
import { uploadFile } from "@/lib/upload-client";
import { cn } from "@/lib/utils";
import { CropCover } from "./image-crop-cover";
import { isTypingTarget } from "./use-editor-history";

/**
 * Herramientas de la foto de fondo en la barra del lienzo (arrastrar y
 * señalar): Recortar foto, Girar a la izquierda y a la derecha, y Cambiar foto.
 *
 * Recortar abre un modo sobre la foto (`image-crop-cover.tsx`): la barra de
 * siempre deja su lugar a la del recorte (proporción Libre, Original, 1:1, 4:3
 * o 16:9, el zoom, Cancelar y Aplicar recorte) y, en vivo, cuántos lugares o
 * puntos quedan fuera y se quitarán. Aplicar y girar hacen la foto nueva en el
 * navegador (`transformPhoto`), la suben como `editor_image` (como «Cambiar
 * foto») y recolocan lugares y puntos (`cropConfig`, `rotateConfig`): la foto
 * y la config cambian en un solo paso del historial, así que deshacer vuelve a
 * la foto de antes (su archivo sigue ahí). Mientras se prepara y sube, «Guardar»
 * espera (`uploading`) y el botón lleva el indicador.
 */

type Uploading = "photo" | "icon" | null;
type Kind = "crop" | "cw" | "ccw";

const CHOICES: { choice: CropChoice; label: string; title: string; said: string }[] = [
  { choice: "free", label: "Libre", title: "Cualquier proporción", said: "libre" },
  { choice: "original", label: "Original", title: "La proporción de la foto", said: "la de la foto" },
  { choice: "1:1", label: "1:1", title: "Cuadrada", said: "cuadrada" },
  { choice: "4:3", label: "4:3", title: "4:3 (3:4 con una foto vertical)", said: "4:3" },
  { choice: "16:9", label: "16:9", title: "16:9 (9:16 con una foto vertical)", said: "16:9" },
];

const PRECISION_NOTE = "La precisión es relativa al ancho de la foto: revisa que el círculo siga siendo el que quieres.";

/** «1 lugar queda fuera y se quitará», «2 puntos quedan fuera y se quitarán». */
export function outsideText(n: number, what: readonly [string, string]): string {
  return `${n} ${plural(n, what[0], what[1])} ${plural(n, "queda", "quedan")} fuera y se ${plural(n, "quitará", "quitarán")}`;
}

/** La foto de ahora como archivo, con su nombre (el de la descarga). */
async function fetchPhoto(fileId: string): Promise<File> {
  const res = await fetch(fileUrl(fileId)).catch(() => null);
  if (!res?.ok) throw new Error("No se pudo leer la foto: vuelve a subirla.");
  const blob = await res.blob();
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
  let name = "foto";
  try {
    if (encoded) name = decodeURIComponent(encoded);
  } catch {
    // Un nombre ilegible: se queda «foto»
  }
  return new File([blob], name, { type: blob.type });
}

export type PhotoTools = ReturnType<typeof usePhotoTools>;

export function usePhotoTools({
  type,
  imageFileId,
  config,
  record,
  uploading,
  setUploading,
  setError,
  setNotice,
  announce,
  rootRef,
  onPickPhoto,
}: {
  type: ImageQuestionType;
  imageFileId: string | null;
  config: ImageDragConfig | ImageClickConfig;
  /** Cambia la foto y la config (un paso del historial). */
  record: (fn: (prev: ImageQuestionValue) => ImageQuestionValue) => ImageQuestionValue;
  uploading: Uploading;
  setUploading: (u: Uploading) => void;
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  /** El editor: ahí vuelve el foco y ahí cuenta Esc. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** «Cambiar foto»: elegir otro archivo. */
  onPickPhoto: () => void;
}) {
  const [crop, setCrop] = useState<{ fileId: string; rect: CropRect; choice: CropChoice } | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  // El recorte es de una foto: si cambió (deshacer, soltar otra), se deja (y no vuelve al volver a ella)
  if (crop && crop.fileId !== imageFileId) setCrop(null);
  const active = crop && crop.fileId === imageFileId ? crop : null;
  const { aspect } = config;
  /** Otra subida en curso, o la foto aún sin medir: las herramientas esperan. */
  const locked = uploading !== null || !imageFileId || !validAspect(aspect);
  const what = type === "image_drag" ? (["lugar", "lugares"] as const) : (["punto", "puntos"] as const);
  const outside = active ? cropConfig(type, config, active.rect).removed : 0;

  const focusSoon = (selector: string) =>
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
  const inEditor = () => !!rootRef.current?.contains(document.activeElement);
  const waitSaid = () => announce(uploading !== null ? "Espera a que termine la subida" : "Espera a que cargue la foto");

  function startCrop() {
    if (locked || !imageFileId) return waitSaid();
    setCrop({ fileId: imageFileId, rect: FULL_CROP, choice: "free" });
    setNotice(null);
    announce(
      "Recorte: arrastra el rectángulo o sus tiradores. Con el teclado, las flechas lo mueven y + y − lo agrandan o achican; Enter aplica el recorte y Esc lo cancela."
    );
    focusSoon("[data-crop-box]");
  }

  const cancelCrop = useStableHandler(() => {
    if (!active || busy) return;
    const hadFocus = inEditor();
    setCrop(null);
    announce("Recorte cancelado");
    if (hadFocus) focusSoon('[data-photo-tool="crop"]');
  });

  // Esc cancela el recorte, con el foco en el editor (o en ninguna parte)
  const cropping = active !== null;
  useEffect(() => {
    if (!cropping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (e.target !== document.body && !rootRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      cancelCrop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cropping, cancelCrop, rootRef]);

  function choose(choice: CropChoice) {
    if (busy) return;
    const R = cropRatio(choice, aspect);
    setCrop((c) => c && { ...c, choice, rect: R === null ? c.rect : fitCropRatio(c.rect, R, aspect) });
    announce(`Proporción ${CHOICES.find((c) => c.choice === choice)?.said ?? ""}`);
  }

  /** Recorta o gira: la foto nueva, subida, y la config recolocada, en un solo paso. */
  async function transform(kind: Kind) {
    if (busy) return;
    if (locked || !imageFileId) return waitSaid();
    const from = imageFileId;
    const rect = active?.rect;
    if (kind === "crop" && (!rect || isFullCrop(rect))) {
      return announce("Mueve el rectángulo o sus tiradores para recortar: así la foto quedaría igual");
    }
    const hadFocus = inEditor();
    setBusy(kind);
    setUploading("photo");
    setError(null);
    setNotice(null);
    announce(kind === "crop" ? "Recortando la foto…" : "Girando la foto…");
    try {
      const original = await fetchPhoto(from);
      const done = await transformPhoto(original, kind === "crop" ? { crop: rect! } : { rotate: kind }).catch((err: unknown) => {
        console.error("No se pudo preparar la foto:", err);
        throw new Error("Este navegador no pudo preparar la foto: recórtala o gírala antes y súbela con «Cambiar foto».");
      });
      const fileId = await uploadFile(new File([done.blob], done.name, { type: done.blob.type }), "editor_image");
      let removed = -1;
      record((prev) => {
        const p = shaped(type, prev);
        // Mientras se preparaba se cambió la foto (deshacer, otra foto): no se toca nada
        if (p.imageFileId !== from) return prev;
        const next =
          kind === "crop" ? cropConfig(type, p.config, done.crop ?? rect!) : { config: rotateConfig(type, p.config, kind), removed: 0 };
        removed = next.removed;
        return { imageFileId: fileId, config: { ...next.config, aspect: done.aspect } };
      });
      if (removed < 0) {
        const text = "La foto cambió mientras se preparaba: no se aplicó.";
        setNotice(text);
        return announce(text);
      }
      if (kind === "crop") {
        setCrop(null);
        if (hadFocus) focusSoon('[data-photo-tool="crop"]');
      }
      const gone =
        removed > 0
          ? `Se ${plural(removed, "quitó", "quitaron")} ${removed} ${plural(removed, what[0], what[1])} que ${plural(removed, "quedaba", "quedaban")} fuera (Deshacer ${plural(removed, "lo", "los")} devuelve).`
          : "";
      // En «señalar» el círculo de acierto es una fracción del ancho, y el ancho cambió
      const precision = type === "image_click" && (kind === "crop" || aspect !== 1) ? PRECISION_NOTE : "";
      const note = [gone, precision].filter(Boolean).join(" ");
      if (note) setNotice(note);
      const said = kind === "crop" ? "Foto recortada" : `Foto girada a la ${kind === "cw" ? "derecha" : "izquierda"}`;
      announce(`${said}; los ${what[1]} siguen sobre lo mismo. ${note}`.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo preparar la foto");
    } finally {
      setBusy(null);
      setUploading(null);
    }
  }

  return {
    /** Recortando: el rectángulo y la proporción elegida. */
    crop: active,
    /** Lo que se está haciendo: su botón lleva el indicador. */
    busy,
    locked,
    uploading,
    /** Lugares o puntos que el recorte de ahora dejaría fuera. */
    outside,
    what,
    startCrop,
    cancelCrop,
    choose,
    applyCrop: () => void transform("crop"),
    rotate: (dir: "cw" | "ccw") => void transform(dir),
    changePhoto: () => (uploading !== null ? waitSaid() : onPickPhoto()),
    /** El rectángulo sobre la foto (para `ImageCanvas`), solo mientras se recorta. */
    cover: active ? (
      <CropCover
        rect={active.rect}
        ratio={cropRatio(active.choice, aspect)}
        aspect={aspect}
        busy={busy !== null}
        onChange={(rect) => setCrop((c) => c && { ...c, rect })}
        onApply={() => void transform("crop")}
      />
    ) : null,
  };
}

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

/** Las teclas de la barra del recorte no son atajos del editor (Ctrl+A, Supr, Ctrl+Z…); Esc y Tab, sí siguen. */
function keepKeys(e: React.KeyboardEvent) {
  if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
}

/** La barra mientras se recorta: proporción, el zoom (`zoom`), Cancelar y Aplicar, y lo que queda fuera. */
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
          {CHOICES.map(({ choice, label, title }) => (
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
      {/* La pista y el aviso en el mismo lugar: al aparecer el aviso, el lienzo no brinca a medio arrastre */}
      <div className="grid text-xs">
        <p aria-hidden={outside > 0} className={cn("text-muted-foreground [grid-area:1/1]", outside > 0 && "invisible")}>
          Arrastra el rectángulo o sus tiradores; con el teclado, las flechas lo mueven y + y − lo agrandan o achican.
          Enter aplica y Esc cancela.
        </p>
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 font-medium text-amber-700 [grid-area:1/1] dark:text-warning",
            outside === 0 && "invisible"
          )}
        >
          {outside > 0 && <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />}
          {outside > 0 && `${outsideText(outside, what)}.`}
        </p>
      </div>
    </div>
  );
}
