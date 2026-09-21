/**
 * El árbol del curso: con «+ Agregar» la lección nueva entra al final, y al
 * arrastrarla a su lugar la numeración se reacomoda sola.
 */
export const TREE_EDIT_CYCLE_MS = 11_000;

export type TreeEditRow = { title: string; meta: string; isNew?: boolean };

export type TreeEditState = {
  /** Filas visibles, en orden */
  rows: TreeEditRow[];
  stage: "menu" | "added" | "dragging" | "settled";
  /** Fila que se arrastra (índice) o null */
  dragging: number | null;
};

const BASE: TreeEditRow[] = [
  { title: "Bienvenida y objetivos", meta: "Lectura" },
  { title: "Manual del participante", meta: "Documento · 8 páginas" },
  { title: "Evaluación parcial", meta: "Examen · 5 preguntas" },
];
const NEW: TreeEditRow = { title: "La química del fuego", meta: "Video · 6 min", isNew: true };

export function treeEditStory(phase: number): TreeEditState {
  if (phase < 0.22) {
    return { rows: BASE, stage: "menu", dragging: null };
  }
  if (phase < 0.45) {
    return { rows: [...BASE, NEW], stage: "added", dragging: null };
  }
  if (phase < 0.72) {
    // Se agarra la fila nueva (la última) para llevarla a su lugar
    return { rows: [...BASE, NEW], stage: "dragging", dragging: BASE.length };
  }
  // Soltada: queda en la posición 2, justo después de la bienvenida
  return { rows: [BASE[0], NEW, BASE[1], BASE[2]], stage: "settled", dragging: null };
}
