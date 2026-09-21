import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { certificates, courses } from "@/server/db/schema";
import { renderCertificateFor } from "@/server/services/certificates";
import { getFileRecord, absolutePathFor } from "@/server/services/storage";
import fs from "node:fs";

export const runtime = "nodejs";

/**
 * Descarga del certificado por folio. El PDF no vive en disco: se genera al
 * momento desde la copia de la plantilla congelada al emitirlo (~22 ms).
 * Los certificados históricos que aún tengan archivo se sirven desde disco.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ folio: string }> }
) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { folio } = await params;
  const cert = db
    .select()
    .from(certificates)
    .where(eq(certificates.folio, decodeURIComponent(folio)))
    .get();
  if (!cert) return NextResponse.json({ error: "Certificado no encontrado" }, { status: 404 });

  // Permisos: el dueño, el maestro del curso o un administrador
  if (user.role === "student") {
    if (cert.studentId !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }
  } else if (user.role === "teacher") {
    const course = db.select().from(courses).where(eq(courses.id, cert.courseId)).get();
    if (!course || course.ownerId !== user.id) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }
  }

  if (cert.revoked) {
    return NextResponse.json({ error: "Este certificado fue revocado" }, { status: 410 });
  }

  const download = request.nextUrl.searchParams.get("download") !== null;

  // Histórico: si todavía tiene archivo en disco, servirlo tal cual
  if (cert.pdfFileId) {
    const record = getFileRecord(cert.pdfFileId);
    if (record) {
      try {
        const abs = absolutePathFor(record.storedPath);
        if (fs.existsSync(abs)) {
          const bytes = await fs.promises.readFile(abs);
          return pdfResponse(bytes, record.originalName, download);
        }
      } catch {
        /* si la ruta ya no es válida, se regenera abajo */
      }
    }
  }

  const rendered = await renderCertificateFor(cert);
  if (!rendered) {
    return NextResponse.json(
      { error: "No se pudo generar el certificado: falta la plantilla original" },
      { status: 500 }
    );
  }
  return pdfResponse(Buffer.from(rendered.bytes), rendered.fileName, download);
}

function pdfResponse(bytes: Buffer, fileName: string, download: boolean) {
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
