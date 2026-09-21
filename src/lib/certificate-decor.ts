/**
 * Adornos de certificado como DATOS (isomórfico: sin server-only).
 * La misma lista de primitivas la dibujan:
 *  - el servidor con pdf-lib (renderCertificatePdf)
 *  - el editor con un overlay SVG (vista previa 100% fiel)
 *
 * Coordenadas FRACCIONALES (0–1) sobre el tamaño de página, origen arriba-
 * izquierda: escalan a carta/A4 y a ambas orientaciones sin recalcular nada.
 */

export type DecorElement =
  | { type: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number; opacity?: number }
  | { type: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }
  /** Path SVG (solo trazo), origen en (x,y), escalado por `scale` en puntos */
  | { type: "path"; d: string; x: number; y: number; scale: number; color: string; width: number; opacity?: number };

export type DecorPreset = {
  id: string;
  name: string;
  description: string;
  elements: DecorElement[];
};

// Paleta de impresión v3: azul noche + dorado + slate (coherente con la UI,
// pero pensada para papel)
const DEEP = "#1e1b4b";
const BROWN = "#312e81"; // tono medio (nombre histórico de la constante)
const GOLD = "#c9a227";
const CREAM = "#eef2ff";

/** Rizo de esquina (se rota reflejando coordenadas). ~100×100 unidades. */
const FLOURISH = "M 0 100 C 0 40 10 10 60 4 C 80 2 96 8 100 0 M 8 100 C 10 60 24 28 64 18";

function corners(inset: number, scalePts: number, color: string, width: number): DecorElement[] {
  // Cuatro esquinas ancladas EN la esquina del marco. El path base crece
  // hacia abajo-derecha desde su origen; para las esquinas derecha/inferior
  // se NIEGA la coordenada (x→−x, y→−y): la forma queda espejada Y crece
  // hacia adentro de la página — así ningún rizo se sale del marco.
  const flip = (d: string, fx: boolean, fy: boolean): string =>
    d.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (_, x, y) => {
      const nx = fx ? -parseFloat(x) : parseFloat(x);
      const ny = fy ? -parseFloat(y) : parseFloat(y);
      return `${nx} ${ny}`;
    });
  return [
    { type: "path", d: FLOURISH, x: inset, y: inset, scale: scalePts, color, width },
    { type: "path", d: flip(FLOURISH, true, false), x: 1 - inset, y: inset, scale: scalePts, color, width },
    { type: "path", d: flip(FLOURISH, false, true), x: inset, y: 1 - inset, scale: scalePts, color, width },
    { type: "path", d: flip(FLOURISH, true, true), x: 1 - inset, y: 1 - inset, scale: scalePts, color, width },
  ];
}

