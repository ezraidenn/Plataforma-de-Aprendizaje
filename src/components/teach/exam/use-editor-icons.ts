"use client";

import { useEffect, useRef, useState } from "react";
import { uploadFile } from "@/lib/upload-client";
import { MAX_ELEMENTS, fileUrl, type ImageDragConfig, type ImageElement } from "@/lib/image-questions";
import { DEFAULT_ICON_SIZE } from "@/lib/image-layout";
import { prepareIcon, type PreparedIcon } from "@/lib/image-processing";
import type { HistoryOptions } from "./use-editor-history";
import { rememberInspection, useIconInspection } from "./use-icon-inspection";

/**
 * Los íconos del editor de «arrastrar». Subirlos: sin sus márgenes
 * transparentes y sin repetir uno que ya está en la lista. Los subidos antes
 * del recorte: toman la proporción de su archivo y, si les sobra margen,
 * ofrecen «Quitar margen» (se sube recortado y el elemento cambia de archivo;
 * el viejo se queda: deshacer vuelve a él).
 */

export const DUPLICATE = "Ya está en la lista: colócalo en varios lugares";
const UNREADABLE = "No se pudo leer la imagen: usa un ícono PNG, JPG, WEBP o GIF.";
const EMPTY_ICON = "Ese ícono está vacío (todo transparente): elige otra imagen.";
const NO_MARGIN = "Ese ícono ya no tiene margen.";
const SAME_TRIMMED = "Ya hay en la lista un ícono igual sin margen: deja uno y colócalo en varios lugares.";

export function newElementId(elements: ImageElement[]): string {
  const taken = new Set(elements.map((e) => e.id));
  let id = "";
  while (!id || taken.has(id)) id = `e${Math.random().toString(36).slice(2, 10)}`;
  return id;
}

/**
 * Huella del contenido de un archivo: SHA-256. Fuera de https (una IP de la
 * red local) el navegador no ofrece `crypto.subtle`: ahí basta FNV-1a, que
 * solo compara los íconos de una misma pregunta.
 */
async function fingerprint(data: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5;
  for (const byte of new Uint8Array(data)) h = Math.imul(h ^ byte, 0x01000193);
  return `fnv-${(h >>> 0).toString(16)}`;
}

/** Un archivo por comparar: su tamaño y su huella (calculada una sola vez, y solo si hace falta). */
type Candidate = { size: number; print: () => Promise<string> };
function candidate(blob: Blob): Candidate {
  let print: Promise<string> | null = null;
  return { size: blob.size, print: () => (print ??= blob.arrayBuffer().then(fingerprint)) };
}

/** El ícono ya recortado; si el navegador no lo puede leer, el error real va a la consola y el amable, arriba. */
function prepare(file: File): Promise<PreparedIcon | null> {
  return prepareIcon(file).catch((err: unknown) => {
    console.error("No se pudo preparar el ícono:", err);
    throw new Error(UNREADABLE);
  });
}

/** El Blob preparado como archivo para subirlo, con su nombre y su tipo. */
const asFile = (icon: PreparedIcon) => new File([icon.blob], icon.name, { type: icon.blob.type });

