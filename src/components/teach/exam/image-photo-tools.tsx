"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStableHandler } from "@/components/exam/image-dnd";
import { overlapSaid, shapedImageValue as shaped, type ImageQuestionValue } from "@/lib/image-editor-value";
import { boundSizes, cropConfig, rotateConfig } from "@/lib/image-layout";
import { PhotoError, transformPhoto } from "@/lib/image-processing";
import {
  fileUrl,
  iconNumbers,
  imageItemName,
  overlapNumbers,
  validAspect,
  type ImageClickConfig,
  type ImageDragConfig,
  type ImageQuestionType,
} from "@/lib/image-questions";
import { FULL_CROP, cropRatio, fitCropRatio, isFullCrop, snapCrop, type CropChoice, type CropRect } from "@/lib/photo-crop";
import { joinY, plural } from "@/lib/plural";
import { uploadFile } from "@/lib/upload-client";
import { CropCover } from "./image-crop-cover";
import { isTypingTarget } from "./use-editor-history";

/**
 * Herramientas de la foto de fondo (arrastrar y señalar): recortarla, girarla
 * 90° y cambiarla. Lo que se ve está en `image-photo-bar.tsx` (el grupo de la
 * barra y la barra del recorte) y en `image-crop-cover.tsx` (el rectángulo).
 *
 * Recortar abre un modo sobre la foto: proporción Libre, Original, 1:1, 4:3 o
 * 16:9 y, en vivo, cuántos lugares o puntos quedan fuera (con el recorte ya
 * redondeado a los píxeles de la foto, como se hará). Mientras, el resto del
 * editor no se toca y Deshacer no actúa (lo dice la pista); Esc cancela.
 * Aplicar y girar hacen la foto nueva en el navegador (`transformPhoto`), la
 * suben como `editor_image` (como «Cambiar foto») y recolocan lugares y
 * puntos (`cropConfig`, `rotateConfig`): foto y config cambian en un solo
 * paso del historial, así que deshacer vuelve a la foto de antes (su archivo
 * sigue ahí). Un giro justo contrario al anterior solo lo deshace (no sube otra
 * foto). Mientras se prepara y sube, «Guardar» espera (`uploading`) y el botón
 * lleva el indicador. Si el examen ya tiene intentos (o la pregunta,
 * respuestas en uno en curso), antes de recortar, girar o cambiar la foto
 * («Cambiar foto» o soltar otra sobre ella) se pide confirmación, una vez por
 * editor abierto, diciendo lo que pasa con lo ya respondido (`askedText`).
 */

type Uploading = "photo" | "icon" | null;
type Kind = "crop" | "cw" | "ccw";
/** Lo que espera la confirmación: recortar, girar, o cambiar la foto (por el archivo soltado, o eligiendo uno). */
type Asked = { kind: Kind } | { kind: "change"; file: File | null };
type AnyConfig = ImageDragConfig | ImageClickConfig;

/**
 * Por qué tocar la foto pide confirmación: el examen ya tiene intentos
 * enviados o calificados («attempts»), o esta pregunta tiene respuestas
 * guardadas en un intento en curso («in_progress»). null: no la pide.
 */
export type Answered = "attempts" | "in_progress" | null;

/**
 * El título y el texto de la confirmación. En «arrastrar» cada lugar lleva
 * su clave: recortar o girar lo recoloca con sus respuestas (salvo los que
 * quedan fuera, que se quitan). En «señalar» los puntos correctos se
 * recolocan, pero las marcas de los alumnos son coordenadas y no se mueven.
 * Cambiar la foto no mueve nada. `outside`: lugares o puntos que el recorte deja fuera.
 */
function askedText(answered: NonNullable<Answered>, type: ImageQuestionType, kind: Asked["kind"], outside: number) {
  const title = answered === "attempts" ? "Este examen ya tiene intentos" : "Hay alumnos respondiendo esta pregunta";
  if (kind === "change") return { title, body: "Las revisiones se verán sobre la foto nueva." };
  if (type === "image_drag") {
    const kept = outside > 0 ? "se conservan, salvo las de los lugares que quedan fuera" : "se conservan";
    return { title, body: `Las respuestas de los alumnos ${kept}; sus revisiones se verán sobre la foto nueva.` };
  }
  return {
    title,
    body:
      answered === "attempts"
        ? "Las marcas que ya pusieron los alumnos no se mueven: en sus revisiones pueden quedar fuera de los círculos (su calificación guardada no cambia)."
        : "Las marcas que ya pusieron los alumnos no se mueven: sobre la foto nueva pueden quedar fuera de los círculos.",
  };
}

