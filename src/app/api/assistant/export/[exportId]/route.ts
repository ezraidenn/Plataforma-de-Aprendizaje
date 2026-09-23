import { NextRequest, NextResponse } from "next/server";
import { apiUser } from "@/server/auth/guards";
import { readExport } from "@/server/assistant/exports";

export const runtime = "nodejs";

/** Nombre de archivo para la cabecera: sin comillas, saltos ni rutas. */
function safeName(name: string): string {
  const clean = name.replace(/[\/"\r\n]+/g, "").trim();
  return clean.slice(0, 80) || "descarga.csv";
}

/**
 * GET /api/assistant/export/<id> → el CSV que dejó el asistente.
 * Solo el dueño de la conversación y solo mientras no caduque (24 horas); los
 * alumnos no tienen asistente, así que quedan fuera. El CSV ya trae BOM.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role === "student") return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  const file = readExport(user.id, exportId);
  if (!file) {
    return NextResponse.json(
      { error: "Esa descarga ya no está disponible: caducó (duran 24 horas) o no es tuya. Vuelve a pedir la consulta." },
      { status: 404 }
    );
  }

  return new NextResponse(file.content, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName(file.fileName)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