export function useEditorIcons({
  elements,
  uploading,
  setUploading,
  setError,
  setNotice,
  announce,
  setConfig,
  nameOf,
}: {
  elements: ImageElement[];
  uploading: "photo" | "icon" | null;
  setUploading: (u: "photo" | "icon" | null) => void;
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
  announce: (text: string) => void;
  setConfig: (fn: (c: ImageDragConfig) => ImageDragConfig, options?: HistoryOptions) => void;
  nameOf: (id: string) => string;
}) {
  /** Tamaño y huella de los íconos ya vistos (por archivo), para no subir dos veces el mismo. */
  const iconPrints = useRef(new Map<string, { size: number; hash?: string }>());
  /** Ícono al que se le está quitando el margen. */
  const [trimming, setTrimming] = useState<string | null>(null);
  /** Proporción y margen de cada archivo de ícono (para los subidos antes del recorte). */
  const inspected = useIconInspection(elements.flatMap((e) => (e.kind === "icon" && e.fileId ? [e.fileId] : [])));

  // Íconos subidos antes del recorte (sin proporción): toman la de su archivo y
  // su caja pasa a ser la del dibujo. Se ven igual (su tamaño es el lado mayor):
  // no es un paso del historial
  useEffect(() => {
    const pending = elements.some((e) => e.kind === "icon" && e.ratio === undefined && !!e.fileId && inspected.has(e.fileId));
    if (!pending) return;
    setConfig(
      (c) => ({
        ...c,
        elements: c.elements.map((e) => {
          const info = e.kind === "icon" && e.ratio === undefined && e.fileId ? inspected.get(e.fileId) : undefined;
          return info ? { ...e, ratio: info.ratio } : e;
        }),
      }),
      { silent: true }
    );
  }, [elements, inspected, setConfig]);

  /**
   * ¿Ya hay en la lista (sin contar el elemento `except`) un ícono con el mismo
   * contenido que alguno de estos? Primero el tamaño; la huella, solo si coincide.
   */
  async function iconExists(candidates: Candidate[], except?: string): Promise<boolean> {
    const sizes = new Set(candidates.map((c) => c.size));
    const checks = elements.map(async (e) => {
      if (e.kind !== "icon" || !e.fileId || e.id === except) return false;
      let known = iconPrints.current.get(e.fileId);
      if (!known || (sizes.has(known.size) && !known.hash)) {
        const res = await fetch(fileUrl(e.fileId)).catch(() => null);
        if (!res?.ok) return false;
        const length = res.headers.get("content-length");
        if (length !== null && !sizes.has(Number(length))) {
          // Otro tamaño: ni se descarga el resto
          void res.body?.cancel();
          iconPrints.current.set(e.fileId, { size: Number(length) });
          return false;
        }
        const data = await res.arrayBuffer();
        known = { size: data.byteLength, hash: await fingerprint(data) };
        iconPrints.current.set(e.fileId, known);
      }
      for (const c of candidates) {
        if (c.size === known.size && known.hash === (await c.print())) return true;
      }
      return false;
    });
    return (await Promise.all(checks)).some(Boolean);
  }

  /** Un aviso de algo que no se hizo, a la vista y en voz alta. */
  function warn(text: string) {
    setNotice(text);
    announce(text);
  }

  /** Sube un ícono ya preparado y lo recuerda (su huella y que ya no tiene margen). */
  async function uploadIcon(icon: PreparedIcon, print: Candidate): Promise<string> {
    const fileId = await uploadFile(asFile(icon), "editor_image");
    iconPrints.current.set(fileId, { size: print.size, hash: await print.print() });
    rememberInspection(fileId, { ratio: icon.ratio, margin: false });
    return fileId;
  }

  async function addIcon(file: File) {
    if (uploading || elements.length >= MAX_ELEMENTS) return;
    setError(null);
    setNotice(null);
    setUploading("icon");
    try {
      // Solo el dibujo: sin márgenes transparentes y a un tamaño razonable
      const icon = await prepare(file);
      if (!icon) return warn(EMPTY_ICON);
      // Repetido: el recorte (íconos nuevos) o el archivo tal cual (subidos antes del recorte)
      const prepared = candidate(icon.blob);
      if (await iconExists([prepared, candidate(file)])) return warn(DUPLICATE);
      const fileId = await uploadIcon(icon, prepared);
      const element: ImageElement = { id: newElementId(elements), kind: "icon", fileId, size: DEFAULT_ICON_SIZE, ratio: icon.ratio };
      setConfig((c) => (c.elements.length >= MAX_ELEMENTS ? c : { ...c, elements: [...c.elements, element] }));
      announce("Ícono agregado: arrástralo a la foto");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el ícono");
    } finally {
      setUploading(null);
    }
  }

  /**
   * «Quitar margen» a un ícono subido antes del recorte: se sube recortado y el
   * elemento cambia de archivo y proporción; conserva su tamaño, su giro y sus
   * lugares (como el tamaño es el lado mayor, el dibujo ahora lo ocupa entero).
   */
  async function trimIcon(id: string) {
    const element = elements.find((e) => e.id === id);
    if (uploading || !element?.fileId) return;
    setError(null);
    setNotice(null);
    setUploading("icon");
    setTrimming(id);
    try {
      const res = await fetch(fileUrl(element.fileId)).catch(() => null);
      if (!res?.ok) throw new Error("No se pudo leer el ícono: quítalo y vuelve a subirlo.");
      const blob = await res.blob();
      const icon = await prepare(new File([blob], "icono", { type: blob.type }));
      if (!icon) return warn(EMPTY_ICON);
      if (!icon.trimmed) {
        rememberInspection(element.fileId, { ratio: icon.ratio, margin: false });
        return warn(NO_MARGIN);
      }
      const prepared = candidate(icon.blob);
      if (await iconExists([prepared], id)) return warn(SAME_TRIMMED);
      const fileId = await uploadIcon(icon, prepared);
      setConfig((c) => ({
        ...c,
        elements: c.elements.map((e) => (e.id === id ? { ...e, fileId, ratio: icon.ratio } : e)),
      }));
      // El tamaño es el lado mayor: sin el margen, el dibujo lo ocupa entero y se ve más grande
      announce(`${nameOf(id)}: margen quitado, ahora se ve solo su dibujo. Si quedó muy grande, ajusta su tamaño en «Seleccionado»`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar el margen");
    } finally {
      setUploading(null);
      setTrimming(null);
    }
  }

  /** El ícono tiene margen transparente que se le puede quitar. */
  const hasMargin = (e: ImageElement) => e.kind === "icon" && !!e.fileId && !!inspected.get(e.fileId)?.margin;

  return { addIcon, trimIcon, trimming, hasMargin };
}
