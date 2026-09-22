import { NextRequest, NextResponse } from "next/server";
import { apiUser } from "@/server/auth/guards";
import { getAiSettings } from "@/server/services/ai-settings";
import { ScannedPdfError, extractText } from "@/server/services/text-extract";
import { splitIntoChunks } from "@/server/services/ai-exam-import";
import { splitRosterChunks } from "@/server/services/ai-student-import";

export const runtime = "nodejs";
// Convertir un Word o un Excel con LibreOffice puede tardar
export const maxDuration = 300;

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * «Importar con IA», paso 1: recibe el archivo del maestro, extrae su texto y
 * lo devuelve partido en tramos. No guarda nada: el archivo vive solo en
 * memoria y en una carpeta temporal que se borra al terminar.
 * Encabezado: X-File-Name (codificado como URI). Cuerpo: el archivo.
 * `?para=estudiantes`: tramos por filas de una lista, no por preguntas.
 */
export async function POST(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!getAiSettings().configured) {
    return NextResponse.json({ error: "La IA no está configurada. Pide al administrador que agregue la clave de OpenAI." }, { status: 400 });
  }

  const rawName = request.headers.get("x-file-name");
  if (!rawName) return NextResponse.json({ error: "Falta el nombre del archivo" }, { status: 400 });
  const fileName = decodeURIComponent(rawName);

  const declared = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo pasa de 10 MB" }, { status: 413 });
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo pasa de 10 MB" }, { status: 413 });
  }
  if (bytes.length === 0) return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });

  try {
    const { text, format, chars } = await extractText(bytes, fileName);
    const forStudents = request.nextUrl.searchParams.get("para") === "estudiantes";
    const chunks = forStudents ? splitRosterChunks(text) : splitIntoChunks(text);
    return NextResponse.json({ chunks, chars, format });
  } catch (err) {
    if (err instanceof ScannedPdfError) {
      // No es un error: el diálogo lo manda a /api/teach/ai-vision
      return NextResponse.json({ scanned: true, pages: err.pages, format: "pdf" });
    }
    const message = err instanceof Error && err.message ? err.message : "No se pudo leer el archivo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
