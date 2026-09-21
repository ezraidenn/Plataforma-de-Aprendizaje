/**
 * Documento del maestro: sube un PowerPoint, la plataforma lo convierte a PDF
 * y queda listo con sus páginas.
 */
export const DOC_CONVERT_CYCLE_MS = 10_000;

export type DocConvertState = {
  stage: "empty" | "uploading" | "converting" | "ready";
  /** Avance de la subida (0–1) */
  progress: number;
  fileName: string;
  /** Páginas del PDF resultante (0 mientras no está listo) */
  pages: number;
};

const FILE = "NOM-002-extintores.pptx";
const PAGES = 12;

export function docConvertStory(phase: number): DocConvertState {
  if (phase < 0.15) {
    return { stage: "empty", progress: 0, fileName: "", pages: 0 };
  }
  if (phase < 0.42) {
    const progress = (phase - 0.15) / (0.42 - 0.15);
    return { stage: "uploading", progress, fileName: FILE, pages: 0 };
  }
  if (phase < 0.72) {
    return { stage: "converting", progress: 1, fileName: FILE, pages: 0 };
  }
  return { stage: "ready", progress: 1, fileName: FILE.replace(".pptx", ".pdf"), pages: PAGES };
}