export const DECOR_PRESETS: DecorPreset[] = [
  {
    id: "clasico",
    name: "Clásico",
    description: "Doble marco con rizos en las esquinas — el diploma tradicional",
    elements: [
      { type: "rect", x: 0.03, y: 0.04, w: 0.94, h: 0.92, stroke: DEEP, strokeWidth: 2.5 },
      { type: "rect", x: 0.045, y: 0.06, w: 0.91, h: 0.88, stroke: GOLD, strokeWidth: 1 },
      ...corners(0.065, 0.06, GOLD, 1.4),
      { type: "line", x1: 0.42, y1: 0.09, x2: 0.58, y2: 0.09, color: BROWN, width: 1.2 },
      { type: "circle", cx: 0.5, cy: 0.09, r: 0.006, fill: GOLD },
    ],
  },
  {
    id: "elegante",
    name: "Elegante",
    description: "Banda lateral azul noche con filos dorados — sobrio y ejecutivo",
    elements: [
      { type: "rect", x: 0, y: 0, w: 0.085, h: 1, fill: DEEP },
      { type: "rect", x: 0.085, y: 0, w: 0.012, h: 1, fill: GOLD },
      { type: "rect", x: 0.103, y: 0, w: 0.004, h: 1, fill: GOLD, opacity: 0.5 },
      { type: "line", x1: 0.16, y1: 0.88, x2: 0.95, y2: 0.88, color: GOLD, width: 1 },
      { type: "circle", cx: 0.0425, cy: 0.14, r: 0.028, stroke: GOLD, strokeWidth: 1.4 },
      { type: "circle", cx: 0.0425, cy: 0.14, r: 0.02, stroke: GOLD, strokeWidth: 0.7 },
    ],
  },
  {
    id: "moderno",
    name: "Moderno",
    description: "Cabecera azul noche con subrayado dorado y acento circular",
    elements: [
      { type: "rect", x: 0, y: 0, w: 1, h: 0.13, fill: DEEP },
      { type: "rect", x: 0, y: 0.13, w: 1, h: 0.008, fill: GOLD },
      // Círculo COMPLETO dentro de la hoja (sangrar al borde se veía roto)
      { type: "circle", cx: 0.86, cy: 0.78, r: 0.1, fill: CREAM, opacity: 0.55 },
      { type: "circle", cx: 0.86, cy: 0.78, r: 0.1, stroke: GOLD, strokeWidth: 1, opacity: 0.8 },
      { type: "line", x1: 0.06, y1: 0.93, x2: 0.34, y2: 0.93, color: BROWN, width: 2 },
    ],
  },
  {
    id: "sello",
    name: "Sello",
    description: "Marco sencillo con roseta de sello — para constancias oficiales",
    elements: [
      { type: "rect", x: 0.035, y: 0.045, w: 0.93, h: 0.91, stroke: BROWN, strokeWidth: 2 },
      { type: "line", x1: 0.3, y1: 0.115, x2: 0.7, y2: 0.115, color: GOLD, width: 1 },
      { type: "line", x1: 0.35, y1: 0.13, x2: 0.65, y2: 0.13, color: GOLD, width: 0.6 },
      { type: "circle", cx: 0.865, cy: 0.79, r: 0.085, stroke: GOLD, strokeWidth: 1.6 },
      { type: "circle", cx: 0.865, cy: 0.79, r: 0.07, stroke: BROWN, strokeWidth: 0.8 },
      { type: "circle", cx: 0.865, cy: 0.79, r: 0.012, fill: GOLD },
    ],
  },
  {
    id: "corporativo",
    name: "Corporativo",
    description: "Banda lateral azul noche con filos dorados y línea de firma",
    elements: [
      { type: "rect", x: 0, y: 0, w: 0.07, h: 1, fill: DEEP },
      { type: "rect", x: 0.07, y: 0, w: 0.008, h: 1, fill: GOLD },
      { type: "rect", x: 0.925, y: 0.06, w: 0.045, h: 0.012, fill: GOLD },
      { type: "rect", x: 0.925, y: 0.085, w: 0.03, h: 0.006, fill: GOLD, opacity: 0.6 },
      { type: "line", x1: 0.14, y1: 0.84, x2: 0.45, y2: 0.84, color: DEEP, width: 1.2 },
      { type: "line", x1: 0.14, y1: 0.93, x2: 0.93, y2: 0.93, color: GOLD, width: 0.8, opacity: 0.8 },
    ],
  },
  {
    id: "academico",
    name: "Académico",
    description: "Doble marco azul con sello dorado — estilo diploma universitario",
    elements: [
      { type: "rect", x: 0.028, y: 0.036, w: 0.944, h: 0.928, stroke: DEEP, strokeWidth: 3 },
      { type: "rect", x: 0.04, y: 0.052, w: 0.92, h: 0.896, stroke: GOLD, strokeWidth: 1.2 },
      { type: "rect", x: 0.046, y: 0.06, w: 0.908, h: 0.88, stroke: DEEP, strokeWidth: 0.5, opacity: 0.5 },
      { type: "circle", cx: 0.5, cy: 0.105, r: 0.016, stroke: GOLD, strokeWidth: 1.2 },
      { type: "circle", cx: 0.5, cy: 0.105, r: 0.006, fill: DEEP },
      { type: "line", x1: 0.38, y1: 0.105, x2: 0.478, y2: 0.105, color: GOLD, width: 1 },
      { type: "line", x1: 0.522, y1: 0.105, x2: 0.62, y2: 0.105, color: GOLD, width: 1 },
      { type: "circle", cx: 0.86, cy: 0.8, r: 0.078, fill: GOLD, opacity: 0.15 },
      { type: "circle", cx: 0.86, cy: 0.8, r: 0.078, stroke: GOLD, strokeWidth: 1.6 },
      { type: "circle", cx: 0.86, cy: 0.8, r: 0.064, stroke: DEEP, strokeWidth: 0.8, opacity: 0.7 },
    ],
  },
  {
    id: "minimal",
    name: "Minimalista",
    description: "Dos líneas doradas y un punto — limpieza absoluta",
    elements: [
      { type: "line", x1: 0.12, y1: 0.12, x2: 0.88, y2: 0.12, color: GOLD, width: 1.4 },
      { type: "line", x1: 0.12, y1: 0.9, x2: 0.88, y2: 0.9, color: GOLD, width: 1.4 },
      { type: "circle", cx: 0.5, cy: 0.12, r: 0.007, fill: BROWN },
      { type: "circle", cx: 0.5, cy: 0.9, r: 0.007, fill: BROWN },
    ],
  },
];

export function getDecorPreset(id: string | null | undefined): DecorPreset | null {
  if (!id) return null;
  return DECOR_PRESETS.find((p) => p.id === id) ?? null;
}
