import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { eq, and, desc } from "drizzle-orm";
import { apiUser } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { scopeOwnerId } from "@/server/auth/view-scope";
import { db } from "@/server/db";
import { certificates, courses, users } from "@/server/db/schema";
import { getFileRecord, absolutePathFor } from "@/server/services/storage";
import { renderCertificateFor } from "@/server/services/certificates";
import { audit } from "@/server/services/audit";

export const runtime = "nodejs";

function safeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 _-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/**
 * GET /api/certificates/zip?courseId=...   → ZIP con los certificados del curso
 * GET /api/certificates/zip?studentId=...  → ZIP con los certificados de UN
 *                                            estudiante (portafolio físico)
 * GET /api/certificates/zip                → ZIP con TODOS mis certificados
 * Maestro: sus cursos. Admin: los del contexto de vista elegido. Streaming: no carga todo en memoria.
 * Estructura: <curso>/<folio>-<estudiante>.pdf
 */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role === "student") {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }

  const courseId = request.nextUrl.searchParams.get("courseId");
  const studentId = request.nextUrl.searchParams.get("studentId");

  const base = db
    .select({
      id: certificates.id,
      folio: certificates.folio,
      pdfFileId: certificates.pdfFileId,
      revoked: certificates.revoked,
      studentName: users.fullName,
      courseTitle: courses.title,
      ownerId: courses.ownerId,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .innerJoin(users, eq(certificates.studentId, users.id))
    .orderBy(desc(certificates.issuedAt));

  const conditions = [eq(certificates.revoked, false)];
  if (courseId) conditions.push(eq(certificates.courseId, courseId));
  if (studentId) conditions.push(eq(certificates.studentId, studentId));
  let rows = base.where(and(...conditions)).all();

  // Lo mismo que se ve en pantalla: el maestro, lo suyo; el admin, su contexto
  const ownerId = scopeOwnerId(await getViewScope(user));
  if (ownerId !== null) {
    rows = rows.filter((r) => r.ownerId === ownerId);
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No hay certificados para descargar" }, { status: 404 });
  }

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = new PassThrough();
  archive.pipe(out);

  for (const row of rows) {
    const name = `${safeName(row.courseTitle)}/${row.folio}-${safeName(row.studentName)}.pdf`;

    // Histórico: si aún existe el archivo, se toma de disco
    if (row.pdfFileId) {
      const record = getFileRecord(row.pdfFileId);
      if (record) {
        try {
          const abs = absolutePathFor(record.storedPath);
          if (fs.existsSync(abs)) {
            archive.append(fs.createReadStream(abs), { name });
            continue;
          }
        } catch {
          /* ruta inválida: se regenera abajo */
        }
      }
    }

    // El PDF no vive en disco: se genera desde la plantilla congelada (~22 ms)
    const cert = db.select().from(certificates).where(eq(certificates.id, row.id)).get();
    if (!cert) continue;
    const rendered = await renderCertificateFor(cert);
    if (rendered) archive.append(Buffer.from(rendered.bytes), { name });
  }
  void archive.finalize();

  audit(user.id, "download_certificates_zip", "certificates", studentId ?? courseId ?? "all", {
    count: rows.length,
    courseId: courseId ?? null,
    studentId: studentId ?? null,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = studentId
    ? `portafolio-${safeName(rows[0].studentName)}-${stamp}.zip`
    : courseId
      ? `certificados-${safeName(rows[0].courseTitle)}-${stamp}.zip`
      : `certificados-${stamp}.zip`;

  return new NextResponse(Readable.toWeb(out) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
