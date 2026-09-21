import "server-only";
import sharp from "sharp";
import { AI_IMAGE_EXTS, extOf, heicMessage } from "@/lib/ai-import-files";

/** Lado máximo de lo que se manda a OpenAI: suficiente para leer letra de examen. */
export const MAX_IMAGE_SIDE = 2048;

export type PreparedImage = { dataUrl: string; width: number; height: number };

/**
 * Foto o captura → JPEG listo para la visión de OpenAI: derecha (según EXIF),
 * de hasta 2048 px por lado (sin agrandar), fondo blanco si era transparente y
 * sin metadatos (sharp no los copia si no se le pide). Un GIF animado se lee
 * en su primer cuadro.
 */
export async function prepareImage(bytes: Buffer, fileName: string): Promise<PreparedImage> {
  const ext = extOf(fileName);
  if (ext === ".heic" || ext === ".heif") throw new Error(heicMessage(fileName));
  if (!AI_IMAGE_EXTS.includes(ext)) throw new Error(`«${fileName}» no es una imagen admitida (JPG, PNG, WEBP o GIF).`);
  try {
    const { data, info } = await sharp(bytes, { pages: 1, limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { dataUrl: `data:image/jpeg;base64,${data.toString("base64")}`, width: info.width, height: info.height };
  } catch {
    throw new Error(`No se pudo leer la imagen «${fileName}». Revisa que no esté dañada.`);
  }
}
