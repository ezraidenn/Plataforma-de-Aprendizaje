import {
  PRECISION_RADIUS,
  imageClickHits,
  type ImageClickConfig,
  type ImageDragConfig,
  type Point,
} from "./image-questions";
import { elementView, type ElementView } from "./image-layout";

/**
 * Tableros que dibujan la solución de una pregunta sobre imagen: los usa la
 * revisión del alumno (con lo que respondió) y la vista previa del maestro
 * (solo la solución). Puro: sin BD ni DOM.
 */

/** Tablero de revisión de una pregunta sobre imagen (solo viaja con resultados visibles). */
export type ReviewBoard =
  | {
      kind: "drag";
      image: string;
      aspect: number;
      /** Cada elemento con su tamaño, proporción y giro. */
      zones: { x: number; y: number; correct: boolean; placed: ElementView | null; expected: ElementView }[];
      /** Archivos de todos los íconos de la pregunta, para numerar «Ícono N» como el alumno. */
      iconFiles: string[];
    }
  | {
      kind: "click";
      image: string;
      aspect: number;
      radius: number;
      spots: { x: number; y: number; hit: boolean }[];
      marks: { x: number; y: number }[];
    };

type DragBoard = Extract<ReviewBoard, { kind: "drag" }>;
type ClickBoard = Extract<ReviewBoard, { kind: "click" }>;

/**
 * Arrastrar: cada lugar con el elemento que va. Con `placed` (el elemento que
 * puso el alumno en cada lugar), también lo que puso y si acertó.
 */
export function dragReviewBoard(image: string, config: ImageDragConfig, placed?: (string | undefined)[]): DragBoard {
  const views = new Map(config.elements.map((e) => [e.id, elementView(e, config.iconSize)]));
  return {
    kind: "drag",
    image,
    aspect: config.aspect,
    zones: config.zones.map((z, i) => {
      const put = placed?.[i];
      return {
        x: z.x,
        y: z.y,
        correct: placed ? put === z.elementId : true,
        placed: put ? (views.get(put) ?? null) : null,
        // La config ya se validó: cada lugar apunta a un elemento que existe
        expected: views.get(z.elementId)!,
      };
    }),
    // Todos los íconos, también los distractores que no se pusieron: con
    // ellos «Ícono N» se numera igual que en el banco del alumno
    iconFiles: config.elements.flatMap((e) => (e.kind === "icon" && e.fileId ? [e.fileId] : [])),
  };
}

/**
 * Señalar: los puntos correctos con su radio. Con `marks` (las del alumno),
 * cuáles acertó, con el mismo emparejamiento que la calificación.
 */
export function clickReviewBoard(image: string, config: ImageClickConfig, marks?: Point[]): ClickBoard {
  const hits = marks ? imageClickHits(config, marks) : config.spots.map(() => true);
  return {
    kind: "click",
    image,
    aspect: config.aspect,
    radius: PRECISION_RADIUS[config.precision],
    spots: config.spots.map((s, i) => ({ x: s.x, y: s.y, hit: hits[i] })),
    marks: marks ?? [],
  };
}
