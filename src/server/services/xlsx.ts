import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { soffice } from "./text-extract";

/**
 * Excel con formato (colores, negritas, porcentajes y fechas de verdad) sin
 * añadir ninguna librería.
 *
 * El rodeo: aquí se escribe un FODS —una hoja de cálculo en XML plano, un solo
 * archivo de texto— y LibreOffice, que ya es requisito del servidor (convierte
 * los PowerPoint de los cursos y lee los adjuntos), lo pasa a .xlsx
 * conservando estilos y tipos. Escribir un .xlsx a mano obligaría a armar un
 * ZIP con media docena de XML y su tabla de estilos; escribir un CSV perdería
 * los colores y convertiría los porcentajes en texto.
 *
 * Los colores no son decorativos: son los que `sheet-colors.ts` sabe volver a
 * leer (rojo, verde), así que un Excel generado aquí se puede devolver al
 * asistente y pedirle «da de baja a los que están en rojo».
 */

export type CellStyle = "header" | "normal" | "bad" | "good" | "muted";

export type Cell = {
  text: string;
  style?: CellStyle;
  /** Número de verdad (no texto) */
  number?: number;
  /** 0–1: se escribe como porcentaje con formato */
  percent?: number;
  date?: Date;
};

export type SheetSpec = {
  name: string;
  columns: { title: string; width?: number }[];
  rows: Cell[][];
  /** Líneas de ayuda: van en una hoja «Notas» aparte */
  notes?: string[];
};

/** Ancho de columna en centímetros. */
const DEFAULT_WIDTH = 4;
const MAX_WIDTH = 15;
/** Excel no admite nombres de hoja más largos. */
const MAX_SHEET_NAME = 31;

const FAIL = "No se pudo generar el Excel. Descarga el CSV.";

/**
 * Relleno y letra de cada estilo. Los tonos de `bad` y `good` son subidos de
 * tono a propósito: `colorFamily()` (src/lib/attachment-summary.ts) descarta
 * los pasteles muy claros como «fondo de la hoja», y estos tienen que volver
 * a leerse como rojo y verde.
 */
const CELL_STYLES: Record<CellStyle, string> = {
  header:
    '<style:table-cell-properties fo:background-color="#312e81"/><style:text-properties fo:font-weight="bold" fo:color="#ffffff"/>',
  bad: '<style:table-cell-properties fo:background-color="#ff9494"/><style:text-properties fo:color="#7f1d1d" fo:font-weight="bold"/>',
  good: '<style:table-cell-properties fo:background-color="#bbf7d0"/><style:text-properties fo:color="#166534"/>',
  muted: '<style:text-properties fo:color="#64748b" fo:font-style="italic"/>',
  normal: "",
};

/** Formato de número que puede llevar una celda además de su estilo. */
type Format = "" | "pct" | "fecha";

const STYLE_NAMES = Object.keys(CELL_STYLES) as CellStyle[];
const FORMATS: Format[] = ["", "pct", "fecha"];

const cellStyleName = (style: CellStyle, format: Format) => `ce-${style}${format ? `-${format}` : ""}`;
const colStyleName = (widthCm: number) => `co${Math.round(widthCm * 10)}`;

