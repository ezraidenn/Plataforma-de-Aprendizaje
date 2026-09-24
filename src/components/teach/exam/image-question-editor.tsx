"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CheckCircle2, CircleAlert, Eye, ImagePlus, ImageUp, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFileDrop } from "@/components/exam/image-dnd";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import { imagePreview, type PreviewQuestion } from "@/lib/preview-question";
import { EDITOR_IMAGE_ACCEPT, uploadFile } from "@/lib/upload-client";
import {
  fileUrl,
  imageClickProblem,
  imageDragProblem,
  round4,
  sanitizeImageConfig,
  validAspect,
  type IconSize,
  type ImageClickConfig,
  type ImageDragConfig,
  type ImageElement,
  type ImageQuestionType,
  type ImageZone,
  type Point,
  type Precision,
} from "@/lib/image-questions";
import { cn } from "@/lib/utils";
import { ClickEditor } from "./image-click-editor";
import { DragEditor } from "./image-drag-editor";
import { PreviewDialog } from "./preview-button";

/**
 * Editor de las preguntas sobre imagen, dentro del banco de preguntas. Primero
 * la foto (clic o soltar el archivo); «Cambiar foto» (o soltar otra sobre la
 * foto) conserva lugares y puntos porque son relativos a la foto. Lo propio de
 * cada tipo vive en `image-drag-editor.tsx` y `image-click-editor.tsx`. Debajo,
 * el problema que impediría guardar, en vivo.
 */

export type ImageQuestionValue = { imageFileId: string | null; config: ImageDragConfig | ImageClickConfig };
type SetValue = Dispatch<SetStateAction<ImageQuestionValue>>;

const ICON_SIZES: [IconSize, string][] = [
  ["sm", "Chico"],
  ["md", "Mediano"],
  ["lg", "Grande"],
];
const PRECISIONS: [Precision, string][] = [
  ["sm", "Estricta"],
  ["md", "Normal"],
  ["lg", "Amplia"],
];

/**
 * Lo guardado → valor del editor, sin lo ilegible. Sin nada guardado, una
 * pregunta vacía (tamaño y precisión medianos). Solo lo usan las de imagen.
 */
export function initialImageValue(type: string, imageFileId: string | null, raw: unknown): ImageQuestionValue {
  const isPoint = (p: Partial<Point> | null | undefined): p is Point =>
    typeof p?.x === "number" && typeof p?.y === "number";
  if (type === "image_click") {
    const c = sanitizeImageConfig("image_click", raw) as Partial<ImageClickConfig>;
    return {
      imageFileId,
      config: { aspect: c.aspect ?? 0, precision: c.precision ?? "md", spots: (c.spots ?? []).filter(isPoint) },
    };
  }
  const c = sanitizeImageConfig("image_drag", raw) as {
    aspect?: number;
    iconSize?: IconSize;
    elements?: Partial<ImageElement>[];
    zones?: Partial<ImageZone>[];
  };
  return {
    imageFileId,
    config: {
      aspect: c.aspect ?? 0,
      iconSize: c.iconSize ?? "md",
      elements: (c.elements ?? []).filter(
        (e): e is ImageElement => !!e.id && (e.kind === "icon" ? !!e.fileId : e.kind === "text" && typeof e.text === "string")
      ),
      zones: (c.zones ?? []).filter(
        (z): z is ImageZone => typeof z.x === "number" && typeof z.y === "number" && typeof z.elementId === "string"
      ),
    },
  };
}

/**
 * El valor con la forma de su tipo. Si no la tiene (un borrador que cambió de
 * tipo), uno vacío de ese tipo con la misma foto y proporción.
 */
function shaped(type: ImageQuestionType, value: ImageQuestionValue): ImageQuestionValue {
  const c = value.config as Partial<ImageDragConfig & ImageClickConfig>;
  const fits =
    type === "image_drag"
      ? Array.isArray(c.elements) && Array.isArray(c.zones) && typeof c.iconSize === "string"
      : Array.isArray(c.spots) && typeof c.precision === "string";
  if (fits) return value;
  const fresh = initialImageValue(type, value.imageFileId, null);
  return { imageFileId: value.imageFileId, config: { ...fresh.config, aspect: c.aspect ?? 0 } };
}

