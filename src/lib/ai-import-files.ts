/**
 * Reglas de «Importar con IA» para elegir archivos: límites, tipos y mensajes.
 * Puro: lo usan el diálogo (al elegir) y el servidor (al recibir).
 */

export const MAX_AI_FILES = 5;
export const MAX_AI_FILE_BYTES = 10 * 1024 * 1024;
/** Páginas máximas de un PDF escaneado (se lee como imagen: cuida tiempo y costo). */
export const MAX_SCANNED_PAGES = 20;

/** Con texto: se extrae en el servidor y va por tramos. */
export const AI_DOC_EXTS = [
  ".docx",
  ".doc",
  ".odt",
  ".rtf",
  ".xlsx",
  ".xls",
  ".ods",
  ".csv",
  ".pdf",
  ".pptx",
  ".ppt",
  ".odp",
  ".txt",
  ".md",
];
/** Las que acepta la visión de OpenAI (PNG, JPEG, WEBP y GIF sin animación). */
export const AI_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
/** Fotos de iPhone: se aceptan en el selector solo para explicar qué hacer. */
const HEIC_EXTS = [".heic", ".heif"];

export const AI_ACCEPT = [...AI_DOC_EXTS, ...AI_IMAGE_EXTS, ...HEIC_EXTS].join(",");

export type AiFileKind = "doc" | "image";

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function aiFileKind(name: string): AiFileKind | null {
  const ext = extOf(name);
  if (AI_DOC_EXTS.includes(ext)) return "doc";
  if (AI_IMAGE_EXTS.includes(ext)) return "image";
  return null;
}

export const heicMessage = (name: string) => `La foto «${name}» está en HEIC: guárdala como JPG o PNG.`;

/** Extensión por tipo MIME para lo que llega del portapapeles. */
const PASTE_EXTS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const two = (n: number) => String(n).padStart(2, "0");

/**
 * Nombre para una imagen pegada con Ctrl+V: el navegador la entrega como
 * «image.png» o sin nombre, y así se distingue una captura de otra en la lista
 * de adjuntos. La extensión sale del tipo MIME (PNG si no se reconoce).
 */
export function nombreDePegado(type: string, now: Date): string {
  const ext = PASTE_EXTS[type.toLowerCase().split(";")[0].trim()] ?? ".png";
  const fecha = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return `captura-${fecha}-${two(now.getHours())}${two(now.getMinutes())}${ext}`;
}

export const scannedTooLongMessage = (name: string, pages: number) =>
  `El PDF escaneado «${name}» tiene ${pages} páginas; el máximo es ${MAX_SCANNED_PAGES}. Divídelo en partes.`;

/**
 * Agrega a la lista lo que se eligió o arrastró. Lo que no entra se explica en
 * `rejected`; un archivo repetido (mismo nombre y tamaño) se ignora sin aviso.
 */
export function addAiFiles<T extends { name: string; size: number }>(
  current: T[],
  incoming: T[]
): { files: T[]; rejected: string[] } {
  const files = [...current];
  const rejected: string[] = [];
  for (const f of incoming) {
    if (HEIC_EXTS.includes(extOf(f.name))) {
      rejected.push(heicMessage(f.name));
      continue;
    }
    if (!aiFileKind(f.name)) {
      rejected.push(`«${f.name}»: formato no admitido.`);
      continue;
    }
    if (f.size > MAX_AI_FILE_BYTES) {
      rejected.push(`«${f.name}» pasa de 10 MB.`);
      continue;
    }
    if (f.size === 0) {
      rejected.push(`«${f.name}» está vacío.`);
      continue;
    }
    if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (files.length >= MAX_AI_FILES) {
      rejected.push(`Máximo ${MAX_AI_FILES} archivos: se omitió «${f.name}».`);
      continue;
    }
    files.push(f);
  }
  return { files, rejected };
}