/** Texto listo para el XML: sin caracteres de control y con `&<>"` escapados. */
function esc(raw: string): string {
  return (raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Número para `office:value`: sin notación exponencial ni ceros de relleno. */
function num(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** Fecha como la ve quien la escribió (hora local), en formato ISO. */
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clampWidth(width?: number): number {
  const n = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH;
  return Math.round(Math.min(MAX_WIDTH, Math.max(1, n)) * 10) / 10;
}

/**
 * Nombre de hoja válido: sin los caracteres que Excel prohíbe, máximo 31 y
 * sin repetirse (el repetido lleva un número al final).
 */
function sheetName(raw: string, used: Set<string>): string {
  let base = (raw ?? "")
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/[\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^'+|'+$/g, "")
    .trim();
  if (!base) base = "Hoja";
  if (base.length > MAX_SHEET_NAME) base = base.slice(0, MAX_SHEET_NAME).trim();

  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n++}`;
    name = `${base.slice(0, MAX_SHEET_NAME - suffix.length).trim()}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

function cellXml(cell: Cell): string {
  const style = cell.style ?? "normal";
  const text = esc(cell.text ?? "");
  // Un párrafo por renglón (dentro de un párrafo, un salto de línea es solo un
  // espacio): así una celda de varias líneas vuelve igual, líneas en blanco incluidas
  const p = text
    ? (cell.text ?? "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => (line ? `<text:p>${esc(line)}</text:p>` : "<text:p/>"))
        .join("")
    : "";

  let format: Format = "";
  let value = "";
  if (typeof cell.percent === "number" && Number.isFinite(cell.percent)) {
    format = "pct";
    value = ` office:value-type="percentage" office:value="${num(cell.percent)}"`;
  } else if (typeof cell.number === "number" && Number.isFinite(cell.number)) {
    value = ` office:value-type="float" office:value="${num(cell.number)}"`;
  } else if (cell.date instanceof Date && !Number.isNaN(cell.date.getTime())) {
    format = "fecha";
    value = ` office:value-type="date" office:date-value="${isoDate(cell.date)}"`;
  } else if (text) {
    value = ' office:value-type="string"';
  }

  const name = cellStyleName(style, format);
  // Una celda vacía y sin estilo no necesita nada
  if (!value && style === "normal") return "<table:table-cell/>";
  return `<table:table-cell table:style-name="${name}"${value}>${p}</table:table-cell>`;
}

function rowXml(cells: Cell[]): string {
  return `<table:table-row>${cells.map(cellXml).join("")}</table:table-row>`;
}

/** Una hoja: sus columnas, el encabezado y las filas de datos. */
function tableXml(name: string, widths: number[], header: Cell[], rows: Cell[][]): string {
  const cols = widths.map((w) => `<table:table-column table:style-name="${colStyleName(w)}"/>`).join("");
  const body = [rowXml(header), ...rows.map(rowXml)].join("");
  return `<table:table table:name="${esc(name)}">${cols}${body}</table:table>`;
}

function documentXml(sheets: SheetSpec[]): string {
  const used = new Set<string>();
  const widths = new Set<number>();
  const tables: string[] = [];

  for (const sheet of sheets) {
    const sheetWidths = sheet.columns.map((c) => clampWidth(c.width));
    for (const w of sheetWidths) widths.add(w);
    const name = sheetName(sheet.name, used);
    const header = sheet.columns.map((c): Cell => ({ text: c.title, style: "header" }));
    tables.push(tableXml(name, sheetWidths, header, sheet.rows));

    if (sheet.notes?.length) {
      const wide = clampWidth(MAX_WIDTH);
      widths.add(wide);
      // El nombre de la hoja de notas también se recorta a 31 caracteres
      const notesName = sheetName(`${name.slice(0, MAX_SHEET_NAME - " — Notas".length).trim()} — Notas`, used);
      const lines = sheet.notes.map((n): Cell[] => [{ text: n, style: "muted" }]);
      tables.push(
        `<table:table table:name="${esc(notesName)}"><table:table-column table:style-name="${colStyleName(wide)}"/>${lines
          .map(rowXml)
          .join("")}</table:table>`
      );
    }
  }

  const colStyles = [...widths]
    .map(
      (w) =>
        `<style:style style:name="${colStyleName(w)}" style:family="table-column"><style:table-column-properties style:column-width="${w}cm"/></style:style>`
    )
    .join("");

  const cellStyles = STYLE_NAMES.flatMap((style) =>
    FORMATS.map((format) => {
      const data = format ? ` style:data-style-name="N-${format}"` : "";
      return `<style:style style:name="${cellStyleName(style, format)}" style:family="table-cell"${data}>${CELL_STYLES[style]}</style:style>`;
    })
  ).join("");

  const dataStyles =
    '<number:percentage-style style:name="N-pct"><number:number number:decimal-places="0" number:min-integer-digits="1"/><number:text>%</number:text></number:percentage-style>' +
    '<number:date-style style:name="N-fecha"><number:day number:style="long"/><number:text>/</number:text><number:month number:style="long"/><number:text>/</number:text><number:year number:style="long"/></number:date-style>';

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
    ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
    ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"' +
    ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"' +
    ' xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"' +
    ' office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">' +
    `<office:automatic-styles>${colStyles}${cellStyles}${dataStyles}</office:automatic-styles>` +
    `<office:body><office:spreadsheet>${tables.join("")}</office:spreadsheet></office:body></office:document>`
  );
}

/**
 * Hojas → bytes de un .xlsx con formato. Todo pasa por una carpeta temporal
 * que se borra siempre. Si no hay LibreOffice (o la conversión falla) lanza
 * `No se pudo generar el Excel. Descarga el CSV.`: quien llama ofrece el CSV.
 */
export async function buildXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  if (sheets.length === 0) throw new Error(FAIL);
  const xml = documentXml(sheets);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lms-xlsx-"));
  try {
    const input = path.join(dir, "datos.fods");
    await fs.writeFile(input, xml, "utf8");
    const outs = (await soffice(input, "xlsx", dir)).filter((f) => f.toLowerCase().endsWith(".xlsx"));
    if (outs.length === 0) throw new Error(FAIL);
    return await fs.readFile(outs[0]);
  } catch {
    // `soffice()` explica el fallo de leer archivos ajenos; aquí el que manda
    // es el nuestro, que además dice qué hacer en su lugar
    throw new Error(FAIL);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