/** El problema que impediría guardar (el mismo que revisa el servidor), o null. */
export function imageQuestionProblem(type: ImageQuestionType, value: ImageQuestionValue): string | null {
  const v = shaped(type, value);
  return type === "image_drag"
    ? imageDragProblem(v.config, !!v.imageFileId)
    : imageClickProblem(v.config, !!v.imageFileId);
}

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
}: {
  type: ImageQuestionType;
  value: ImageQuestionValue;
  onChange: SetValue;
  /** Hay una subida en curso: mientras tanto no se guarda. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState<"photo" | "icon" | null>(null);
  /** Error de una subida o de la foto. */
  const [error, setError] = useState<string | null>(null);
  /** Aviso de algo que no se hizo (repetido, límite). */
  const [notice, setNotice] = useState<string | null>(null);
  const { live, announce } = useAnnouncer();
  const photoInput = useRef<HTMLInputElement>(null);
  const current = shaped(type, value);
  const { imageFileId, config } = current;

  // Lo guardado arriba también toma la forma del tipo (es lo que se envía)
  useEffect(() => {
    if (current !== value) onChange((prev) => shaped(type, prev));
  }, [current, value, type, onChange]);

  useEffect(() => {
    onBusyChange?.(uploading !== null);
  }, [uploading, onBusyChange]);
  // Si el editor se cierra a media subida, «Guardar» no se queda deshabilitado
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // La proporción sale de la foto misma: si la guardada no cuadra (o falta), se corrige
  useEffect(() => {
    if (!imageFileId) return;
    let alive = true;
    measureAspect(fileUrl(imageFileId)).then(
      (aspect) => {
        if (!alive) return;
        onChange((prev) =>
          prev.imageFileId !== imageFileId || Math.abs(prev.config.aspect - aspect) < 1e-3
            ? prev
            : { ...prev, config: { ...prev.config, aspect } }
        );
      },
      () => {
        if (alive) setError("No se pudo cargar la foto: vuelve a subirla");
      }
    );
    return () => {
      alive = false;
    };
  }, [imageFileId, onChange]);

  async function uploadPhoto(file: File) {
    if (uploading) return;
    setError(null);
    setNotice(null);
    // Se mide antes de subir: si no sirve, ni se sube (no quedan archivos huérfanos)
    const local = URL.createObjectURL(file);
    const aspect = await measureAspect(local)
      .catch(() => null)
      .finally(() => URL.revokeObjectURL(local));
    if (aspect === null) {
      setError("No se pudo leer la imagen: usa una foto PNG, JPG, WEBP o GIF.");
      return;
    }
    if (!validAspect(aspect)) {
      setError("La foto es demasiado alargada: recórtala para que no sea más de diez veces más ancha que alta, ni al revés.");
      return;
    }
    setUploading("photo");
    const hadPhoto = !!imageFileId;
    try {
      const fileId = await uploadFile(file, "editor_image");
      onChange((prev) => ({ imageFileId: fileId, config: { ...shaped(type, prev).config, aspect } }));
      announce(hadPhoto ? "Foto cambiada; los lugares y puntos se conservan" : "Foto lista");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto");
    } finally {
      setUploading(null);
    }
  }

  const setDrag = (fn: (c: ImageDragConfig) => ImageDragConfig) =>
    onChange((prev) => {
      const p = shaped(type, prev);
      return { ...p, config: fn(p.config as ImageDragConfig) };
    });
  const setClick = (fn: (c: ImageClickConfig) => ImageClickConfig) =>
    onChange((prev) => {
      const p = shaped(type, prev);
      return { ...p, config: fn(p.config as ImageClickConfig) };
    });

  const problem = imageQuestionProblem(type, current);
  // Mientras se mide la foto, una proporción cualquiera para dibujar el tablero
  const aspect = validAspect(config.aspect) ? config.aspect : 0.75;

  return (
    <div
      className="@container grid gap-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") setNotice(null);
      }}
    >
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
        <PhotoDrop uploading={uploading === "photo"} onPick={() => photoInput.current?.click()} onFile={uploadPhoto} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploading !== null}
              onClick={() => photoInput.current?.click()}
            >
              {uploading === "photo" ? <Loader2 className="animate-spin" aria-hidden /> : <ImageUp aria-hidden />}
              {uploading === "photo" ? "Subiendo…" : "Cambiar foto"}
            </Button>
            <span className="flex-1" />
            {type === "image_drag" ? (
              <Segmented
                label="Tamaño de los íconos"
                value={(config as ImageDragConfig).iconSize}
                options={ICON_SIZES}
                onChange={(iconSize) => setDrag((c) => ({ ...c, iconSize }))}
              />
            ) : (
              <Segmented
                label="Precisión"
                value={(config as ImageClickConfig).precision}
                options={PRECISIONS}
                onChange={(precision) => setClick((c) => ({ ...c, precision }))}
              />
            )}
          </div>
          {type === "image_drag" ? (
            <DragEditor
              imageFileId={imageFileId}
              aspect={aspect}
              config={config as ImageDragConfig}
              setConfig={setDrag}
              uploading={uploading}
              setUploading={setUploading}
              setError={setError}
              setNotice={setNotice}
              announce={announce}
              onPhotoFile={uploadPhoto}
            />
          ) : (
            <ClickEditor
              imageFileId={imageFileId}
              aspect={aspect}
              config={config as ImageClickConfig}
              setConfig={setClick}
              uploading={uploading !== null}
              setNotice={setNotice}
              announce={announce}
              onPhotoFile={uploadPhoto}
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
        Haz clic o suelta aquí el archivo: PNG, JPG, WEBP o GIF, hasta 5 MB. Sobre ella marcarás las respuestas.
      </span>
    </button>
  );
}

/** Botones de una sola elección (tamaño de íconos, precisión). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground" aria-hidden>
        {label}
      </span>
      <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={v === value}
            onClick={() => onChange(v)}
            className={cn(
              "px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
              v === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
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
  const [questions, setQuestions] = useState<PreviewQuestion[] | null>(null);
  const current = shaped(type, value);
  const problem = imageQuestionProblem(type, current);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!!problem}
        title={problem ?? undefined}
        onClick={() =>
          setQuestions([
            imagePreview({
              id: "vista-previa",
              type,
              promptMd,
              points,
              imageFileId: current.imageFileId,
              config: current.config,
            }),
          ])
        }
      >
        <Eye aria-hidden />
        Ver como alumno
      </Button>
      <PreviewDialog
        questions={questions}
        onClose={() => setQuestions(null)}
        description="Así verá el estudiante esta pregunta, aún sin guardar."
      />
    </>
  );
}
