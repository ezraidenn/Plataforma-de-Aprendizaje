import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
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

/**
 * HTML de una celda → su texto. Con `lineBreaks`, los renglones de la celda
 * (LibreOffice los escribe como `<br>`, uno por párrafo; una línea en blanco
 * son dos) vuelven como «\n» y solo se juntan los espacios de cada renglón;
 * sin él, todo queda en una línea, con un espacio entre renglón y renglón (lo
 * que esperan las listas de alumnos, los resúmenes, etc.). Los saltos del
 * propio código HTML siempre son espacios.
 */
function decode(html: string, lineBreaks = false): string {
  const marked = html
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>|<\/p>\s*<p\b[^>]*>/gi, lineBreaks ? "\n" : " ");
  const text = marked
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
  return lineBreaks
    ? text
        .replace(/[^\S\n]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .trim()
    : text.replace(/\s+/g, " ").trim();
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

/**
 * Una entrada de un ZIP, sin dependencias: se busca en el directorio central y
 * se descomprime. xlsx y ods son ZIP; solo se saca un XML pequeño.
 */
function zipEntry(zip: Buffer, wanted: string): string | null {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const compSize = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const offset = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLen) === wanted) {
      // El encabezado local repite el nombre y los extras, con otros tamaños
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      const data = zip.subarray(start, start + compSize);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8");
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/**
 * Nombres de las hojas leídos del propio archivo. Hace falta porque LibreOffice
 * solo los escribe en el HTML cuando hay más de una hoja: una lista de una sola
 * hoja perdía su nombre («Matutino») y la IA veía un «Hoja 1» inventado.
 * Solo sirve para los formatos que son ZIP (xlsx y ods); lo demás vuelve vacío.
 */
function namesFromFile(bytes: Buffer, fileName: string): string[] {
  try {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".xlsx" || ext === ".xlsm") {
      const xml = zipEntry(bytes, "xl/workbook.xml");
      // Solo dentro de <sheets>: fuera hay otras etiquetas que empiezan igual
      const block = xml ? /<sheets>([\s\S]*?)<\/sheets>/i.exec(xml) : null;
      return block ? [...block[1].matchAll(/<sheet\b[^>]*\bname="([^"]*)"/gi)].map((m) => decode(m[1])) : [];
    }
    if (ext === ".ods") {
      const xml = zipEntry(bytes, "content.xml");
      return xml ? [...xml.matchAll(/<table:table\b[^>]*\btable:name="([^"]*)"/gi)].map((m) => decode(m[1])) : [];
    }
    return [];
  } catch {
    // Un ZIP raro o partido: se sigue con lo que diga el HTML
    return [];
  }
}

/**
 * `lineBreaks`: conservar los renglones de cada celda («\n»). Solo lo pide
 * quien los necesita (las preguntas de examen: un texto de completar con
 * párrafos); lo demás sigue recibiendo cada celda en una sola línea.
 */
export async function readSheetRows(bytes: Buffer, fileName: string, opts: { lineBreaks?: boolean } = {}): Promise<SheetData[]> {
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
    // Los del archivo solo se usan si hay uno por tabla: así no se descoloca
    // ninguna hoja (una oculta puede estar en el archivo y no en el HTML)
    const fromFile = namesFromFile(bytes, fileName);
    const real = fromFile.length === tables.length ? fromFile : [];
    return tables.map((table, i) => {
      const rows: SheetRow[] = [];
      for (const tr of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
        if (rows.length >= MAX_SHEET_ROWS) break;
        const cells: string[] = [];
        let color: ColorFamily | null = null;
        for (const td of tr[0].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
          cells.push(decode(td[2], opts.lineBreaks));
          if (!color) {
            const bg = /bgcolor="([^"]+)"/i.exec(td[1]);
            if (bg) color = colorFamily(bg[1]);
          }
        }
        // Filas totalmente vacías: la hoja suele traer muchas al final
        if (cells.some((c) => c !== "")) rows.push({ cells, color });
      }
      return { name: names[i] || real[i] || `Hoja ${i + 1}`, rows };
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
