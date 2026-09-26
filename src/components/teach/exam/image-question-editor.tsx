"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CheckCircle2, CircleAlert, ImagePlus, Loader2, TriangleAlert } from "lucide-react";
import { useFileDrop } from "@/components/exam/image-dnd";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import { imagePreview } from "@/lib/preview-question";
import { neutralImageName } from "@/lib/image-processing";
import { EDITOR_IMAGE_ACCEPT, uploadFile } from "@/lib/upload-client";
import { EDITOR_IMAGE_MAX_BYTES } from "@/lib/upload-types";
import {
  fileUrl,
  round4,
  validAspect,
  type ImageClickConfig,
  type ImageDragConfig,
  type ImageQuestionType,
  type Precision,
} from "@/lib/image-questions";
import {
  imageEditorProblem,
  imageQuestionProblem,
  shapedImageValue as shaped,
  type ImageQuestionValue,
} from "@/lib/image-editor-value";
import { cn } from "@/lib/utils";
import { HistoryButtons } from "./image-canvas-toolbar";
import { ClickEditor } from "./image-click-editor";
import { DragEditor } from "./image-drag-editor";
import { usePhotoTools, type Answered } from "./image-photo-tools";
import { DraftPreviewButton } from "./preview-button";
import { Segmented } from "./segmented";
import { isTypingTarget, useEditorHistory, type HistoryOptions } from "./use-editor-history";

/**
 * Editor de las preguntas sobre imagen, dentro del banco de preguntas. Primero
 * la foto (clic o soltar el archivo); «Cambiar foto» (o soltar otra sobre la
 * foto) conserva lugares y puntos porque son relativos a la foto, y recortarla
 * o girarla los recoloca (`image-photo-tools.tsx`; esas herramientas van en la
 * barra de la foto). Lo propio de cada tipo vive en `image-drag-editor.tsx` y
 * `image-click-editor.tsx`; el valor (qué se abre, su forma, qué impide
 * guardar), en `image-editor-value.ts`.
 * Todo cambio (la foto y la config) pasa por el historial: Deshacer y Rehacer
 * (en la barra de la foto de cada tipo), también con Ctrl+Z y Ctrl+Mayús+Z o
 * Ctrl+Y mientras el foco está en el editor y no en un campo de texto. Debajo,
 * el problema que impediría guardar, en vivo.
 */

type SetValue = Dispatch<SetStateAction<ImageQuestionValue>>;

const PRECISIONS: [Precision, string][] = [
  ["sm", "Estricta"],
  ["md", "Normal"],
  ["lg", "Amplia"],
];

/** Alto / ancho de una imagen, ya decodificada por el navegador. */
function measureAspect(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      img.naturalWidth > 0 ? resolve(round4(img.naturalHeight / img.naturalWidth)) : reject(new Error("sin tamaño"));
    img.onerror = () => reject(new Error("no se pudo leer"));
    img.src = src;
  });
}

