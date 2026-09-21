import { NextRequest, NextResponse } from "next/server";
import { apiUser } from "@/server/auth/guards";
import { documentHeartbeat, textHeartbeat, getEnrollment } from "@/server/services/progress";
import { videoHeartbeat } from "@/server/services/video";
import { evaluateEnrollment } from "@/server/services/rules-engine";

export const runtime = "nodejs";

/**
 * POST { courseId, itemId, kind: "document" | "text" | "video", page?, position?, duration? }
 * El cliente solo reporta dónde está; el servidor acredita con su reloj.
 * Al completarse un ítem se evalúan las reglas de aprobación del curso.
 */
export async function POST(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "student") {
    // Maestros previsualizan sin registrar progreso
    return NextResponse.json({ percent: 0, completed: false, creditedPages: [], preview: true });
  }

  let body: {
    courseId?: string;
    itemId?: string;
    kind?: string;
    page?: number;
    position?: number;
    duration?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { courseId, itemId, kind } = body;
  if (!courseId || !itemId || !kind) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  try {
    let result: { percent: number; completed: boolean; [k: string]: unknown };

    if (kind === "document") {
      result = documentHeartbeat({ courseId, studentId: user.id, itemId, page: Number(body.page ?? 1) });
    } else if (kind === "text") {
      result = textHeartbeat({ courseId, studentId: user.id, itemId });
    } else if (kind === "video") {
      result = videoHeartbeat({
        courseId,
        studentId: user.id,
        itemId,
        position: Number(body.position ?? 0),
        // La duración se valida DENTRO (tras canAccess): nadie sin acceso la fija
        reportedDuration: body.duration ? Number(body.duration) : undefined,
      });
    } else {
      return NextResponse.json({ error: "Tipo no soportado" }, { status: 400 });
    }

    // Evento de completado → evaluar reglas de aprobación del curso
    if (result.completed) {
      const enrollment = getEnrollment(courseId, user.id);
      if (enrollment && enrollment.status !== "completed") {
        const evaluation = evaluateEnrollment(enrollment.id);
        if (evaluation?.passed) {
          result = { ...result, courseCompleted: true };
        }
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de tracking";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
