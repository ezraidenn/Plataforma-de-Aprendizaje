import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { itemVideos, itemProgress, videoProgress } from "@/server/db/schema";
import { canAccess, ensureItemProgress, getEnrollment } from "./progress";

export type ItemVideo = typeof itemVideos.$inferSelect;

// Cobertura >= 97% cuenta como 100% (créditos finales, buffering)
const COMPLETE_THRESHOLD = 0.97;
// Tolerancia de acreditación por latido (segundos)
const DELTA_TOLERANCE_S = 2;

// ─── URL parsing ─────────────────────────────────────────────────────────────

export function parseVideoUrl(
  url: string
): { provider: "youtube" | "vimeo"; videoId: string } | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return id ? { provider: "youtube", videoId: id } : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return id ? { provider: "youtube", videoId: id } : null;
      }
      const m = /^\/(embed|shorts|live)\/([\w-]+)/.exec(u.pathname);
      if (m) return { provider: "youtube", videoId: m[2] };
      return null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const m = /(\d{6,})/.exec(u.pathname);
      if (m) return { provider: "vimeo", videoId: m[1] };
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

export function getVideoDetail(itemId: string): ItemVideo | null {
  return db.select().from(itemVideos).where(eq(itemVideos.itemId, itemId)).get() ?? null;
}

export function setVideoLink(opts: {
  itemId: string;
  url: string;
  durationSeconds?: number | null;
  allowSpeedUp?: boolean;
}) {
  const parsed = parseVideoUrl(opts.url);
  if (!parsed) {
    throw new Error("Enlace no válido: usa un enlace de YouTube o Vimeo");
  }
  db.update(itemVideos)
    .set({
      url: opts.url.trim(),
      provider: parsed.provider,
      videoId: parsed.videoId,
      ...(opts.durationSeconds !== undefined ? { durationSeconds: opts.durationSeconds } : {}),
      ...(opts.allowSpeedUp !== undefined ? { allowSpeedUp: opts.allowSpeedUp } : {}),
    })
    .where(eq(itemVideos.itemId, opts.itemId))
    .run();
}

/**
 * La duración la reporta el player al primer load (si el maestro no la fijó).
 * Solo se acepta si aún no hay duración guardada (no es sobreescribible por
 * el cliente después: es la base del cálculo de porcentaje).
 */
export function reportVideoDuration(itemId: string, durationSeconds: number) {
  const video = getVideoDetail(itemId);
  if (!video || video.durationSeconds) return;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60 * 60 * 12)
    return;
  db.update(itemVideos)
    .set({ durationSeconds: Math.round(durationSeconds) })
    .where(eq(itemVideos.itemId, itemId))
    .run();
}

// ─── Intervalos ──────────────────────────────────────────────────────────────

export type Interval = [number, number];