export const CROP_CHOICES: { choice: CropChoice; label: string; title: string; said: string }[] = [
  { choice: "free", label: "Libre", title: "Cualquier proporción", said: "libre" },
  { choice: "original", label: "Original", title: "La proporción de la foto", said: "la de la foto" },
  { choice: "1:1", label: "1:1", title: "Cuadrada", said: "cuadrada" },
  { choice: "4:3", label: "4:3", title: "4:3 (3:4 con una foto vertical)", said: "4:3" },
  { choice: "16:9", label: "16:9", title: "16:9 (9:16 con una foto vertical)", said: "16:9" },
];

/** La pista mientras se recorta (debajo del lienzo, y dicha al empezar). */
export const CROP_HINT =
  "Recorte: arrastra el rectángulo o sus tiradores. Con el teclado, las flechas lo mueven; Alt+flechas mueven el lado derecho o el de abajo y Alt+Mayús+flechas el izquierdo o el de arriba; + y − lo agrandan o achican. Enter aplica y Esc cancela. Mientras recortas, Deshacer no actúa.";
const PRECISION_NOTE = "La precisión es relativa al ancho de la foto: revisa que el círculo siga siendo el que quieres.";

/** «1 lugar queda fuera y se quitará», «2 puntos quedan fuera y se quitarán». */
export function outsideText(n: number, what: readonly [string, string]): string {
  return `${n} ${plural(n, what[0], what[1])} ${plural(n, "queda", "quedan")} fuera y se ${plural(n, "quitará", "quitarán")}`;
}

/** «Recorte: 62 % del ancho y 80 % del alto de la foto». */
const sizeSaid = (r: CropRect) => `Recorte: ${Math.round(r.w * 100)} % del ancho y ${Math.round(r.h * 100)} % del alto de la foto`;

/**
 * Lo que cambió además de la foto: lo que quedó fuera, los elementos que se
 * quedaron sin lugar (el alumno los verá como distractores), los tamaños que
 * se quedaron en su tope (se verán distintos que antes) y dos lugares que
 * quedaron encimados (al girar una foto alta, las distancias en fracciones del
 * ancho se achican; recortar solo las agranda).
 */
