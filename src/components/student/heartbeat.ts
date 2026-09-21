"use client";

import type { HeartbeatResponse, VideoHeartbeatResponse } from "./types";

/**
 * Latido de lectura. El cliente solo reporta dónde está; el SERVIDOR es
 * quien acredita páginas con su reloj. Devuelve null si la red falla
 * (el tracking es invisible: sin spinners ni toasts por tráfico de fondo).
 */
export async function sendHeartbeat(body: {
  courseId: string;
  itemId: string;
  kind: "document" | "text";
  page?: number;
}): Promise<HeartbeatResponse | null> {
  try {
    const res = await fetch("/api/progress/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) return null;
    return (await res.json()) as HeartbeatResponse;
  } catch {
    return null;
  }
}

/**
 * Latido de video. `duration` solo se manda en el primer latido si el
 * servidor aún no tiene la duración registrada. El servidor acredita
 * intervalos con su reloj; la respuesta trae el % ACREDITADO y la frontera
 * de seek (maxPosition). courseCompleted:true = aprobó el curso completo.
 */
export async function sendVideoHeartbeat(body: {
  courseId: string;
  itemId: string;
  position: number;
  duration?: number;
}): Promise<VideoHeartbeatResponse | null> {
  try {
    const res = await fetch("/api/progress/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, kind: "video" }),
      keepalive: true,
    });
    if (!res.ok) return null;
    return (await res.json()) as VideoHeartbeatResponse;
  } catch {
    return null;
  }
}
