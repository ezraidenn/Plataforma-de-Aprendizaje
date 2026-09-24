"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { CheckCircle2, CircleAlert, Eye, ImagePlus, ImageUp, Loader2, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExamPreview } from "@/components/exam/exam-preview";
import {
  BoardCursor,
  BoardSpot,
  ImageBoard,
  ItemFace,
  SpotArea,
  relToRect,
  useElementWidth,
} from "@/components/exam/image-board";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import { imagePreview, type PreviewQuestion } from "@/lib/preview-question";
import { uploadFile } from "@/lib/upload-client";
import { plural } from "@/lib/plural";
import {
  MAX_ELEMENTS,
  MAX_LABEL,
  MAX_SPOTS,
  MAX_ZONES,
  PRECISION_RADIUS,
  clamp01,
  fileUrl,
  freeSpot,
  iconNumbers,
  iconPx,
  imageClickProblem,
  imageDragProblem,
  imageItemName,
  readingOrder,
  round4,
  sanitizeImageConfig,
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

/**
 * Editor de las preguntas sobre imagen, dentro del banco de preguntas. Primero
 * la foto (clic o soltar el archivo); «Cambiar foto» conserva lugares y puntos
 * porque son relativos a la foto.
 * - Arrastrar a la imagen: a la derecha (debajo en pantallas angostas) los
 *   elementos, íconos o etiquetas. Arrastrar uno a la foto crea un lugar donde
 *   se suelta (también: elegirlo y hacer clic en la foto). Los lugares se
 *   arrastran para moverlos y fuera de la foto para quitarlos; muestran el
 *   elemento real y el número «Lugar N» que ve el alumno.
 * - Señalar en la imagen: clic en la foto marca un punto correcto y clic en un
 *   punto lo quita; la precisión dibuja el círculo de acierto.
 * Debajo, el problema que impediría guardar, en vivo.
 */

export type ImageQuestionValue = { imageFileId: string | null; config: ImageDragConfig | ImageClickConfig };
type SetValue = Dispatch<SetStateAction<ImageQuestionValue>>;
type Announce = (text: string) => void;

const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const DUPLICATE = "Ya está en la lista: colócalo en varios lugares";
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

/** Mientras no se mide la foto, una proporción cualquiera para dibujar el tablero. */
const safeAspect = (a: number) => (a >= 0.1 && a <= 10 ? a : 0.75);

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

/** El problema que impediría guardar (el mismo que revisa el servidor), o null. */
export function imageQuestionProblem(type: ImageQuestionType, value: ImageQuestionValue): string | null {
  return type === "image_drag"
    ? imageDragProblem(value.config, !!value.imageFileId)
    : imageClickProblem(value.config, !!value.imageFileId);
}

/** Alto / ancho de una imagen, ya decodificada por el navegador. */
function measureAspect(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      img.naturalWidth > 0
        ? resolve(round4(img.naturalHeight / img.naturalWidth))
        : reject(new Error("No se pudo leer la imagen; prueba con otra."));
    img.onerror = () => reject(new Error("No se pudo leer la imagen; prueba con otra."));
    img.src = src;
  });
}

/** Número «Lugar N» (o «Punto N») de cada punto, en orden de lectura: el mismo que ve el alumno. */
function readingNumbers(points: Point[], aspect: number): number[] {
  const out: number[] = [];
  readingOrder(
    points.map((p, i) => ({ x: p.x, y: p.y, i })),
    aspect
  ).forEach((p, n) => {
    out[p.i] = n + 1;
  });
  return out;
}

/** «1», «1 y 4», «1, 3 y 4». */
function joinY(list: number[]): string {
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

function newElementId(elements: ImageElement[]): string {
  const taken = new Set(elements.map((e) => e.id));
  let id = "";
  while (!id || taken.has(id)) id = `e${Math.random().toString(36).slice(2, 10)}`;
  return id;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Mira que se mueve con las flechas; Enter (o Espacio) actúa donde está. */
function useCrosshair(aspect: number, onEnter: (p: Point) => void) {
  const [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    // Pasos iguales en pantalla: en vertical se corrigen con la proporción
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step / aspect],
      ArrowDown: [0, step / aspect],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setCursor((c) => ({ x: clamp01(c.x + move[0]), y: clamp01(c.y + move[1]) }));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEnter(cursor);
    }
  }
  return { cursor, setCursor, onKeyDown };
}