function changesSaid(before: AnyConfig, after: AnyConfig, removed: number, scale: number, what: readonly [string, string]): string {
  const parts: string[] = [];
  if (removed > 0) {
    parts.push(
      `Se ${plural(removed, "quitó", "quitaron")} ${removed} ${plural(removed, what[0], what[1])} que ${plural(removed, "quedaba", "quedaban")} fuera (Deshacer ${plural(removed, "lo", "los")} devuelve).`
    );
  }
  if ("elements" in before && "zones" in after) {
    const placed = new Set(after.zones.map((z) => z.elementId));
    const icons = iconNumbers(before.elements.map((e) => e.fileId));
    const orphans = before.elements
      .filter((e) => before.zones.some((z) => z.elementId === e.id) && !placed.has(e.id))
      .map((e) => (e.kind === "icon" ? `el ${imageItemName(e, icons)}` : `la etiqueta «${e.text ?? ""}»`));
    if (orphans.length > 0) {
      const who = joinY(orphans);
      parts.push(
        `${who[0].toUpperCase()}${who.slice(1)} ${plural(orphans.length, "quedó", "quedaron")} sin lugar: el alumno ${plural(orphans.length, "lo", "los")} verá como ${plural(orphans.length, "distractor", "distractores")}.`
      );
    }
    const bound = boundSizes(before, scale, after.aspect);
    for (const [n, which] of [[bound.max, "máximo"], [bound.min, "mínimo"]] as const) {
      if (n > 0) parts.push(`${n} ${plural(n, "elemento se ajustó", "elementos se ajustaron")} a su tamaño ${which}.`);
    }
    const pair = overlapNumbers(after.zones, after.aspect);
    if (pair && !overlapNumbers(before.zones, before.aspect)) parts.push(`${overlapSaid(pair)}.`);
  }
  return parts.join(" ");
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
  undo,
  answered = null,
  uploading,
  setUploading,
  setError,
  setNotice,
  announce,
  rootRef,
  onPickPhoto,
  onPhotoFile,
}: {
  type: ImageQuestionType;
  imageFileId: string | null;
  config: AnyConfig;
  /** Cambia la foto y la config (un paso del historial) y devuelve el valor nuevo. */
  record: (fn: (prev: ImageQuestionValue) => ImageQuestionValue) => ImageQuestionValue;
  /** Deshacer el último paso (un giro contrario al anterior): false si no había. */
  undo: () => boolean;
  /** El examen ya tiene intentos, o la pregunta respuestas en uno en curso: antes de recortar, girar o cambiar la foto, se confirma. */
  answered?: Answered;
  uploading: Uploading;
  setUploading: (u: Uploading) => void;
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  /** El editor: ahí vuelve el foco y ahí cuenta Esc. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** «Cambiar foto»: elegir otro archivo. */
  onPickPhoto: () => void;
  /** Subir otra foto (la soltada sobre la de ahora). */
  onPhotoFile: (file: File) => void;
}) {
  /** El recorte en curso, de qué foto y con qué tamaño en píxeles (para redondear como se hará). */
  const [crop, setCrop] = useState<{ fileId: string; rect: CropRect; choice: CropChoice; px: { w: number; h: number } | null } | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  /** Lo que espera la confirmación; `asked`, su título y su texto (no cambian mientras se cierra). */
  const [asking, setAsking] = useState<Asked | null>(null);
  const [asked, setAsked] = useState({ title: "", body: "" });
  const confirmed = useRef(false);
  /** Lo que tenía el foco al preguntar: el diálogo no tiene botón que lo abra, al cerrarse vuelve ahí. */
  const returnFocus = useRef<HTMLElement | null>(null);
  /** El último giro y cómo quedó todo: el giro contrario justo después solo lo deshace. */
  const lastTurn = useRef<{ dir: "cw" | "ccw"; value: ImageQuestionValue } | null>(null);
  // El recorte es de una foto: si cambió (deshacer, soltar otra), se deja (y no vuelve al volver a ella)
  if (crop && crop.fileId !== imageFileId) setCrop(null);
  const active = crop && crop.fileId === imageFileId ? crop : null;
  const { aspect } = config;
  /** Otra subida en curso, o la foto aún sin medir: las herramientas esperan. */
  const locked = uploading !== null || !imageFileId || !validAspect(aspect);
  const what = type === "image_drag" ? (["lugar", "lugares"] as const) : (["punto", "puntos"] as const);
  const snapped = (c: NonNullable<typeof crop>) => (c.px ? snapCrop(c.rect, c.px.w, c.px.h) : c.rect);
  const outside = active ? cropConfig(type, config, snapped(active)).removed : 0;

  const focusSoon = (selector: string) =>
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
  const inEditor = () => !!rootRef.current?.contains(document.activeElement);
  const waitSaid = () => announce(uploading !== null ? "Espera a que termine la subida" : "Espera a que cargue la foto");

  /** Con respuestas guardadas (y sin confirmar aún en este editor), pregunta antes de tocar la foto: true si preguntó. */
  function ask(what: Asked): boolean {
    if (!answered || confirmed.current) return false;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAsking(what);
    setAsked(askedText(answered, type, what.kind, what.kind === "crop" ? outside : 0));
    return true;
  }

  function startCrop() {
    if (locked || !imageFileId) return waitSaid();
    // El tamaño de la foto en píxeles: el aviso cuenta con el recorte redondeado como se hará
    const img = rootRef.current?.querySelector<HTMLImageElement>("[data-canvas-viewport] img");
    const px = img && img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    setCrop({ fileId: imageFileId, rect: FULL_CROP, choice: "free", px });
    setNotice(null);
    announce(CROP_HINT);
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
    announce(`Proporción: ${CROP_CHOICES.find((c) => c.choice === choice)?.said ?? ""}`);
  }

  /** Recortar o girar: primero, lo que no necesita foto nueva (deshacer un giro) y la confirmación si hay intentos. */
  function run(kind: Kind) {
    if (busy) return;
    if (locked || !imageFileId) return waitSaid();
    const turn = lastTurn.current;
    if (kind !== "crop" && turn && turn.dir !== kind && turn.value.imageFileId === imageFileId && turn.value.config === config) {
      lastTurn.current = null;
      if (undo()) {
        setNotice(null);
        return announce(`Foto girada a la ${kind === "cw" ? "derecha" : "izquierda"}: quedó como antes del giro anterior`);
      }
    }
    if (kind === "crop" && (!active || isFullCrop(active.rect))) {
      return announce("Mueve el rectángulo o sus tiradores para recortar: así la foto quedaría igual");
    }
    if (ask({ kind })) return;
    void transform(kind, inEditor());
  }

  /** Recorta o gira: la foto nueva, subida, y la config recolocada, en un solo paso. `hadFocus`: el foco estaba en el editor. */
  async function transform(kind: Kind, hadFocus: boolean) {
    if (!imageFileId || (kind === "crop" && !active)) return;
    const from = imageFileId;
    const rect = active?.rect ?? FULL_CROP;
    setBusy(kind);
    setUploading("photo");
    setError(null);
    setNotice(null);
    announce(kind === "crop" ? "Recortando la foto…" : "Girando la foto…");
    try {
      const original = await fetchPhoto(from);
      const done = await transformPhoto(original, kind === "crop" ? { crop: rect } : { rotate: kind }, { aspect }).catch((err: unknown) => {
        if (err instanceof PhotoError) throw err;
        console.error("No se pudo preparar la foto:", err);
        throw new PhotoError("Este navegador no pudo preparar la foto: recórtala o gírala antes y súbela con «Cambiar foto».");
      });
      // Nunca se sube (ni se guarda) una foto que la pregunta no aceptaría
      if (!validAspect(done.aspect)) {
        throw new PhotoError("La foto quedaría más de diez veces más ancha que alta (o al revés): deja el recorte un poco más amplio.");
      }
      const fileId = await uploadFile(new File([done.blob], done.name, { type: done.blob.type }), "editor_image");
      let said = null as string | null;
      const next = record((prev) => {
        const p = shaped(type, prev);
        // Mientras se preparaba se cambió la foto (deshacer, otra foto): no se toca nada
        if (p.imageFileId !== from) return prev;
        const cut = done.crop ?? rect;
        const out =
          kind === "crop" ? cropConfig(type, p.config, cut) : { config: rotateConfig(type, p.config, kind), removed: 0 };
        said = changesSaid(p.config, out.config, out.removed, kind === "crop" ? 1 / cut.w : 1 / p.config.aspect, what);
        return { imageFileId: fileId, config: { ...out.config, aspect: done.aspect } };
      });
      if (said === null) {
        const text = "La foto cambió mientras se preparaba: no se aplicó.";
        setNotice(text);
        return announce(text);
      }
      lastTurn.current = kind === "crop" ? null : { dir: kind, value: next };
      if (kind === "crop") {
        setCrop(null);
        if (hadFocus) focusSoon('[data-photo-tool="crop"]');
      }
      // En «señalar» el círculo de acierto es una fracción del ancho, y el ancho cambió
      const precision = type === "image_click" && (kind === "crop" || aspect !== 1) ? PRECISION_NOTE : "";
      const note = [said, precision].filter(Boolean).join(" ");
      if (note) setNotice(note);
      const headline = kind === "crop" ? "Foto recortada" : `Foto girada a la ${kind === "cw" ? "derecha" : "izquierda"}`;
      announce(`${headline}; los ${what[1]} siguen sobre lo mismo. ${note}`.trim());
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
    applyCrop: () => run("crop"),
    rotate: (dir: "cw" | "ccw") => run(dir),
    changePhoto: () => {
      if (uploading !== null) return waitSaid();
      if (!ask({ kind: "change", file: null })) onPickPhoto();
    },
    /** Otra foto soltada sobre la de ahora (con la confirmación si hay intentos). */
    dropPhoto: (file: File) => {
      if (!ask({ kind: "change", file })) onPhotoFile(file);
    },
    /** El rectángulo sobre la foto (para `ImageCanvas`), solo mientras se recorta. */
    cover: active ? (
      <CropCover
        rect={active.rect}
        ratio={cropRatio(active.choice, aspect)}
        aspect={aspect}
        busy={busy !== null}
        onChange={(rect) => setCrop((c) => c && { ...c, rect })}
        onResize={(rect) => announce(sizeSaid(rect))}
        onApply={() => run("crop")}
      />
    ) : null,
    /** La confirmación antes de recortar, girar o cambiar la foto con respuestas ya guardadas (`askedText`). */
    dialog: (
      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        {/* En un portal, pero sus teclas suben por React hasta el editor: ahí no son atajos */}
        <AlertDialogContent
          onKeyDown={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // Si ya no está («Aplicar recorte» se fue al terminar de recortar), al rectángulo o a «Recortar foto»
            const back = returnFocus.current?.isConnected
              ? returnFocus.current
              : rootRef.current?.querySelector<HTMLElement>('[data-crop-box], [data-photo-tool="crop"]');
            back?.focus({ preventScroll: true });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{asked.title}</AlertDialogTitle>
            <AlertDialogDescription>{asked.body} ¿Continuar?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const what = asking;
                confirmed.current = true;
                setAsking(null);
                if (!what) return;
                // Elegir el archivo va aquí mismo: el clic en «Continuar» deja abrir el selector
                if (what.kind === "change") return what.file ? onPhotoFile(what.file) : onPickPhoto();
                void transform(what.kind, !!rootRef.current?.contains(returnFocus.current));
              }}
            >
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  };
}
