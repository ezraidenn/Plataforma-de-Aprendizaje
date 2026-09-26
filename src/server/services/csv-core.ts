import "server-only";
import { normalizeHeader } from "@/lib/excel-formats";

/**
 * Núcleo CSV compartido por todas las operaciones masivas.
 * Formato: UTF-8 con BOM (Excel lo abre con acentos correctos), separador
 * coma o punto y coma (Excel en español exporta con ";"), comillas dobles.
 */

export const BOM = "﻿";

export function csvEscape(value: string | number | boolean | null | undefined): string {
  const s =
    typeof value === "boolean" ? (value ? "SI" : "NO") : String(value ?? "");
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(csvEscape).join(",");
}

/**
 * Lo único que puede ir antes de la comilla que abre una celda: espacios y
 * tabuladores. El mismo criterio en `parseCsvLine` y en `csvRecords`: si no,
 * uno juntaría renglones que el otro lee como celdas separadas.
 */
const isFieldPad = (ch: string) => ch === " " || ch === "\t";

/**
 * Parsea un registro respetando comillas (RFC 4180, como Excel): una comilla
 * solo abre una celda entre comillas al principio del campo (sin contar los
 * espacios y tabuladores: `isFieldPad`); dentro, `""` es una comilla; en medio
 * de un campo sin comillas (`1/2"`) o tras cerrar las comillas es texto, igual
 * que en `csvRecords`.
 */
export function parseCsvLine(line: string, sep: "," | ";"): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  let atStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
        atStart = false;
      } else current += ch;
    } else if (ch === '"' && atStart) inQuotes = true;
    else if (ch === sep) {
      out.push(current);
      current = "";
      atStart = true;
    } else {
      current += ch;
      if (!isFieldPad(ch)) atStart = false;
    }
  }
  out.push(current);
  return out.map((s) => s.trim());
}

export function detectSeparator(headerLine: string): "," | ";" {
  // Excel-ES usa ';'. Cuenta fuera de comillas.
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ",") commas++;
    else if (!inQuotes && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

/**
 * Los registros del CSV, sin los renglones vacíos. Una celda entre comillas
 * puede ocupar varios renglones (Excel la guarda así cuando tiene saltos de
 * línea): sus renglones van juntos, líneas en blanco incluidas, en un solo
 * registro. Como en Excel (RFC 4180), una comilla solo abre esa celda al
 * principio de un campo; en medio de uno sin comillas (`1/2"`) es texto y no
 * junta nada. Si al final quedan comillas sin cerrar (un archivo mal hecho),
 * esos renglones se vuelven a leer uno por uno, como si no hubiera celdas de
 * varias líneas, para no tragarse el resto del archivo.
 *
 * Lo usan `parseCsv` y quien necesite rehacer un CSV con algunas de sus filas
 * (el registro i es la fila i + 1, la cabecera incluida).
 */
export function csvRecords(text: string): string[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  // El separador es el de la cabecera (el primer renglón con algo)
  const sep = detectSeparator(lines.find((l) => l.trim().length > 0) ?? "");
  const records: string[] = [];
  let open: string[] = [];
  let inQuotes = false;
  for (const line of lines) {
    if (open.length === 0 && line.trim().length === 0) continue;
    open.push(line);
    inQuotes = quotedAtEnd(line, sep, inQuotes);
    if (!inQuotes) {
      records.push(open.join("\n"));
      open = [];
    }
  }
  for (const line of open) if (line.trim().length > 0) records.push(line);
  return records;
}

/** ¿Sigue abierta una celda entre comillas al terminar este renglón? `inQuotes`: si ya venía abierta del anterior. */
function quotedAtEnd(line: string, sep: "," | ";", inQuotes: boolean): boolean {
  // Al empezar un renglón fuera de comillas empieza también un campo
  let atStart = !inQuotes;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') i++;
        else {
          inQuotes = false;
          atStart = false;
        }
      }
    } else if (ch === '"' && atStart) inQuotes = true;
    else if (ch === sep) atStart = true;
    else if (!isFieldPad(ch)) atStart = false;
  }
  return inQuotes;
}

export type ParsedCsv = {
  /** Encabezados normalizados (minúsculas, sin acentos, _ por espacios) */
  headers: string[];
  /** `line`: número de fila (la cabecera es la 1), contando registros: una celda de varias líneas es una sola fila, como en Excel */
  rows: { line: number; cells: string[] }[];
  sep: "," | ";";
};

// La regla de normalizar encabezados vive en `@/lib/excel-formats`, que también
// reconoce por ellos qué formato es un archivo: tiene que ser la MISMA o un
// archivo reconocido no se podría leer aquí.
export { normalizeHeader };

export function parseCsv(text: string, opts: { maxRows: number }): ParsedCsv {
  const records = csvRecords(text);
  if (records.length === 0) throw new Error("El archivo está vacío");
  if (records.length > opts.maxRows + 1) {
    throw new Error(`Máximo ${opts.maxRows} filas por archivo`);
  }
  const sep = detectSeparator(records[0]);
  const headers = parseCsvLine(records[0], sep).map(normalizeHeader);
  const rows = records.slice(1).map((record, i) => ({
    line: i + 2,
    cells: parseCsvLine(record, sep),
  }));
  return { headers, rows, sep };
}

/** Acceso por nombre de columna con alias. */
export function columnGetter(headers: string[], aliases: Record<string, string[]>) {
  const index = new Map<string, number>();
  for (const [canonical, names] of Object.entries(aliases)) {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i >= 0) {
        index.set(canonical, i);
        break;
      }
    }
  }
  return {
    has: (canonical: string) => index.has(canonical),
    get: (cells: string[], canonical: string): string => {
      const i = index.get(canonical);
      return i === undefined ? "" : (cells[i] ?? "");
    },
  };
}

export function parseBoolEs(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (["si", "sí", "s", "1", "true", "x"].includes(v)) return true;
  if (["no", "n", "0", "false", ""].includes(v)) return false;
  return null;
}