// ─── Editor ──────────────────────────────────────────────────────────────────

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
  /** Error de una subida, tal como lo dice el servidor. */
  const [error, setError] = useState<string | null>(null);
  /** Aviso de algo que no se hizo (repetido, límite). */
  const [notice, setNotice] = useState<string | null>(null);
  const { live, announce } = useAnnouncer();
  const photoInput = useRef<HTMLInputElement>(null);
  const { imageFileId } = value;

  useEffect(() => {
    onBusyChange?.(uploading !== null);
  }, [uploading, onBusyChange]);

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
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [imageFileId, onChange]);

  async function uploadPhoto(file: File) {
    if (uploading) return;
    setError(null);
    setNotice(null);
    setUploading("photo");
    const hadPhoto = !!imageFileId;
    try {
      const fileId = await uploadFile(file, "editor_image");
      // Del archivo local: sin esperar a descargarla de vuelta
      const local = URL.createObjectURL(file);
      const aspect = await measureAspect(local).finally(() => URL.revokeObjectURL(local));
      onChange((prev) => ({ imageFileId: fileId, config: { ...prev.config, aspect } }));
      announce(hadPhoto ? "Foto cambiada; los lugares y puntos se conservan" : "Foto lista");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto");
    } finally {
      setUploading(null);
    }
  }

  const setDrag = (fn: (c: ImageDragConfig) => ImageDragConfig) =>
    onChange((prev) => ({ ...prev, config: fn(prev.config as ImageDragConfig) }));
  const setClick = (fn: (c: ImageClickConfig) => ImageClickConfig) =>
    onChange((prev) => ({ ...prev, config: fn(prev.config as ImageClickConfig) }));

  const problem = imageQuestionProblem(type, value);

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
        accept={PHOTO_ACCEPT}
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
                value={(value.config as ImageDragConfig).iconSize}
                options={ICON_SIZES}
                onChange={(iconSize) => setDrag((c) => ({ ...c, iconSize }))}
              />
            ) : (
              <Segmented
                label="Precisión"
                value={(value.config as ImageClickConfig).precision}
                options={PRECISIONS}
                onChange={(precision) => setClick((c) => ({ ...c, precision }))}
              />
            )}
          </div>
          {type === "image_drag" ? (
            <DragEditor
              imageFileId={imageFileId}
              config={value.config as ImageDragConfig}
              setConfig={setDrag}
              uploading={uploading}
              setUploading={setUploading}
              setError={setError}
              setNotice={setNotice}
              announce={announce}
            />
          ) : (
            <ClickEditor
              imageFileId={imageFileId}
              config={value.config as ImageClickConfig}
              setConfig={setClick}
              setNotice={setNotice}
              announce={announce}
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
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      aria-disabled={uploading}
      onClick={() => !uploading && onPick()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file && !uploading) onFile(file);
      }}
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

// ─── Arrastrar a la imagen ───────────────────────────────────────────────────

/** Los avisos van por la región propia, en español; los de dnd-kit, callados. */
const QUIET: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};
const INSTRUCTIONS = {
  draggable: "Con teclado: Enter para elegir; en la foto, las flechas mueven y Supr quita.",
};
const noSubscribe = () => () => {};

/** El elemento que sale de la lista va centrado en el puntero: ahí queda el lugar. */
const centerOnPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  const at = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  if (!at || !draggingNodeRect) return transform;
  return {
    ...transform,
    x: transform.x + at.x - draggingNodeRect.left - draggingNodeRect.width / 2,
    y: transform.y + at.y - draggingNodeRect.top - draggingNodeRect.height / 2,
  };
};