export function ImageQuestionEditor({
  type,
  value,
  onChange,
  onBusyChange,
  answered = null,
}: {
  type: ImageQuestionType;
  value: ImageQuestionValue;
  onChange: SetValue;
  /** Hay una subida en curso: mientras tanto no se guarda. */
  onBusyChange?: (busy: boolean) => void;
  /** El examen ya tiene intentos, o la pregunta respuestas en uno en curso: cambiar, recortar o girar la foto pide confirmación. */
  answered?: Answered;
}) {
  const [uploading, setUploading] = useState<"photo" | "icon" | null>(null);
  /** Error de una subida o de la foto. */
  const [error, setError] = useState<string | null>(null);
  /** Aviso de algo que no se hizo (repetido, límite). */
  const [notice, setNotice] = useState<string | null>(null);
  const { live, announce } = useAnnouncer();
  const rootRef = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const history = useEditorHistory(value, onChange);
  const { set: record } = history;
  const current = shaped(type, value);
  const { imageFileId, config } = current;
  const savedAspect = config.aspect;

  // Lo guardado arriba también toma la forma del tipo (es lo que se envía)
  useEffect(() => {
    if (current !== value) record((prev) => shaped(type, prev), { silent: true });
  }, [current, value, type, record]);

  useEffect(() => {
    onBusyChange?.(uploading !== null);
  }, [uploading, onBusyChange]);
  // Si el editor se cierra a media subida, «Guardar» no se queda deshabilitado
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // La proporción sale de la foto misma: si la guardada no cuadra (o falta), se
  // corrige (tampoco es un paso: deshacer hasta antes de medirla la vuelve a medir)
  useEffect(() => {
    if (!imageFileId) return;
    let alive = true;
    measureAspect(fileUrl(imageFileId)).then(
      (aspect) => {
        if (!alive) return;
        record(
          (prev) =>
            prev.imageFileId !== imageFileId || Math.abs(prev.config.aspect - aspect) < 1e-3
              ? prev
              : { ...prev, config: { ...prev.config, aspect } },
          { silent: true }
        );
      },
      () => {
        if (alive) setError("No se pudo cargar la foto: vuelve a subirla");
      }
    );
    return () => {
      alive = false;
    };
  }, [imageFileId, savedAspect, record]);

  async function uploadPhoto(file: File) {
    if (uploading) return;
    // El candado va antes de medir: dos fotos soltadas casi a la vez no se suben las dos
    setUploading("photo");
    setError(null);
    setNotice(null);
    // Se mide antes de subir: si no sirve, ni se sube (no quedan archivos huérfanos)
    const local = URL.createObjectURL(file);
    const aspect = await measureAspect(local)
      .catch(() => null)
      .finally(() => URL.revokeObjectURL(local));
    if (aspect === null) {
      setError("No se pudo leer la imagen: usa una foto PNG, JPG, WEBP o GIF.");
      setUploading(null);
      return;
    }
    if (!validAspect(aspect)) {
      setError("La foto es demasiado alargada: recórtala para que no sea más de diez veces más ancha que alta, ni al revés.");
      setUploading(null);
      return;
    }
    const hadPhoto = !!imageFileId;
    try {
      // Con un nombre neutro: el del archivo del maestro podría delatar la respuesta
      const fileId = await uploadFile(new File([file], neutralImageName("foto", file.type, file.name), { type: file.type }), "editor_image");
      record((prev) => ({ imageFileId: fileId, config: { ...shaped(type, prev).config, aspect } }));
      announce(hadPhoto ? "Foto cambiada; los lugares y puntos se conservan" : "Foto lista");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto");
    } finally {
      setUploading(null);
    }
  }

  /** Cambia la config por el historial (sin cambio, sin paso) y devuelve la nueva. */
  const setConfig = useCallback(
    <C extends ImageDragConfig | ImageClickConfig>(fn: (c: C) => C, options?: HistoryOptions): C =>
      record((prev) => {
        const p = shaped(type, prev);
        const config = fn(p.config as C);
        return config === p.config && p === prev ? prev : { ...p, config };
      }, options).config as C,
    [record, type]
  );

  const photo = usePhotoTools({
    type,
    imageFileId,
    config,
    record,
    undo: history.undo,
    answered,
    uploading,
    setUploading,
    setError,
    setNotice,
    announce,
    rootRef,
    onPickPhoto: () => photoInput.current?.click(),
    onPhotoFile: (file) => void uploadPhoto(file),
  });

  /** Deshacer o rehacer; si lo que tenía el foco desaparece, el foco se queda en el editor (en el de lugares o puntos, si lo hay). */
  function travel(to: "undo" | "redo") {
    const root = rootRef.current;
    const hadFocus = !!root?.contains(document.activeElement);
    const done = to === "undo" ? history.undo() : history.redo();
    if (done) setNotice(null);
    announce(done ? (to === "undo" ? "Cambio deshecho" : "Cambio rehecho") : to === "undo" ? "Nada que deshacer" : "Nada que rehacer");
    if (hadFocus) {
      requestAnimationFrame(() => {
        if (root && !root.contains(document.activeElement)) {
          (root.querySelector<HTMLElement>("[data-drag-editor], [data-click-editor]") ?? root).focus({ preventScroll: true });
        }
      });
    }
  }

  // Lo que impediría guardar (lugares encimados: con sus números)
  const problem = imageEditorProblem(type, current);
  // Mientras se mide la foto, una proporción cualquiera para dibujar el tablero
  const aspect = validAspect(config.aspect) ? config.aspect : 0.75;
  const undoRedo = {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: () => travel("undo"),
    redo: () => travel("redo"),
  };
  // Con foto van en la barra de la foto; sin ella (se deshizo hasta antes de subirla), aquí
  const historyButtons = (
    <HistoryButtons canUndo={undoRedo.canUndo} canRedo={undoRedo.canRedo} onUndo={undoRedo.undo} onRedo={undoRedo.redo} />
  );

  return (
    <div
      ref={rootRef}
      // Enfocable solo por código (o con un clic en un hueco): si lo enfocado desaparece al deshacer, los atajos siguen aquí
      tabIndex={-1}
      role="group"
      aria-label="Foto y respuestas de la pregunta"
      className="@container grid gap-3 outline-none"
      onKeyDown={(e) => {
        if (e.key === "Escape") setNotice(null);
        // Ctrl+Z deshace; Ctrl+Mayús+Z o Ctrl+Y rehacen. En un campo de texto, el suyo
        if (!(e.ctrlKey || e.metaKey) || e.altKey || isTypingTarget(e.target)) return;
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          // Mientras se recorta la foto no se deshace nada, venga la tecla de donde venga
          if (photo.crop) announce("Mientras recortas, Deshacer no actúa: Esc cancela el recorte");
          else travel(key === "y" || e.shiftKey ? "redo" : "undo");
        }
      }}
    >
      {photo.dialog}
      <input
        ref={photoInput}
        type="file"
        accept={EDITOR_IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void uploadPhoto(file);
        }}
      />

      {!imageFileId ? (
        <>
          {/* Se deshizo hasta antes de la foto: rehacer la trae de vuelta */}
          {(history.canUndo || history.canRedo) && historyButtons}
          <PhotoDrop uploading={uploading === "photo"} onPick={() => photoInput.current?.click()} onFile={uploadPhoto} />
        </>
      ) : (
        <>
          {/* «Cambiar foto» va en la barra de la foto; en «arrastrar», el tamaño es de cada elemento (panel «Seleccionado») */}
          {type === "image_click" && (
            <Segmented
              label="Precisión"
              value={(config as ImageClickConfig).precision}
              options={PRECISIONS}
              onChange={(precision) => setConfig<ImageClickConfig>((c) => ({ ...c, precision }))}
            />
          )}
          {type === "image_drag" ? (
            <DragEditor
              imageFileId={imageFileId}
              aspect={aspect}
              config={config as ImageDragConfig}
              setConfig={setConfig<ImageDragConfig>}
              gesture={history}
              history={undoRedo}
              photo={photo}
              uploading={uploading}
              setUploading={setUploading}
              setError={setError}
              setNotice={setNotice}
              announce={announce}
              onPhotoFile={photo.dropPhoto}
            />
          ) : (
            <ClickEditor
              imageFileId={imageFileId}
              aspect={aspect}
              config={config as ImageClickConfig}
              setConfig={setConfig<ImageClickConfig>}
              history={undoRedo}
              photo={photo}
              uploading={uploading !== null}
              setNotice={setNotice}
              announce={announce}
              onPhotoFile={photo.dropPhoto}
            />
          )}
        </>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {notice && (
        <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-warning" role="status">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      )}
      {/* Lo que impediría guardar, en vivo */}
      <p className={cn("flex items-center gap-1.5 text-xs", problem ? "text-muted-foreground" : "text-success")}>
        {problem ? (
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
        )}
        {problem ?? "Lista para guardar"}
      </p>
      <LiveRegion live={live} />
    </div>
  );
}

/** Sin foto: la zona para subirla, con clic o soltando el archivo. */
function PhotoDrop({
  uploading,
  onPick,
  onFile,
}: {
  uploading: boolean;
  onPick: () => void;
  onFile: (file: File) => void;
}) {
  const { over, dropProps } = useFileDrop(onFile, !uploading);
  return (
    <button
      type="button"
      aria-disabled={uploading}
      onClick={() => !uploading && onPick()}
      {...dropProps}
      className={cn(
        "flex min-h-56 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted/40 p-6 text-center outline-none transition-colors",
        "focus-visible:ring-4 focus-visible:ring-primary/40",
        over ? "border-primary bg-primary/5" : "hover:border-primary/60 hover:bg-muted/70",
        uploading && "cursor-progress"
      )}
    >
      {uploading ? (
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <ImagePlus className="size-8 text-muted-foreground" aria-hidden />
      )}
      <span className="font-heading text-base font-semibold">{uploading ? "Subiendo la foto…" : "Sube la foto"}</span>
      <span className="max-w-sm text-sm text-muted-foreground">
        Haz clic o suelta aquí el archivo: PNG, JPG, WEBP o GIF, hasta {EDITOR_IMAGE_MAX_BYTES / 1024 / 1024} MB. Sobre ella
        marcarás las respuestas.
      </span>
    </button>
  );
}

/** «Ver como alumno» de esta pregunta tal como va, sin guardarla. */
export function ImagePreviewButton({
  type,
  value,
  promptMd,
  points,
}: {
  type: ImageQuestionType;
  value: ImageQuestionValue;
  promptMd: string;
  points: number;
}) {
  const current = shaped(type, value);
  return (
    <DraftPreviewButton
      problem={imageQuestionProblem(type, current)}
      build={() =>
        imagePreview({ id: "vista-previa", type, promptMd, points, imageFileId: current.imageFileId, config: current.config })
      }
    />
  );
}
