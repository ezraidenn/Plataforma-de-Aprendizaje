import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { soffice } from "./text-extract";
import { colorFamily, type ColorFamily } from "@/lib/attachment-summary";

/**
 * Hoja de cálculo → filas con su texto y el color con el que está pintada.
 * LibreOffice exporta a HTML poniendo `bgcolor="#RRGGBB"` en cada celda con
 * relleno; de ahí se lee el color, que el CSV pierde. Sirve para «da de baja a
 * los que están en rojo».
 */

export const MAX_SHEET_ROWS = 5_000;

export type SheetRow = { cells: string[]; color: ColorFamily | null };
export type SheetData = { name: string; rows: SheetRow[] };

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nombre de cada hoja tal como lo escribe LibreOffice antes de su tabla:
 * `<A NAME="table0"><h1>Hoja 1: <em>Turno A</em></h1></A>`. En otras versiones
 * el nombre está en el propio atributo `name`; se admiten las dos formas.
 */
function sheetNames(html: string): string[] {
  const names: string[] = [];
  for (const anchor of html.matchAll(/<a\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const attr = decode(anchor[1]);
    if (attr && !/^table\d+$/i.test(attr)) {
      names.push(attr);
      continue;
    }
    const em = /<em>([\s\S]*?)<\/em>/i.exec(anchor[2]);
    // Sin cursiva, el título trae delante «Hoja 1: » (el prefijo va en el idioma de LibreOffice)
    names.push(decode(em ? em[1] : anchor[2]).replace(/^[^:]*\d+\s*:\s*/, ""));
  }
  return names;
}

export async function readSheetRows(bytes: Buffer, fileName: string): Promise<SheetData[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lms-hoja-"));
  try {
    const ext = path.extname(fileName).toLowerCase() || ".xlsx";
    const input = path.join(dir, `archivo${ext}`);
    await fs.writeFile(input, bytes);
    const outs = (await soffice(input, "html", dir)).filter((f) => f.toLowerCase().endsWith(".html"));
    if (outs.length === 0) return [];
    const html = await fs.readFile(outs[0], "utf8");

    const names = sheetNames(html);
    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
    return tables.map((table, i) => {
      const rows: SheetRow[] = [];
      for (const tr of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
        if (rows.length >= MAX_SHEET_ROWS) break;
        const cells: string[] = [];
        let color: ColorFamily | null = null;
        for (const td of tr[0].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
          cells.push(decode(td[2]));
          if (!color) {
            const bg = /bgcolor="([^"]+)"/i.exec(td[1]);
            if (bg) color = colorFamily(bg[1]);
          }
        }
        // Filas totalmente vacías: la hoja suele traer muchas al final
        if (cells.some((c) => c !== "")) rows.push({ cells, color });
      }
      return { name: names[i] || `Hoja ${i + 1}`, rows };
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
