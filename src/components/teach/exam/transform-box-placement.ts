import { CANVAS_PAD } from "./use-canvas-zoom";

/**
 * Dónde van la bolita de girar y la lectura del valor de la caja de
 * transformación (`image-transform-box.tsx`), respecto al marco (girado con la
 * ficha). Van fuera del marco si caben en el lienzo (la foto y su margen, el
 * `data-pad` de quien la envuelve): la bolita arriba y la lectura abajo. Con
 * un lugar pegado a la orilla la bolita pasa al otro lado y la lectura va del
 * lado contrario a ella o, si ahí tampoco cabe, más allá de la bolita (`far`).
 * Si la bolita no cabe de ningún lado (una ficha casi tan alta como la foto),
 * va dentro del marco.
 */

export type Side = "above" | "below" | "inside";
export type Placement = { knob: Side; readout: Side; far: boolean };
export const OUTSIDE: Placement = { knob: "above", readout: "below", far: false };

/** Del borde de la ficha al centro de la bolita (34 px hasta su borde de arriba, menos su radio) y al de la lectura (cerca o más allá de la bolita). */
const KNOB_GAP = 28;
const READOUT_GAP = 22;
const READOUT_FAR_GAP = 52;
/** Radio de la bolita (con algo de su área de toque) y medio ancho y medio alto de la lectura, en px. */
const KNOB_R = 9;
const READOUT_HALF = { w: 28, h: 11 };

/**
 * Dónde caben. `box` es la capa del marco (del tamaño de la ficha sin girar),
 * dentro de su `BoardSpot` (centrado en la ficha), dentro de la foto.
 */
export function placement(box: HTMLElement | null, rotation: number): Placement {
  const spot = box?.offsetParent;
  const board = spot instanceof HTMLElement ? spot.offsetParent : null;
  if (!box || !(spot instanceof HTMLElement) || !(board instanceof HTMLElement)) return OUTSIDE;
  const t = (rotation * Math.PI) / 180;
  const half = box.offsetHeight / 2;
  // El margen del lienzo lo dice quien envuelve a la foto (es menor en pantallas angostas)
  const room = Number(board.parentElement?.dataset.pad) || CANVAS_PAD;
  // Algo centrado a `d` px del centro de la ficha hacia su «arriba» (negativo: hacia abajo), de medio tamaño rx × ry
  const fits = (d: number, rx: number, ry: number) => {
    const x = spot.offsetLeft + Math.sin(t) * d;
    const y = spot.offsetTop - Math.cos(t) * d;
    return x - rx >= -room && x + rx <= board.clientWidth + room && y - ry >= -room && y + ry <= board.clientHeight + room;
  };
  const at = (side: Side, gap: number) => (side === "above" ? half + gap : -(half + gap));
  const knob = (["above", "below"] as const).find((s) => fits(at(s, KNOB_GAP), KNOB_R, KNOB_R)) ?? "inside";
  const options: [Side, boolean][] =
    knob === "inside" ? [["below", false], ["above", false]] : [[knob === "above" ? "below" : "above", false], [knob, true]];
  const readout = options.find(([s, far]) => fits(at(s, far ? READOUT_FAR_GAP : READOUT_GAP), READOUT_HALF.w, READOUT_HALF.h));
  return { knob, readout: readout?.[0] ?? "inside", far: readout?.[1] ?? false };
}
