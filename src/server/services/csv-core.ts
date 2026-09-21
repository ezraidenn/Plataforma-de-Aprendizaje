import "server-only";

/**
 * Núcleo CSV compartido por todas las operaciones masivas.
 * Formato: UTF-8 con BOM (Excel lo abre con acentos correctos), separador
 * coma o punto y coma (Excel en español exporta con ";"), comillas dobles.
 */

export const BOM = "﻿";

export function csvEscape(value: string | number | boolean | null | undefined): string {
  const s =
    typeof value === "boolean" ? (value ? "SI" : "NO") : String(value ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(csvEscape).join(",");
}

/** Parsea una línea respetando comillas; detecta separador , o ; */
export function parseCsvLine(line: string, sep: "," | ";"): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      out.push(current);
      current = "";
    } else current += ch;
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

export type ParsedCsv = {
  /** Encabezados normalizados (minúsculas, sin acentos, _ por espacios) */
  headers: string[];
  rows: { line: number; cells: string[] }[];
  sep: "," | ";";
};

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function parseCsv(text: string, opts: { maxRows: number }): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("El archivo está vacío");
  if (lines.length > opts.maxRows + 1) {
    throw new Error(`Máximo ${opts.maxRows} filas por archivo`);
  }
  const sep = detectSeparator(lines[0]);
  const headers = parseCsvLine(lines[0], sep).map(normalizeHeader);
  const rows = lines.slice(1).map((line, i) => ({
    line: i + 2,
    cells: parseCsvLine(line, sep),
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
