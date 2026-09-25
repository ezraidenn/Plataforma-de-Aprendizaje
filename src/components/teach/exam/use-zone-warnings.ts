"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { boxBounds, boxesOverlap, elementBox, elementView, type Box } from "@/lib/image-layout";
import { MIN_ZONE_GAP, overlapNumbers, relDistance, type ImageElement, type ImageZone } from "@/lib/image-questions";
import { joinY } from "@/lib/plural";
import { elementSizeAt } from "./use-canvas-tools";

/**
 * Avisos del editor de «arrastrar». Dos que no impiden guardar: dos lugares
 * que se tapan a la vista y lugares que se salen por la orilla de la foto. Se
 * miden con la caja de cada lugar (su tamaño, su proporción y su giro) con la
 * foto al 100 % (`fit`), no como se ve con el zoom: así no aparecen ni se van
 * al acercar o alejar (un ícono al mínimo legible cambia de tamaño relativo).
 * Las etiquetas se miden en sus botones `[data-zone]` dentro de `rootRef`
 * (`elementSizeAt`). Y uno que sí: dos lugares encimados (centros a menos de
 * MIN_ZONE_GAP). Sale de los lugares mismos, así que se va en cuanto se
 * separan, se haga como se haga (arrastrar, flechas, imán, alinear,
 * deshacer). A la vista lo muestra la línea de lo que impide guardar
 * (`imageEditorProblem`); aquí solo se dice en voz alta cuando aparece o
 * cambia de pareja, no en cada cambio.
 */

/** Tocar la orilla justo no es salirse (redondeo de las cajas). */
const EDGE_EPS = 1e-6;

/** Aviso de lugares que se salen por la orilla, según lo que haya en ellos. */
function edgeWarning(numbers: number[], kinds: Set<string | undefined>): string {
  const one = numbers.length === 1;
  const places = one ? `del lugar ${numbers[0]}` : `de los lugares ${joinY(numbers)}`;
  if (kinds.size === 1 && kinds.has("text")) {
    return one
      ? `La etiqueta ${places} queda pegada a la orilla: al alumno se le puede ver cortada.`
      : `Las etiquetas ${places} quedan pegadas a la orilla: al alumno se le pueden ver cortadas.`;
  }
  if (kinds.size === 1 && kinds.has("icon")) {
    return one
      ? `El ícono ${places} queda pegado a la orilla: al alumno se le puede ver cortado.`
      : `Los íconos ${places} quedan pegados a la orilla: al alumno se le pueden ver cortados.`;
  }
  return `Los lugares ${joinY(numbers)} quedan pegados a la orilla: al alumno se le pueden ver cortados.`;
}

export function useZoneWarnings({
  rootRef,
  fit,
  boardWidth,
  zones,
  ordered,
  numbers,
  byId,
  aspect,
  dense,
  announce,
}: {
  rootRef: RefObject<HTMLElement | null>;
  /** Ancho de la foto al 100 % (px): con él se mide. */
  fit: number;
  /** Ancho de la foto como se ve (px): así están dibujadas las etiquetas que se miden. */
  boardWidth: number;
  zones: ImageZone[];
  /** Índices de los lugares en orden de lectura. */
  ordered: number[];
  /** «Lugar N» de cada índice. */
  numbers: number[];
  byId: ReadonlyMap<string, ImageElement>;
  aspect: number;
  /** Etiquetas más justas: cambia lo que miden. */
  dense: boolean;
  announce: (text: string) => void;
}): { covered: string | null; edge: string | null } {
  /** Dos lugares encimados (no se puede guardar), los primeros en orden de lectura. */
  const overlap = useMemo(() => {
    const pair = overlapNumbers(zones, aspect);
    return pair ? `Los lugares ${pair[0]} y ${pair[1]} quedaron encimados: sepáralos un poco (así no se puede guardar).` : null;
  }, [zones, aspect]);
  // A la vista lo dice la línea de «lo que impide guardar» (con los mismos números); aquí solo se
  // dice en voz alta. Lo que ya estaba al abrir no se anuncia; lo que aparece después, una vez
  const said = useRef(overlap);
  useEffect(() => {
    if (overlap && overlap !== said.current) announce(overlap);
    said.current = overlap;
  }, [overlap, announce]);

  /** Dos lugares (índices) que se tapan a la vista. */
  const [covered, setCovered] = useState<[number, number] | null>(null);
  /** Lugares (índices) que se salen por la orilla de la foto. */
  const [edgeClipped, setEdgeClipped] = useState<number[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || fit <= 0 || boardWidth <= 0) return;
    const boxes = new Map<number, Box>();
    zones.forEach((z, i) => {
      const element = byId.get(z.elementId);
      if (!element) return;
      // El botón mide la ficha sin girar (el giro va dentro)
      const rel = elementSizeAt(element, fit, root.querySelector<HTMLElement>(`[data-zone="${i}"]`), boardWidth);
      if (rel) boxes.set(i, elementBox(z, rel, elementView(element).rotation, aspect));
    });

    // Dos lugares que se tapan a la vista
    const find = (): [number, number] | null => {
      for (let a = 0; a < ordered.length; a++) {
        for (let b = a + 1; b < ordered.length; b++) {
          const [i, j] = [ordered[a], ordered[b]];
          // Más cerca aún: es el error «encimados» de la validación, que no deja guardar
          if (relDistance(zones[i], zones[j], aspect) < MIN_ZONE_GAP) continue;
          const [bi, bj] = [boxes.get(i), boxes.get(j)];
          if (bi && bj && boxesOverlap(bi, bj)) return [i, j];
        }
      }
      return null;
    };
    const found = find();
    setCovered((prev) => (prev?.[0] === found?.[0] && prev?.[1] === found?.[1] ? prev : found));

    // Lugares que, sin recortar, se salen del rectángulo de la foto
    const clipped = ordered.filter((i) => {
      const box = boxes.get(i);
      if (!box) return false;
      const r = boxBounds(box);
      return r.left < -EDGE_EPS || r.right > 1 + EDGE_EPS || r.top < -EDGE_EPS || r.bottom > 1 + EDGE_EPS;
    });
    setEdgeClipped((prev) =>
      prev.length === clipped.length && prev.every((v, idx) => v === clipped[idx]) ? prev : clipped
    );
  }, [rootRef, zones, ordered, byId, dense, fit, boardWidth, aspect]);

  const coveredText =
    covered && numbers[covered[0]] && numbers[covered[1]]
      ? `Los lugares ${numbers[covered[0]]} y ${numbers[covered[1]]} se tapan: al alumno le costará distinguirlos.`
      : null;
  const edgeNumbers = edgeClipped
    .map((i) => numbers[i])
    .filter(Boolean)
    .sort((a, b) => a - b);
  const edgeKinds = new Set(edgeClipped.map((i) => byId.get(zones[i]?.elementId ?? "")?.kind));
  return { covered: coveredText, edge: edgeNumbers.length > 0 ? edgeWarning(edgeNumbers, edgeKinds) : null };
}