const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function DragEditor({
  imageFileId,
  config,
  setConfig,
  uploading,
  setUploading,
  setError,
  setNotice,
  announce,
}: {
  imageFileId: string;
  config: ImageDragConfig;
  setConfig: (fn: (c: ImageDragConfig) => ImageDragConfig) => void;
  uploading: "photo" | "icon" | null;
  setUploading: (u: "photo" | "icon" | null) => void;
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
  announce: Announce;
}) {
  const board = useElementWidth<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  /** Bytes de los íconos ya vistos, para no subir dos veces el mismo. */
  const iconBytes = useRef(new Map<string, Uint8Array>());
  /** Elemento elegido para colocarlo con un clic en la foto. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Lugar elegido (muestra «×» y se mueve con las flechas). */
  const [picked, setPicked] = useState<number | null>(null);
  /** Lo que va en la mano: `el:<id>` o `zone:<índice>`. */
  const [active, setActive] = useState<string | null>(null);
  /** El lugar arrastrado está fuera de la foto: al soltarlo se quita. */
  const [outside, setOutside] = useState(false);
  /** Etiqueta nueva que se escribe; null = cerrado. */
  const [label, setLabel] = useState<string | null>(null);
  /** Puntero en pantalla durante el arrastre, y desfase entre él y el centro del lugar tomado. */
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const grab = useRef<Point>({ x: 0, y: 0 });
  const focusAfter = useRef<string | null>(null);
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { elements, zones } = config;
  const aspect = safeAspect(config.aspect);
  const px = iconPx(config.iconSize, board.width);
  const dense = board.width > 0 && board.width < 480;
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const names = useMemo(() => {
    const icons = iconNumbers(elements.map((e) => e.fileId));
    return new Map(elements.map((e) => [e.id, imageItemName(e, icons)]));
  }, [elements]);
  const numbers = useMemo(() => readingNumbers(zones, aspect), [zones, aspect]);
  const crosshair = useCrosshair(aspect, (p) => {
    if (chosen) placeAt(chosen, p, true);
    else announce("Primero elige un elemento de la lista");
  });

  // Durante el arrastre se sigue el puntero real (en captura, antes que dnd-kit)
  useEffect(() => {
    if (!active) return;
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track, true);
    return () => window.removeEventListener("pointermove", track, true);
  }, [active]);

  // Foco tras una acción con teclado: el botón nuevo aparece en el siguiente render
  useEffect(() => {
    const selector = focusAfter.current;
    if (!selector) return;
    focusAfter.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const nameOf = (id: string) => names.get(id) ?? "Elemento";
  const labelTaken = (text: string) =>
    elements.some((e) => e.kind === "text" && (e.text ?? "").trim().toLowerCase() === text.trim().toLowerCase());
  const fullElements = elements.length >= MAX_ELEMENTS;
  const fullZones = zones.length >= MAX_ZONES;

  function placeAt(elementId: string, p: Point, viaKeyboard: boolean) {
    setChosen(null);
    if (fullZones) {
      const text = `Ya hay ${MAX_ZONES} lugares, el máximo: quita uno para agregar otro.`;
      setNotice(text);
      announce(text);
      return;
    }
    // Encima de otro lugar no: se corre lo justo (si no cabe, lo dice la validación)
    const at = freeSpot(p, zones, aspect) ?? p;
    const zone = { x: at.x, y: at.y, elementId };
    setConfig((c) => (c.zones.length >= MAX_ZONES ? c : { ...c, zones: [...c.zones, zone] }));
    setNotice(null);
    const n = readingNumbers([...zones, zone], aspect)[zones.length];
    announce(`${nameOf(elementId)} en el lugar ${n}${at !== p ? ", corrido un poco para no encimarse" : ""}`);
    if (viaKeyboard) focusAfter.current = `[data-zone="${zones.length}"]`;
  }

  function moveZone(i: number, p: Point) {
    const at = freeSpot(
      p,
      zones.filter((_, j) => j !== i),
      aspect
    ) ?? p;
    setConfig((c) => ({ ...c, zones: c.zones.map((z, j) => (j === i ? { ...z, x: at.x, y: at.y } : z)) }));
  }

  function nudgeZone(i: number, dx: number, dy: number) {
    setConfig((c) => ({
      ...c,
      zones: c.zones.map((z, j) => (j === i ? { ...z, x: round4(clamp01(z.x + dx)), y: round4(clamp01(z.y + dy)) } : z)),
    }));
  }

  function removeZone(i: number, viaKeyboard: boolean) {
    setPicked(null);
    setNotice(null);
    setConfig((c) => ({ ...c, zones: c.zones.filter((_, j) => j !== i) }));
    announce(`Lugar ${numbers[i]} quitado`);
    // El botón desaparece: el foco vuelve a la foto para no perderse
    if (viaKeyboard) board.node?.focus();
  }

  function removeElement(id: string) {
    const count = zones.filter((z) => z.elementId === id).length;
    if (chosen === id) setChosen(null);
    setPicked(null);
    setNotice(null);
    setConfig((c) => ({
      ...c,
      elements: c.elements.filter((e) => e.id !== id),
      zones: c.zones.filter((z) => z.elementId !== id),
    }));
    announce(`${nameOf(id)} quitado${count ? ` junto con ${plural(count, "su lugar", `sus ${count} lugares`)}` : ""}`);
  }

  function addLabel() {
    const text = (label ?? "").trim();
    if (!text || fullElements) return;
    // El aviso ya se ve bajo el campo; aquí solo se dice en voz alta
    if (labelTaken(text)) {
      announce(DUPLICATE);
      return;
    }
    const element: ImageElement = { id: newElementId(elements), kind: "text", text };
    setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
    setLabel("");
    setNotice(null);
    announce(`«${text}» agregado: arrástralo a la foto`);
  }

  /** ¿Ya hay un ícono con exactamente estos bytes? */
  async function iconExists(bytes: Uint8Array): Promise<boolean> {
    for (const e of elements) {
      if (e.kind !== "icon" || !e.fileId) continue;
      let known = iconBytes.current.get(e.fileId);
      if (!known) {
        try {
          const res = await fetch(fileUrl(e.fileId));
          if (!res.ok) continue;
          known = new Uint8Array(await res.arrayBuffer());
          iconBytes.current.set(e.fileId, known);
        } catch {
          continue;
        }
      }
      if (sameBytes(known, bytes)) return true;
    }
    return false;
  }

  async function addIcon(file: File) {
    if (uploading || fullElements) return;
    setError(null);
    setNotice(null);
    setUploading("icon");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (await iconExists(bytes)) {
        setNotice(DUPLICATE);
        announce(DUPLICATE);
        return;
      }
      const fileId = await uploadFile(file, "editor_image");
      iconBytes.current.set(fileId, bytes);
      const element: ImageElement = { id: newElementId(elements), kind: "icon", fileId };
      setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
      announce("Ícono agregado: arrástralo a la foto");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el ícono");
    } finally {
      setUploading(null);
    }
  }

  function choose(id: string, viaKeyboard: boolean) {
    setPicked(null);
    if (chosen === id) {
      setChosen(null);
      announce("Elección cancelada");
      return;
    }
    setChosen(id);
    announce(
      viaKeyboard
        ? `Elegiste ${nameOf(id)}: en la foto, mueve la mira con las flechas y pulsa Enter para colocarlo`
        : `Elegiste ${nameOf(id)}: haz clic en la foto donde va`
    );
    if (viaKeyboard) board.node?.focus();
  }

  /** Dónde quedaría lo que va en la mano; null si está fuera de la foto. */
  function dropPoint(): Point | null {
    const node = board.node;
    if (!node) return null;
    const p = relToRect(
      pointer.current.x + grab.current.x,
      pointer.current.y + grab.current.y,
      node.getBoundingClientRect()
    );
    return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? { x: round4(p.x), y: round4(p.y) } : null;
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActive(id);
    setChosen(null);
    setPicked(null);
    setOutside(false);
    const at = getEventCoordinates(e.activatorEvent) ?? { x: 0, y: 0 };
    pointer.current = at;
    // Un lugar tomado de una orilla se mueve con su centro, no salta al puntero
    const r = e.active.rect.current.initial;
    grab.current =
      id.startsWith("zone:") && r
        ? { x: r.left + r.width / 2 - at.x, y: r.top + r.height / 2 - at.y }
        : { x: 0, y: 0 };
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const p = dropPoint();
    setActive(null);
    setOutside(false);
    if (id.startsWith("zone:")) {
      const i = Number(id.slice(5));
      if (p) moveZone(i, p);
      else removeZone(i, false);
    } else if (p) {
      placeAt(id.slice(3), p, false);
    }
  }

  const activeElement = active
    ? byId.get(active.startsWith("el:") ? active.slice(3) : (zones[Number(active.slice(5))]?.elementId ?? ""))
    : undefined;
  const removing = outside && !!active?.startsWith("zone:");
  const hint = removing
    ? "Fuera de la foto: suéltalo para quitar este lugar."
    : chosen
      ? `Haz clic en la foto donde va «${nameOf(chosen)}» (Esc para cancelar).`
      : elements.length === 0
        ? "Primero agrega los íconos o etiquetas que el alumno colocará."
        : "Arrastra un elemento de la lista a la foto para marcar dónde va (o elígelo y haz clic en la foto). Arrástralo de nuevo para moverlo, o sácalo de la foto para quitarlo.";

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      accessibility={{ announcements: QUIET, screenReaderInstructions: INSTRUCTIONS }}
      onDragStart={onDragStart}
      onDragMove={() => setOutside(dropPoint() === null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setOutside(false);
      }}
    >
      <div
        ref={rootRef}
        className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_15rem]"
        onKeyDown={(e) => {
          if (e.key === "Escape" && (chosen || picked !== null)) {
            setChosen(null);
            setPicked(null);
          }
        }}
      >
        <div className="min-w-0 space-y-2">
          <ImageBoard
            ref={board.ref}
            imageUrl={fileUrl(imageFileId)}
            aspect={aspect}
            onPointer={(p) => {
              crosshair.setCursor(p);
              if (chosen) placeAt(chosen, { x: round4(p.x), y: round4(p.y) }, false);
              else setPicked(null);
            }}
            tabIndex={0}
            role="application"
            aria-label="Foto: elige un elemento de la lista, mueve la mira con las flechas y pulsa Enter para colocarlo"
            onKeyDown={crosshair.onKeyDown}
            className={cn(
              "group outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
              chosen && "cursor-crosshair",
              active?.startsWith("el:") && "ring-2 ring-primary",
              removing && "ring-2 ring-destructive"
            )}
          >
            <BoardCursor x={crosshair.cursor.x} y={crosshair.cursor.y} />
            {zones.map((z, i) => {
              const element = byId.get(z.elementId);
              if (!element) return null;
              return (
                <PlacedZone
                  key={i}
                  index={i}
                  zone={z}
                  element={element}
                  label={`Lugar ${numbers[i]}: ${nameOf(z.elementId)}`}
                  number={numbers[i]}
                  px={px}
                  dense={dense}
                  picked={picked === i}
                  lifted={active === `zone:${i}`}
                  onClick={(e) => {
                    setChosen(null);
                    setPicked(picked === i ? null : i);
                    if (e.detail === 0 && picked !== i) {
                      announce(`Lugar ${numbers[i]} elegido: flechas para moverlo, Supr para quitarlo`);
                    }
                  }}
                  onRemove={(e) => removeZone(i, e.detail === 0)}
                  onKeyDown={(e) => {
                    const step = ARROW_STEPS[e.key];
                    if (step) {
                      e.preventDefault();
                      const d = e.shiftKey ? 0.05 : 0.01;
                      nudgeZone(i, step[0] * d, (step[1] * d) / aspect);
                    } else if (e.key === "Delete" || e.key === "Backspace") {
                      e.preventDefault();
                      removeZone(i, true);
                    }
                  }}
                />
              );
            })}
          </ImageBoard>
          <p className={cn("text-xs", removing ? "font-medium text-destructive" : "text-muted-foreground")}>{hint}</p>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Elementos</p>
          {elements.length > 0 && (
            <ul className="space-y-1.5" aria-label="Elementos">
              {elements.map((element) => {
                const places = zones
                  .map((z, i) => (z.elementId === element.id ? numbers[i] : 0))
                  .filter(Boolean)
                  .sort((a, b) => a - b);
                return (
                  <ElementRow
                    key={element.id}
                    element={element}
                    name={nameOf(element.id)}
                    places={places}
                    started={zones.length > 0}
                    chosen={chosen === element.id}
                    onChoose={(e) => choose(element.id, e.detail === 0)}
                    onRemove={() => removeElement(element.id)}
                  />
                );
              })}
            </ul>
          )}

          <input
            ref={iconInput}
            type="file"
            accept={PHOTO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void addIcon(file);
            }}
          />
          {label !== null ? (
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <Input
                  autoFocus
                  value={label}
                  maxLength={MAX_LABEL}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLabel();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setLabel(null);
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
                  onClick={() => setLabel(null)}
                >
                  <X aria-hidden />
                </Button>
              </div>
              {label.trim() && labelTaken(label) ? (
                <p className="text-xs text-amber-700 dark:text-warning">{DUPLICATE}</p>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={!label.trim() || fullElements}
                  onClick={addLabel}
                >
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
                disabled={fullElements || uploading !== null}
                onClick={() => iconInput.current?.click()}
              >
                {uploading === "icon" ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
                {uploading === "icon" ? "Subiendo…" : "Ícono (PNG)"}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={fullElements} onClick={() => setLabel("")}>
                <Plus aria-hidden />
                Texto
              </Button>
            </div>
          )}
          {fullElements && (
            <p className="text-xs text-muted-foreground">Llegaste al máximo de {MAX_ELEMENTS} elementos.</p>
          )}
          {zones.length > 0 && (
            <p className="rounded-lg bg-muted/60 p-2 text-xs leading-relaxed text-muted-foreground">
              <b className="font-semibold text-foreground">Puntos:</b> cada lugar bien puesto vale lo mismo.{" "}
              {zones.length === 1
                ? "Con un solo lugar, vale la pregunta completa."
                : `Con ${zones.length} lugares, cada uno vale 1/${zones.length} de la pregunta.`}
              {fullZones && ` Llegaste al máximo de ${MAX_ZONES} lugares.`}
            </p>
          )}
        </div>
      </div>

      {isClient &&
        // Al cuerpo del documento: un ancestro con transform movería el fantasma
        createPortal(
          <DragOverlay dropAnimation={null} modifiers={active?.startsWith("el:") ? [centerOnPointer] : undefined}>
            {activeElement ? (
              // El fantasma toma el tamaño de lo que se arrastra: la ficha va centrada en él
              <div className="flex size-full items-center justify-center">
                <ItemFace
                  item={activeElement}
                  px={px}
                  dense={dense}
                  className={cn(
                    "cursor-grabbing shadow-[0_14px_28px_-8px_rgb(15_23_42/0.45)] transition-opacity",
                    removing ? "opacity-40" : "-rotate-4 opacity-95"
                  )}
                />
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  );
}

/** Un elemento de la lista: se arrastra a la foto, o se elige y luego clic en la foto. */
function ElementRow({
  element,
  name,
  places,
  started,
  chosen,
  onChoose,
  onRemove,
}: {
  element: ImageElement;
  name: string;
  /** Números de los lugares donde va, en orden. */
  places: number[];
  /** Ya hay algo en la foto: lo que no tiene lugar es un distractor, no algo pendiente. */
  started: boolean;
  chosen: boolean;
  onChoose: (e: React.MouseEvent) => void;
  onRemove: () => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `el:${element.id}` });
  const distractor = started && places.length === 0;
  const status =
    places.length > 0
      ? `Va en ${places.length} ${plural(places.length, "lugar", "lugares")} (${joinY(places)})`
      : distractor
        ? "Sin lugar: distractor"
        : "Arrástralo a la foto";
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-xl border p-1 transition-colors",
        distractor && "border-warning/40 bg-warning/10",
        chosen && "border-primary ring-2 ring-primary/30",
        isDragging && "opacity-60"
      )}
    >
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        onClick={onChoose}
        aria-pressed={chosen}
        aria-label={`${name}: ${status}`}
        title="Arrástralo a la foto, o haz clic aquí y después en la foto"
        className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg p-0.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-primary/40 active:cursor-grabbing"
      >
        {element.kind === "icon" ? (
          <ItemFace item={element} px={34} className="shrink-0" />
        ) : (
          <span
            aria-hidden
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border bg-card text-[11px] font-bold text-muted-foreground"
          >
            Aa
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span
            className={cn("block text-xs", distractor ? "text-amber-700 dark:text-warning" : "text-muted-foreground")}
          >
            {status}
          </span>
        </span>
      </button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Quitar ${name}${places.length > 0 ? " y sus lugares" : ""}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

/** Un lugar en la foto: el elemento real (el maestro sí ve la solución) con su número. */
function PlacedZone({
  index,
  zone,
  element,
  label,
  number,
  px,
  dense,
  picked,
  lifted,
  onClick,
  onRemove,
  onKeyDown,
}: {
  index: number;
  zone: ImageZone;
  element: ImageElement;
  label: string;
  number: number;
  px: number;
  dense: boolean;
  picked: boolean;
  /** Va en la mano: se ve el fantasma, y el botón sigue montado (invisible) para no cortar el arrastre. */
  lifted: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: `zone:${index}` });
  return (
    <BoardSpot x={zone.x} y={zone.y} className={cn(picked ? "z-20" : "z-10", lifted && "invisible")}>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        data-zone={index}
        onClick={onClick}
        onKeyDown={onKeyDown}
        aria-label={label}
        aria-pressed={picked}
        title="Arrástralo para moverlo, o fuera de la foto para quitarlo"
        className={cn(
          "relative block cursor-grab touch-none outline-none active:cursor-grabbing",
          "focus-visible:ring-4 focus-visible:ring-primary/40",
          element.kind === "icon" ? "rounded-[12px]" : "rounded-full",
          picked && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        <ItemFace item={element} px={px} dense={dense} />
        <span
          aria-hidden
          className="absolute -right-2 -top-2 flex size-[18px] items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground ring-2 ring-white"
        >
          {number}
        </span>
      </button>
      {picked && (
        <button
          type="button"
          aria-label={`Quitar el lugar ${number}`}
          title="Quitar este lugar"
          onClick={onRemove}
          className="absolute -left-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow ring-2 ring-white outline-none hover:bg-destructive/90 focus-visible:ring-4 focus-visible:ring-destructive/40"
        >
          <X className="size-3" strokeWidth={3} aria-hidden />
        </button>
      )}
    </BoardSpot>
  );
}

// ─── Señalar en la imagen ────────────────────────────────────────────────────

function ClickEditor({
  imageFileId,
  config,
  setConfig,
  setNotice,
  announce,
}: {
  imageFileId: string;
  config: ImageClickConfig;
  setConfig: (fn: (c: ImageClickConfig) => ImageClickConfig) => void;
  setNotice: (n: string | null) => void;
  announce: Announce;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const { spots } = config;
  const aspect = safeAspect(config.aspect);
  const numbers = useMemo(() => readingNumbers(spots, aspect), [spots, aspect]);
  const full = spots.length >= MAX_SPOTS;
  const crosshair = useCrosshair(aspect, (p) => addSpot(p));

  function addSpot(p: Point) {
    crosshair.setCursor(p);
    if (full) {
      const text = `Ya marcaste ${MAX_SPOTS} puntos, el máximo: quita uno para marcar otro.`;
      setNotice(text);
      announce(text);
      return;
    }
    const spot = { x: round4(p.x), y: round4(p.y) };
    setConfig((c) => (c.spots.length >= MAX_SPOTS ? c : { ...c, spots: [...c.spots, spot] }));
    setNotice(null);
    announce(`Punto ${readingNumbers([...spots, spot], aspect)[spots.length]} marcado`);
  }

  function removeSpot(i: number, viaKeyboard: boolean) {
    setConfig((c) => ({ ...c, spots: c.spots.filter((_, j) => j !== i) }));
    setNotice(null);
    announce(`Punto ${numbers[i]} quitado`);
    // El botón desaparece: el foco vuelve a la foto para no perderse
    if (viaKeyboard) boardRef.current?.focus();
  }

  const n = spots.length;
  return (
    <div className="space-y-2">
      <ImageBoard
        ref={boardRef}
        imageUrl={fileUrl(imageFileId)}
        aspect={aspect}
        onPointer={(p) => addSpot(p)}
        tabIndex={0}
        role="application"
        aria-label="Foto: mueve la mira con las flechas y pulsa Enter para marcar un punto correcto"
        onKeyDown={crosshair.onKeyDown}
        className={cn(
          "group outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
          full ? "cursor-default" : "cursor-crosshair"
        )}
      >
        <BoardCursor x={crosshair.cursor.x} y={crosshair.cursor.y} />
        {spots.map((s, i) => (
          <SpotArea key={`a${i}`} x={s.x} y={s.y} radius={PRECISION_RADIUS[config.precision]} />
        ))}
        {spots.map((s, i) => (
          <BoardSpot key={`p${i}`} x={s.x} y={s.y} className="z-10">
            <button
              type="button"
              aria-label={`Punto ${numbers[i]}: pulsa para quitarlo`}
              title="Quitar este punto"
              onClick={(e) => removeSpot(i, e.detail === 0)}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  removeSpot(i, true);
                }
              }}
              className="flex size-[22px] items-center justify-center rounded-full bg-success text-[11px] font-bold text-white shadow-md ring-2 ring-white outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-4 focus-visible:ring-primary/40 motion-reduce:transition-none"
            >
              {numbers[i]}
            </button>
          </BoardSpot>
        ))}
      </ImageBoard>
      <p className="text-xs text-muted-foreground">
        Haz clic en la foto para marcar cada punto correcto y en un punto para quitarlo. El círculo verde es el margen:
        cuenta cualquier clic del alumno que caiga dentro.
      </p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {n} de {MAX_SPOTS} puntos
        {n > 0 &&
          ` · El alumno pondrá ${n} ${plural(n, "marca", "marcas")}${
            n > 1 ? `; cada punto acertado vale 1/${n} de la pregunta` : ""
          }.`}
      </p>
    </div>
  );
}

// ─── Vista previa de la pregunta que se edita ────────────────────────────────

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
  const [question, setQuestion] = useState<PreviewQuestion | null>(null);
  const problem = imageQuestionProblem(type, value);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!!problem}
        title={problem ?? undefined}
        onClick={() =>
          setQuestion(
            imagePreview({
              id: "vista-previa",
              type,
              promptMd,
              points,
              imageFileId: value.imageFileId,
              config: value.config,
            })
          )
        }
      >
        <Eye aria-hidden />
        Ver como alumno
      </Button>
      <Dialog open={question !== null} onOpenChange={(o) => !o && setQuestion(null)}>
        <DialogContent className="flex h-[88vh] flex-col gap-3 overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Ver como alumno</DialogTitle>
            <DialogDescription>Así verá el estudiante esta pregunta, aún sin guardar.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {question && <ExamPreview questions={[question]} onClose={() => setQuestion(null)} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
