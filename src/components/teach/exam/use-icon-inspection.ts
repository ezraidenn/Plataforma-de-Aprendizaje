"use client";

import { useEffect, useState } from "react";
import { fileUrl } from "@/lib/image-questions";
import { inspectIcon, type IconInspection } from "@/lib/image-processing";

/**
 * Revisión de los íconos ya subidos de una pregunta (su proporción y si les
 * sobra margen transparente), para los que se subieron antes del recorte. Una
 * sola revisión por archivo en toda la página; lo que no se puede leer queda
 * sin revisar.
 */

const inspections = new Map<string, Promise<IconInspection | null>>();
/** Los hooks montados: se enteran de lo que se recuerda después (p. ej. que un ícono ya no tiene margen). */
const listeners = new Set<(fileId: string, info: IconInspection) => void>();

function inspectFile(fileId: string): Promise<IconInspection | null> {
  let found = inspections.get(fileId);
  if (!found) {
    found = fetch(fileUrl(fileId))
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob ? inspectIcon(blob) : null))
      .catch(() => null);
    inspections.set(fileId, found);
  }
  return found;
}

/** Lo revisado de cada archivo (se va llenando). */
export function useIconInspection(fileIds: string[]): ReadonlyMap<string, IconInspection> {
  const key = [...new Set(fileIds)].sort().join(",");
  const [found, setFound] = useState<ReadonlyMap<string, IconInspection>>(() => new Map());
  useEffect(() => {
    if (!key) return;
    const wanted = new Set(key.split(","));
    let alive = true;
    const keep = (fileId: string, info: IconInspection | null) => {
      if (alive && info) setFound((prev) => (prev.get(fileId) === info ? prev : new Map(prev).set(fileId, info)));
    };
    for (const fileId of wanted) void inspectFile(fileId).then((info) => keep(fileId, info));
    const onRemember = (fileId: string, info: IconInspection) => {
      if (wanted.has(fileId)) keep(fileId, info);
    };
    listeners.add(onRemember);
    return () => {
      alive = false;
      listeners.delete(onRemember);
    };
  }, [key]);
  return found;
}

/**
 * Lo que ya se sabe de un archivo sin revisarlo: uno nuevo (se acaba de
 * preparar) o uno que resultó no tener margen. Los hooks montados lo toman al
 * momento (p. ej. el botón «Quitar margen» desaparece).
 */
export function rememberInspection(fileId: string, info: IconInspection) {
  inspections.set(fileId, Promise.resolve(info));
  for (const listener of listeners) listener(fileId, info);
}