/** El default de la columna JSON puede venir como string anidado: normalizar. */
function normalizeIntervals(raw: unknown): Interval[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as Interval[]) : [];
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [sorted[0]];
  for (const [start, end] of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (start <= last[1] + 0.5) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

export function coverageSeconds(intervals: Interval[]): number {
  return intervals.reduce((sum, [start, end]) => sum + (end - start), 0);
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

export type VideoHeartbeatResult = {
  percent: number;
  completed: boolean;
  maxPosition: number;
};

/**
 * Acredita [last_position, position] solo si el avance cabe en el tiempo real
 * transcurrido (Δt del servidor × velocidad máxima + tolerancia). Un seek
 * hacia adelante registra la nueva posición pero NO acredita el salto.
 */
export function videoHeartbeat(opts: {
  courseId: string;
  studentId: string;
  itemId: string;
  position: number;
  /** Duración reportada por el player en el primer latido (solo si falta) */
  reportedDuration?: number;
}): VideoHeartbeatResult {
  const access = canAccess(opts.courseId, opts.studentId, opts.itemId);
  if (!access.allowed) throw new Error("Sin acceso al contenido");

  let video = getVideoDetail(opts.itemId);
  if (!video || !video.videoId) throw new Error("Video no disponible");
  // La duración solo se acepta de un estudiante CON acceso (evita envenenarla)
  if (!video.durationSeconds && opts.reportedDuration) {
    reportVideoDuration(opts.itemId, opts.reportedDuration);
    video = getVideoDetail(opts.itemId)!;
  }
  if (!video.durationSeconds) throw new Error("La duración del video aún no está registrada");

  // B4: si la duración guardada difiere >20% de la que reporta el player,
  // usamos la MENOR solo para el cálculo de cobertura. No reescribimos la
  // guardada (la fijó el maestro o el primer latido y el cliente no debe
  // poder inflarla), pero con una guardada demasiado larga el 100% sería
  // inalcanzable, y con una demasiado corta se regalaría el completado.
  let duration = video.durationSeconds;
  if (
    opts.reportedDuration &&
    Number.isFinite(opts.reportedDuration) &&
    opts.reportedDuration > 0 &&
    Math.abs(opts.reportedDuration - duration) / duration > 0.2
  ) {
    duration = Math.min(duration, Math.round(opts.reportedDuration));
  }
  const position = Math.max(0, Math.min(opts.position, duration));
  const enrollment = getEnrollment(opts.courseId, opts.studentId)!;
  const now = Date.now();
  const rateMax = video.allowSpeedUp ? 2 : 1;

  return db.transaction((): VideoHeartbeatResult => {
    const ip = ensureItemProgress(enrollment.id, opts.itemId);

    let detail = db
      .select()
      .from(videoProgress)
      .where(eq(videoProgress.itemProgressId, ip.id))
      .get();
    if (!detail) {
      db.insert(videoProgress).values({ itemProgressId: ip.id }).run();
      detail = db
        .select()
        .from(videoProgress)
        .where(eq(videoProgress.itemProgressId, ip.id))
        .get()!;
    }

    const lastBeat = detail.lastHeartbeatAt?.getTime() ?? null;
    const wallDeltaS = lastBeat ? (now - lastBeat) / 1000 : 0;
    const advanceS = position - detail.lastPosition;

    let intervals = normalizeIntervals(detail.watchedIntervals);

    // Acreditar solo avance plausible: reproducción real, no seek
    if (
      lastBeat &&
      advanceS > 0 &&
      advanceS <= wallDeltaS * rateMax + DELTA_TOLERANCE_S &&
      wallDeltaS < 120 // latido demasiado viejo: no acreditar el hueco
    ) {
      intervals = mergeIntervals([...intervals, [detail.lastPosition, position]]);
    }

    const covered = coverageSeconds(intervals);
    const ratio = Math.min(1, covered / duration);
    const effectiveRatio = ratio >= COMPLETE_THRESHOLD ? 1 : ratio;
    const percent = Math.round(effectiveRatio * 100);
    const completed = effectiveRatio >= 1;

    const maxPosition = Math.max(detail.maxPosition, position);

    db.update(videoProgress)
      .set({
        watchedIntervals: intervals,
        lastPosition: position,
        maxPosition,
        lastHeartbeatAt: new Date(now),
      })
      .where(eq(videoProgress.itemProgressId, ip.id))
      .run();

    const wasCompleted = ip.status === "completed";
    db.update(itemProgress)
      .set({
        status: completed || wasCompleted ? "completed" : "in_progress",
        percent: wasCompleted ? 100 : percent,
        completedAt: ip.completedAt ?? (completed ? new Date(now) : null),
        lastActivityAt: new Date(now),
        totalSeconds: ip.totalSeconds + Math.round(Math.min(wallDeltaS, 30)),
        updatedAt: new Date(now),
      })
      .where(eq(itemProgress.id, ip.id))
      .run();

    return { percent: wasCompleted ? 100 : percent, completed: completed || wasCompleted, maxPosition };
  });
}

/** Estado inicial para el player (reanudar + frontera de seek). */
export function getVideoProgress(courseId: string, studentId: string, itemId: string) {
  const enrollment = getEnrollment(courseId, studentId);
  if (!enrollment) return null;
  const ip = db
    .select()
    .from(itemProgress)
    .where(eq(itemProgress.enrollmentId, enrollment.id))
    .all()
    .find((r) => r.itemId === itemId);
  if (!ip) return { percent: 0, completed: false, lastPosition: 0, maxPosition: 0 };
  const detail = db
    .select()
    .from(videoProgress)
    .where(eq(videoProgress.itemProgressId, ip.id))
    .get();
  return {
    percent: ip.percent,
    completed: ip.status === "completed",
    lastPosition: detail?.lastPosition ?? 0,
    maxPosition: detail?.maxPosition ?? 0,
  };
}
