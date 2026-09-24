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
    let alive = true;
    for (const fileId of key.split(",")) {
      void inspectFile(fileId).then((info) => {
        if (alive && info) setFound((prev) => (prev.get(fileId) === info ? prev : new Map(prev).set(fileId, info)));
      });
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return found;
}

/** Un archivo nuevo ya se sabe cómo es (se acaba de preparar): no hace falta revisarlo. */
export function rememberInspection(fileId: string, info: IconInspection) {
  inspections.set(fileId, Promise.resolve(info));
}
