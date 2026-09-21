/**
 * Importar estudiantes por CSV: se elige el archivo, la plataforma muestra qué
 * va a pasar con cada fila y al confirmar crea solo las nuevas.
 */
export const CSV_IMPORT_CYCLE_MS = 11_000;

export type CsvRow = { name: string; result: "new" | "existing" | "error" };

export type CsvImportState = {
  stage: "pick" | "preview" | "done";
  /** Filas del archivo, con lo que pasará con cada una */
  rows: CsvRow[];
  /** Cuántas se crearon (solo en «done») */
  created: number;
};

const ROWS: CsvRow[] = [
  { name: "Ana Ruiz", result: "new" },
  { name: "Luis Márquez", result: "new" },
  { name: "Laura Pérez", result: "existing" },
  { name: "correo sin @", result: "error" },
];

export function csvImportStory(phase: number): CsvImportState {
  if (phase < 0.22) {
    return { stage: "pick", rows: [], created: 0 };
  }
  if (phase < 0.72) {
    return { stage: "preview", rows: ROWS, created: 0 };
  }
  return { stage: "done", rows: ROWS, created: ROWS.filter((r) => r.result === "new").length };
}
