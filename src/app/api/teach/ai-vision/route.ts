import { NextRequest, NextResponse } from "next/server";
import { apiUser } from "@/server/auth/guards";
import { getAiKey, getAiSettings } from "@/server/services/ai-settings";
import { ownedExamItem } from "@/server/services/exam-access";
import { prepareImage } from "@/server/services/image-prep";
import { pdfPageCount } from "@/server/services/text-extract";
import { interpretVisionWithRetry, type VisionPart } from "@/server/services/ai-exam-import";
import {
  MAX_AI_FILES,
  MAX_AI_FILE_BYTES,
  MAX_SCANNED_PAGES,
  aiFileKind,
  extOf,
  scannedTooLongMessage,
} from "@/lib/ai-import-files";

export const runtime = "nodejs";
// Leer varias imágenes o un PDF escaneado con la IA puede tardar
export const maxDuration = 300;

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * «Importar con IA» con visión: recibe las imágenes (1 a 5, se leen JUNTAS y en
 * orden) o un PDF escaneado, y devuelve los borradores. No guarda nada.
 * Cuerpo: multipart con courseId, itemId y files.
 */
export async function POST(request: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("No autorizado", 401);
  if (user.role !== "teacher" && user.role !== "admin") return fail("No autorizado", 403);
  const key = getAiKey();
  if (!key) return fail("La IA no está configurada. Pide al administrador que agregue la clave de OpenAI.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("No se pudieron leer los archivos enviados.");
  }
  const access = ownedExamItem(user, String(form.get("courseId") ?? ""), String(form.get("itemId") ?? ""));
  if ("error" in access) return fail(access.error, 404);

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return fail("No llegó ningún archivo.");
  if (files.length > MAX_AI_FILES) return fail(`Máximo ${MAX_AI_FILES} archivos.`);
  const big = files.find((f) => f.size > MAX_AI_FILE_BYTES);
  if (big) return fail(`«${big.name}» pasa de 10 MB.`, 413);
  const onePdf = files.length === 1 && extOf(files[0].name) === ".pdf";
  if (!onePdf && !files.every((f) => aiFileKind(f.name) === "image")) {
    return fail("Envía imágenes o un solo PDF escaneado.");
  }

  const parts: VisionPart[] = [];
  try {
    if (onePdf) {
      const pdf = files[0];
      const bytes = Buffer.from(await pdf.arrayBuffer());
      let pages: number;
      try {
        // Copia: pdfjs puede quedarse con el búfer que recibe
        pages = await pdfPageCount(new Uint8Array(bytes));
      } catch {
        return fail(`No se pudo leer el PDF «${pdf.name}».`);
      }
      if (pages > MAX_SCANNED_PAGES) return fail(scannedTooLongMessage(pdf.name, pages));
      parts.push({ kind: "pdf", fileName: pdf.name, dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}` });
    } else {
      for (const f of files) {
        parts.push({ kind: "image", dataUrl: (await prepareImage(Buffer.from(await f.arrayBuffer()), f.name)).dataUrl });
      }
    }
  } catch (err) {
    return fail(err instanceof Error && err.message ? err.message : "No se pudo leer el archivo.");
  }

  try {
    const drafts = await interpretVisionWithRetry(parts, { key, model: getAiSettings().model });
    return NextResponse.json({ drafts });
  } catch (err) {
    return fail(err instanceof Error && err.message ? err.message : "No se pudo interpretar el archivo.", 502);
  }
}
