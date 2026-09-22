import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Archivo → texto, para que la IA lo interprete. Nada se guarda: todo ocurre
 * en una carpeta temporal que se borra al terminar. Sin paquetes nuevos: PDF
 * con pdfjs-dist (ya instalado) y Word/Excel/PowerPoint con LibreOffice (el
 * mismo que convierte los PowerPoint de los cursos).
 */

const execFileAsync = promisify(execFile);

export type ExtractFormat = "pdf" | "word" | "sheet" | "slides" | "text";
export type Extracted = { text: string; format: ExtractFormat; chars: number };

/** ~30 páginas de texto: más que eso se pide dividir el archivo. */
export const MAX_EXTRACT_CHARS = 60_000;

const FORMATS: Record<string, ExtractFormat> = {
  ".pdf": "pdf",
  ".docx": "word",
  ".doc": "word",
  ".odt": "word",
  ".rtf": "word",
  ".xlsx": "sheet",
  ".xls": "sheet",
  ".ods": "sheet",
  ".pptx": "slides",
  ".ppt": "slides",
  ".odp": "slides",
  ".csv": "text",
  ".txt": "text",
  ".md": "text",
};

/** Formato según la extensión, o null si no se admite. */
export function formatOf(fileName: string): ExtractFormat | null {
  return FORMATS[path.extname(fileName).toLowerCase()] ?? null;
}

/** Un PDF sin texto útil: parece escaneado. El diálogo lo manda a la visión de la IA. */
export class ScannedPdfError extends Error {
  constructor(public readonly pages: number) {
    super("El PDF no tiene texto: parece escaneado.");
  }
}

async function openPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Dentro del servidor de Next el paquete va empaquetado y buscaría su worker
  // junto al código compilado: se le da la ruta real en node_modules.
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
  ).href;
  return pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    // Datos de las fuentes estándar (Helvetica, Times…) que trae el paquete
    standardFontDataUrl: standardFontsDir(),
  });
}

/** Número de páginas de un PDF. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const task = await openPdf(bytes);
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const task = await openPdf(bytes);
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        } else if (item.str && !item.str.endsWith(" ")) {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line);
      pages.push(lines.map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n"));
    }
    return { text: pages.join("\n\n"), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/**
 * Carpeta de fuentes estándar de pdfjs-dist. pdfjs exige barras «/» y barra
 * final aun en Windows (Node abre «C:/…/» sin problema).
 */
function standardFontsDir(): string {
  return path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts").replace(/\\/g, "/") + "/";
}

/** Convierte con LibreOffice y devuelve las rutas de salida generadas. */
export async function soffice(input: string, filter: string, outDir: string): Promise<string[]> {
  const bin = process.env.SOFFICE_PATH ?? "soffice";
  try {
    await execFileAsync(bin, ["--headless", "--norestore", "--convert-to", filter, "--outdir", outDir, input], {
      timeout: 120_000,
      windowsHide: true,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("LibreOffice no está instalado en el servidor. Sube el archivo como PDF o CSV.");
    }
    throw new Error("No se pudo leer el archivo. Revisa que no esté dañado ni protegido con contraseña.");
  }
  const base = path.basename(input, path.extname(input));
  return (await fs.readdir(outDir))
    .filter((f) => f.startsWith(base) && f !== path.basename(input))
    .sort()
    .map((f) => path.join(outDir, f));
}

/** Texto plano: UTF-8, y si trae caracteres rotos, Latin-1 (CSV guardados desde Excel). */
function plainText(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8").replace(/^\uFEFF/, "");
  return utf8.includes("\uFFFD") ? bytes.toString("latin1") : utf8;
}

/** Caracteres que cuentan como texto (sin espacios ni separadores de tablas). */
const usefulChars = (text: string) => text.replace(/[\s,;|"]/g, "").length;

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(bytes: Buffer, fileName: string): Promise<Extracted> {
  const format = formatOf(fileName);
  if (!format) throw new Error("Formato no admitido. Sube Word, Excel, CSV, PDF, PowerPoint o texto.");

  let raw = "";
  if (format === "text") {
    raw = plainText(bytes);
  } else if (format === "pdf") {
    const pdf = await pdfText(new Uint8Array(bytes));
    // Sin texto útil: es un escaneo. Lo decide quien llama (la IA lo lee como imagen)
    if (usefulChars(normalize(pdf.text)) < 20) throw new ScannedPdfError(pdf.pages);
    raw = pdf.text;
  } else {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lms-ia-"));
    try {
      const ext = path.extname(fileName).toLowerCase();
      const input = path.join(dir, `archivo${ext}`);
      await fs.writeFile(input, bytes);
      if (format === "word") {
        const [out] = await soffice(input, "txt:Text (encoded):UTF8", dir);
        raw = out ? plainText(await fs.readFile(out)) : "";
      } else if (format === "sheet") {
        // El último campo (-1) pide TODAS las hojas, un CSV por hoja
        const outs = (
          await soffice(input, "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1", dir)
        ).filter((f) => f.endsWith(".csv"));
        const parts: string[] = [];
        for (const out of outs) {
          const sheet = path.basename(out, ".csv").replace(/^archivo-?/, "");
          const body = plainText(await fs.readFile(out));
          parts.push(outs.length > 1 && sheet ? `# Hoja: ${sheet}\n${body}` : body);
        }
        raw = parts.join("\n\n");
      } else {
        const [out] = (await soffice(input, "pdf", dir)).filter((f) => f.endsWith(".pdf"));
        raw = out ? (await pdfText(new Uint8Array(await fs.readFile(out)))).text : "";
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  const text = normalize(raw);
  if (usefulChars(text) < 20) throw new Error("No encontré texto en el archivo.");
  if (text.length > MAX_EXTRACT_CHARS) {
    throw new Error("El archivo es muy largo (más de unas 30 páginas de texto). Divídelo en partes.");
  }
  return { text, format, chars: text.length };
}
