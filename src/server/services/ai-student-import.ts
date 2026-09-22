import "server-only";
import { nanoid } from "nanoid";
import { obj, requestStructured, visionMessage, withRetry, type AiOpts, type VisionPart } from "./ai-client";
import { normalizeStudentEmail, normalizeStudentName, type StudentDraft } from "@/lib/student-draft";

/**
 * «Importar con IA» de estudiantes: de cualquier lista (Excel, CSV, Word, PDF,
 * fotos o PDF escaneados) saca nombre, correo y grupo de cada persona. La IA
 * solo TRANSCRIBE: nunca inventa personas ni correos.
 */

export const ROSTER_CHUNK_CHARS = 8_000;

/**
 * Parte una lista en tramos de ~ROSTER_CHUNK_CHARS por líneas (una fila nunca
 * se corta). Cada tramo que no empieza una hoja lleva el encabezado de su hoja
 * para que la IA sepa qué columna es cuál.
 */
export function splitRosterChunks(text: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  let header = "";
  let expectHeader = true;

  const flush = () => {
    const piece = current.join("\n").trim();
    if (piece) chunks.push(piece);
    current = [];
    size = 0;
  };

  for (const line of text.split("\n")) {
    if (/^#\s*Hoja:/i.test(line)) {
      // Hoja nueva de un Excel: su propio encabezado
      expectHeader = true;
    } else if (expectHeader && line.trim()) {
      header = line;
      expectHeader = false;
    }
    if (size + line.length + 1 > ROSTER_CHUNK_CHARS && current.length > 0) {
      flush();
      if (header && line !== header && !/^#\s*Hoja:/i.test(line)) {
        current.push(`(continúa la lista; encabezado: ${header})`);
        size = header.length + 40;
      }
    }
    current.push(line);
    size += line.length + 1;
  }
  flush();
  return chunks;
}

// ─── Esquema estricto ────────────────────────────────────────────────────────

export const STUDENTS_SCHEMA = obj({
  students: {
    type: "array",
    items: obj({
      fullName: { type: "string" },
      email: { type: "string" },
      group: { type: "string" },
      issues: { type: "array", items: { type: "string" } },
    }),
  },
});

export const STUDENTS_PROMPT = [
  "Eres un asistente que transcribe listas de personas (alumnos, empleados o participantes) para darlas de alta en una plataforma de capacitación. Del texto o las imágenes que recibes, identifica CADA persona de la lista y devuelve:",
  "- fullName: nombre completo como «Nombre(s) Apellido(s)», con mayúscula inicial en cada palabra, respetando acentos y dejando en minúscula partículas como «de», «del», «de la». Si viene como «APELLIDOS, NOMBRE» o en columnas separadas (apellido paterno, materno, nombres), reordénalo a «Nombre Apellidos».",
  "- email: el correo tal como aparece, en minúsculas y sin espacios. NUNCA inventes ni deduzcas un correo: si la persona no tiene correo en el documento, deja el campo vacío y agrega a `issues` «Sin correo en el archivo».",
  "- group: el grupo, generación o turno si la lista lo indica para esa persona (o si toda la lista pertenece a uno, por ejemplo un título «Grupo A — Turno matutino»); si no, cadena vacía.",
  "- issues: notas breves cuando algo es dudoso («Correo ilegible», «Nombre incompleto», «Aparece dos veces»…); si no hay nada, lista vacía.",
  "Reglas:",
  "- Transcribe fielmente: no inventes personas ni datos, y no corrijas letras de los correos.",
  "- Ignora títulos, encabezados, totales, firmas, números de fila, fechas y columnas que no sean nombre, correo o grupo (teléfono, puesto, CURP, número de empleado, etc.).",
  "- Si una fila solo trae el nombre o solo el correo, inclúyela igual y anota el problema en `issues`.",
  "- Si la última fila del texto quedó cortada, omítela.",
  "- Si recibes imágenes o páginas, léelas todas en orden: la lista puede continuar de una a otra.",
].join("\n");

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];

/**
 * Respuesta de la IA → borradores normalizados. No es de fiar aunque venga con
 * esquema: se revisa cada campo. Las filas sin nombre NI correo se descartan.
 */
export function toStudentDrafts(parsed: unknown): StudentDraft[] {
  const list = (parsed as { students?: unknown } | null)?.students;
  return (Array.isArray(list) ? (list as Record<string, unknown>[]) : [])
    .filter((s) => !!s && typeof s === "object")
    .map((s) => ({
      key: nanoid(8),
      fullName: normalizeStudentName(typeof s.fullName === "string" ? s.fullName : ""),
      email: normalizeStudentEmail(typeof s.email === "string" ? s.email : ""),
      group: normalizeStudentName(typeof s.group === "string" ? s.group : "").slice(0, 80),
      issues: asStrings(s.issues),
    }))
    .filter((d) => d.fullName || d.email);
}

function requestStudents(content: Parameters<typeof requestStructured>[0]["content"], opts: AiOpts, timeoutMs: number) {
  return requestStructured(
    { system: STUDENTS_PROMPT, content, name: "estudiantes", schema: STUDENTS_SCHEMA, parse: toStudentDrafts },
    opts,
    timeoutMs
  );
}

/** Un tramo de texto de la lista → estudiantes. */
export async function interpretStudentsChunk(chunk: string, opts: AiOpts): Promise<StudentDraft[]> {
  return requestStudents(chunk, opts, 120_000);
}

export async function interpretStudentsChunkWithRetry(chunk: string, opts: AiOpts): Promise<StudentDraft[]> {
  return withRetry(() => interpretStudentsChunk(chunk, opts));
}

/** Fotos de la lista (juntas, en orden) o un PDF escaneado → estudiantes. */
export async function interpretStudentsVision(parts: VisionPart[], opts: AiOpts): Promise<StudentDraft[]> {
  const images = parts.filter((p) => p.kind === "image").length;
  const intro = parts.some((p) => p.kind === "pdf")
    ? "Transcribe la lista de personas de este PDF escaneado."
    : images === 1
      ? "Transcribe la lista de personas de esta imagen."
      : `Transcribe la lista de personas de estas ${images} imágenes, en orden.`;
  return requestStudents(visionMessage(intro, parts), opts, 240_000);
}

export async function interpretStudentsVisionWithRetry(parts: VisionPart[], opts: AiOpts): Promise<StudentDraft[]> {
  return withRetry(() => interpretStudentsVision(parts, opts));
}
