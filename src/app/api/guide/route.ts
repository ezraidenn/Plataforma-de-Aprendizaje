import { NextRequest, NextResponse } from "next/server";
import { apiUser } from "@/server/auth/guards";
import { guidesFor, type GuideRole } from "@/content/guide";
import { renderGuideHtml } from "@/server/services/guide-html";
import { getBranding } from "@/server/services/branding";

export const runtime = "nodejs";

/** Descarga la guía de uso de un rol como HTML autocontenido. */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const role = (request.nextUrl.searchParams.get("role") ?? user.role) as GuideRole;
  const allowed = guidesFor(user.role).some((g) => g.role === role);
  if (!allowed) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  const branding = getBranding();
  const html = renderGuideHtml(role, branding.platformName);
  const slug = { teacher: "maestro", student: "estudiante", admin: "administrador" }[role];
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`guia-${slug}.html`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
