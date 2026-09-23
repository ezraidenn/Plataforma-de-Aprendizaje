import "server-only";
import { nanoid } from "nanoid";
import { obj, requestStructured, visionMessage, withRetry, type AiOpts, type VisionPart } from "./ai-client";

/**
 * Lectura con IA de una lista de cursos (Excel, CSV, Word o PDF): de cada
 * renglón saca el título, la descripción y la vigencia del certificado. Como
 * con los alumnos, la IA solo TRANSCRIBE: nunca inventa cursos.
 */

// ─── Esquema estricto ────────────────────────────────────────────────────────

export const COURSES_SCHEMA = obj({
  courses: {
    type: "array",
    items: obj({
      title: { type: "string" },
      description: { type: "string" },
      validity_months: { type: "number" },
    }),
  },
});

export const COURSES_PROMPT = [
  "Eres un asistente que transcribe listas de cursos de capacitación para darlos de alta en una plataforma. Del texto o las imágenes que recibes, identifica CADA curso de la lista y devuelve:",
  "- title: el nombre del curso tal como aparece, sin el número de fila ni la clave interna, con acentos y sin espacios de más.",
  "- description: la descripción, el objetivo o el temario resumido si la lista lo trae para ese curso; si no hay, cadena vacía.",
  "- validity_months: cuántos meses vale el certificado, si la lista lo indica («vigencia», «validez», «24 meses», «2 años» → 24). Si no se indica, 0.",
  "Reglas:",
  "- Transcribe fielmente: no inventes cursos, descripciones ni vigencias.",
  "- Ignora títulos de la hoja, encabezados, totales, firmas, números de fila, fechas y columnas que no sean nombre del curso, descripción o vigencia (instructor, costo, duración en horas, clave, etc.).",
  "- Una duración en horas NO es una vigencia: en ese caso deja validity_months en 0.",
  "- Si una fila solo trae el título, inclúyela igual con la descripción vacía.",
  "- Si la última fila del texto quedó cortada, omítela.",
].join("\n");

export type CourseDraft = {
  key: string;
  title: string;
  description: string;
  /** null = vitalicio (la lista no indicaba vigencia) */
  validityMonths: number | null;
};

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Respuesta de la IA → borradores normalizados. No es de fiar aunque venga con
 * esquema: se revisa cada campo. Las filas sin título NI descripción se
 * descartan; las que solo traen título llegan a la tabla de revisión.
 */
export function toCourseDrafts(parsed: unknown): CourseDraft[] {
  const list = (parsed as { courses?: unknown } | null)?.courses;
  return (Array.isArray(list) ? (list as Record<string, unknown>[]) : [])
    .filter((c) => !!c && typeof c === "object")
    .map((c) => {
      const months = Number(c.validity_months);
      return {
        key: nanoid(8),
        title: clean(c.title).slice(0, 200),
        description: clean(c.description).slice(0, 1_000),
        validityMonths: Number.isFinite(months) && months > 0 ? Math.round(months) : null,
      };
    })
    .filter((d) => d.title || d.description);
}

function requestCourses(content: Parameters<typeof requestStructured>[0]["content"], opts: AiOpts, timeoutMs: number) {
  return requestStructured(
    { system: COURSES_PROMPT, content, name: "cursos", schema: COURSES_SCHEMA, parse: toCourseDrafts },
    opts,
    timeoutMs
  );
}

/** Un tramo de texto de la lista → cursos. */
export async function interpretCoursesChunk(chunk: string, opts: AiOpts): Promise<CourseDraft[]> {
  return requestCourses(chunk, opts, 120_000);
}

export async function interpretCoursesChunkWithRetry(chunk: string, opts: AiOpts): Promise<CourseDraft[]> {
  return withRetry(() => interpretCoursesChunk(chunk, opts));
}

/** Fotos de la lista (juntas, en orden) o un PDF escaneado → cursos. */
export async function interpretCoursesVision(parts: VisionPart[], opts: AiOpts): Promise<CourseDraft[]> {
  const images = parts.filter((p) => p.kind === "image").length;
  const intro = parts.some((p) => p.kind === "pdf")
    ? "Transcribe la lista de cursos de este PDF escaneado."
    : images === 1
      ? "Transcribe la lista de cursos de esta imagen."
      : `Transcribe la lista de cursos de estas ${images} imágenes, en orden.`;
  return requestCourses(visionMessage(intro, parts), opts, 240_000);
}

export async function interpretCoursesVisionWithRetry(parts: VisionPart[], opts: AiOpts): Promise<CourseDraft[]> {
  return withRetry(() => interpretCoursesVision(parts, opts));
}
