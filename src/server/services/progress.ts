import "server-only";
import { and, eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import {
  enrollments,
  courses,
  itemDocuments,
  itemTexts,
  itemProgress,
  documentProgress,
} from "@/server/db/schema";
import { linearOrder, type CourseItem } from "./tree";

// ─── Bitmap de páginas: bit N-1 = página N acreditada ────────────────────────

export function bitGet(buf: Buffer | null, page: number): boolean {
  if (!buf) return false;
  const idx = page - 1;
  const byte = Math.floor(idx / 8);
  if (byte >= buf.length) return false;
  return (buf[byte] & (1 << (idx % 8))) !== 0;
}

export function bitSet(buf: Buffer | null, page: number, totalPages: number): Buffer {
  const size = Math.ceil(totalPages / 8);
  const out = Buffer.alloc(Math.max(size, buf?.length ?? 0));
  buf?.copy(out);
  const idx = page - 1;
  out[Math.floor(idx / 8)] |= 1 << (idx % 8);
  return out;
}

export function bitCount(buf: Buffer | null, totalPages: number): number {
  if (!buf) return 0;
  let count = 0;
  for (let page = 1; page <= totalPages; page++) if (bitGet(buf, page)) count++;
  return count;
}

export function pagesFromBitmap(buf: Buffer | null, totalPages: number): number[] {
  const pages: number[] = [];
  for (let page = 1; page <= totalPages; page++) if (bitGet(buf, page)) pages.push(page);
  return pages;
}

// ─── Matrícula y progreso base ───────────────────────────────────────────────

/**
 * Matrícula ACTUAL del alumno en el curso: el ciclo más reciente. Un alumno
 * recertificado tiene varios ciclos (2026, 2027…); todo lo que muestra o
 * registra avance trabaja sobre el vigente, y los anteriores quedan como
 * historial con su certificado.
 */
export function getEnrollment(courseId: string, studentId: string) {
  return (
    db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
      .orderBy(desc(enrollments.cycle))
      .limit(1)
      .get() ?? null
  );
}

/** Todos los ciclos del alumno en el curso, del más reciente al más antiguo. */
export function listEnrollmentCycles(courseId: string, studentId: string) {
  return db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
    .orderBy(desc(enrollments.cycle))
    .all();
}

export function ensureItemProgress(enrollmentId: string, itemId: string) {
  const existing = db
    .select()
    .from(itemProgress)
    .where(and(eq(itemProgress.enrollmentId, enrollmentId), eq(itemProgress.itemId, itemId)))
    .get();
  if (existing) return existing;

  const id = nanoid();
  db.insert(itemProgress).values({ id, enrollmentId, itemId }).run();
  return db.select().from(itemProgress).where(eq(itemProgress.id, id)).get()!;
}

export function getProgressMap(enrollmentId: string) {
  const rows = db
    .select()
    .from(itemProgress)
    .where(eq(itemProgress.enrollmentId, enrollmentId))
    .all();
  return new Map(rows.map((r) => [r.itemId, r]));
}

// ─── Gating de secuencia (candados) ──────────────────────────────────────────

function effectiveSequenceRequired(item: CourseItem, courseEnforces: boolean): boolean {
  if (item.sequenceMode === "required") return true;
  if (item.sequenceMode === "free") return false;
  return courseEnforces;
}

export type AccessResult =
  | { allowed: true }
  | { allowed: false; reason: "locked"; blockedBy: { id: string; title: string } }
  | { allowed: false; reason: "not_enrolled" | "not_found" };

/**
 * ¿Puede el estudiante abrir este ítem? Recorre el orden lineal DFS y exige
 * que todo ítem anterior requerido-en-secuencia esté completado.
 * Se llama al renderizar la página del ítem Y en cada endpoint de contenido.
 */
export function canAccess(courseId: string, studentId: string, itemId: string): AccessResult {
  const enrollment = getEnrollment(courseId, studentId);
  if (!enrollment) return { allowed: false, reason: "not_enrolled" };

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return { allowed: false, reason: "not_found" };

  const order = linearOrder(courseId).filter((i) => i.visible);
  const target = order.find((i) => i.id === itemId);
  if (!target) return { allowed: false, reason: "not_found" };

  const progress = getProgressMap(enrollment.id);

  for (const item of order) {
    if (item.id === itemId) return { allowed: true };
    const mustComplete =
      effectiveSequenceRequired(item, course.enforceSequence) && item.requiredForCompletion;
    if (mustComplete && progress.get(item.id)?.status !== "completed") {
      return { allowed: false, reason: "locked", blockedBy: { id: item.id, title: item.title } };
    }
  }
  return { allowed: false, reason: "not_found" };
}

/** Estado de candado por ítem para pintar el árbol del estudiante. */
export function lockStates(courseId: string, studentId: string): Map<string, boolean> {
  const enrollment = getEnrollment(courseId, studentId);
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  const locked = new Map<string, boolean>();
  if (!enrollment || !course) return locked;

  const order = linearOrder(courseId).filter((i) => i.visible);
  const progress = getProgressMap(enrollment.id);

  let blocked = false;
  for (const item of order) {
    locked.set(item.id, blocked);
    const mustComplete =
      effectiveSequenceRequired(item, course.enforceSequence) && item.requiredForCompletion;
    if (!blocked && mustComplete && progress.get(item.id)?.status !== "completed") {
      blocked = true;
    }
  }
  return locked;
}

// ─── Heartbeat de documentos (PDF) y texto ───────────────────────────────────

const HEARTBEAT_INTERVAL_S = 10;
// No acreditar más tiempo que ~2 intervalos por latido (pestaña oculta, laptop dormida)
const MAX_CREDIT_PER_BEAT_S = HEARTBEAT_INTERVAL_S * 2 + 5;

export type HeartbeatResult = {
  percent: number;
  completed: boolean;
  creditedPages: number[];
  currentPage: number;
  /** Lecturas: segundos ya acreditados por el servidor (para el contador). */
  creditedSeconds?: number;
};

/**
 * Procesa un latido de lectura de documento. El cliente reporta la página en
 * la que está; el servidor decide qué se acredita usando SU reloj:
 *  - Una página se acredita si el latido anterior ya reportaba esa página y
 *    pasaron >= min_seconds_per_page entre ambos.
 *  - Presupuesto: nunca más páginas acreditadas que tiempo_total / min_seconds.
 */
export function documentHeartbeat(opts: {
  courseId: string;
  studentId: string;
  itemId: string;
  page: number;
}): HeartbeatResult {
  const access = canAccess(opts.courseId, opts.studentId, opts.itemId);
  if (!access.allowed) throw new Error("Sin acceso al contenido");

  const doc = db
    .select()
    .from(itemDocuments)
    .where(eq(itemDocuments.itemId, opts.itemId))
    .get();
  if (!doc || doc.processingStatus !== "ready" || !doc.pageCount) {
    throw new Error("Documento no disponible");
  }

  const pageCount = doc.pageCount;
  const page = Math.max(1, Math.min(opts.page, pageCount));
  const enrollment = getEnrollment(opts.courseId, opts.studentId)!;
  const now = Date.now();

  const result = db.transaction((): HeartbeatResult => {
    const ip = ensureItemProgress(enrollment.id, opts.itemId);

    let detail = db
      .select()
      .from(documentProgress)
      .where(eq(documentProgress.itemProgressId, ip.id))
      .get();
    if (!detail) {
      db.insert(documentProgress).values({ itemProgressId: ip.id }).run();
      detail = db
        .select()
        .from(documentProgress)
        .where(eq(documentProgress.itemProgressId, ip.id))
        .get()!;
    }

    const lastBeat = detail.lastHeartbeatAt?.getTime() ?? null;
    const deltaS = lastBeat ? (now - lastBeat) / 1000 : 0;
    const creditableDeltaS = Math.min(deltaS, MAX_CREDIT_PER_BEAT_S);

    let bitmap = (detail.pagesViewed as Buffer | null) ?? null;
    const creditedPages: number[] = [];

    const newTotalSeconds = ip.totalSeconds + Math.round(creditableDeltaS);

    // Permanencia ACUMULADA en la página del latido anterior: los latidos van
    // cada ~10 s, así que la permanencia se suma entre latidos consecutivos en
    // la misma página (un solo intervalo >= min hacía imposible min > 10 s).
    const prevPage = detail.lastReportedPage;
    let accum = detail.pageAccumSeconds;
    if (prevPage && lastBeat && creditableDeltaS > 0 && !bitGet(bitmap, prevPage)) {
      accum += creditableDeltaS;
      if (accum >= doc.minSecondsPerPage) {
        // Presupuesto duro: páginas <= tiempo total / mínimo por página
        const already = bitCount(bitmap, pageCount);
        const budget = Math.floor(newTotalSeconds / doc.minSecondsPerPage);
        if (already < budget) {
          bitmap = bitSet(bitmap, prevPage, pageCount);
          creditedPages.push(prevPage);
          accum = 0;
        }
      }
    }
    // Al cambiar de página, la permanencia acumulada empieza de cero
    if (page !== prevPage) accum = 0;

    const viewed = bitCount(bitmap, pageCount);
    const percent = Math.round((viewed / pageCount) * 100);
    const completed = viewed >= pageCount;

    db.update(documentProgress)
      .set({
        pagesViewed: bitmap,
        currentPage: page,
        lastReportedPage: page,
        pageAccumSeconds: Math.round(accum),
        lastHeartbeatAt: new Date(now),
      })
      .where(eq(documentProgress.itemProgressId, ip.id))
      .run();

    db.update(itemProgress)
      .set({
        status: completed ? "completed" : "in_progress",
        percent,
        completedAt: completed && !ip.completedAt ? new Date(now) : ip.completedAt,
        lastActivityAt: new Date(now),
        totalSeconds: newTotalSeconds,
        updatedAt: new Date(now),
      })
      .where(eq(itemProgress.id, ip.id))
      .run();

    return { percent, completed, creditedPages, currentPage: page };
  });

  return result;
}

/**
 * Latido de lectura de texto: una sola "página" con min_read_seconds.
 * Se completa cuando el tiempo acumulado alcanza el mínimo.
 */
export function textHeartbeat(opts: {
  courseId: string;
  studentId: string;
  itemId: string;
}): HeartbeatResult {
  const access = canAccess(opts.courseId, opts.studentId, opts.itemId);
  if (!access.allowed) throw new Error("Sin acceso al contenido");

  const textItem = db.select().from(itemTexts).where(eq(itemTexts.itemId, opts.itemId)).get();
  if (!textItem) throw new Error("Lectura no disponible");

  const enrollment = getEnrollment(opts.courseId, opts.studentId)!;
  const now = Date.now();

  return db.transaction((): HeartbeatResult => {
    const ip = ensureItemProgress(enrollment.id, opts.itemId);
    if (ip.status === "completed") {
      return {
        percent: 100,
        completed: true,
        creditedPages: [],
        currentPage: 1,
        creditedSeconds: ip.totalSeconds,
      };
    }

    const lastBeat = ip.lastActivityAt?.getTime() ?? null;
    const deltaS = lastBeat ? Math.min((now - lastBeat) / 1000, MAX_CREDIT_PER_BEAT_S) : 0;
    const totalSeconds = ip.totalSeconds + Math.round(deltaS);

    const minS = textItem.minReadSeconds;
    const completed = minS <= 0 ? true : totalSeconds >= minS;
    const percent = completed ? 100 : Math.min(99, Math.round((totalSeconds / minS) * 100));

    db.update(itemProgress)
      .set({
        status: completed ? "completed" : "in_progress",
        percent,
        completedAt: completed ? new Date(now) : null,
        lastActivityAt: new Date(now),
        totalSeconds,
        updatedAt: new Date(now),
      })
      .where(eq(itemProgress.id, ip.id))
      .run();

    return { percent, completed, creditedPages: [], currentPage: 1, creditedSeconds: totalSeconds };
  });
}

// ─── Resumen de progreso de curso ────────────────────────────────────────────

export type CourseProgressSummary = {
  percent: number;
  totalRequired: number;
  completedRequired: number;
  nextItem: CourseItem | null;
  lastInProgress: CourseItem | null;
};

export function courseProgress(courseId: string, studentId: string): CourseProgressSummary {
  const enrollment = getEnrollment(courseId, studentId);
  const empty: CourseProgressSummary = {
    percent: 0,
    totalRequired: 0,
    completedRequired: 0,
    nextItem: null,
    lastInProgress: null,
  };
  if (!enrollment) return empty;

  const order = linearOrder(courseId).filter((i) => i.visible);
  const required = order.filter((i) => i.requiredForCompletion);
  const progress = getProgressMap(enrollment.id);

  const completedRequired = required.filter(
    (i) => progress.get(i.id)?.status === "completed"
  ).length;

  let lastInProgress: CourseItem | null = null;
  let lastActivity = 0;
  for (const item of order) {
    const p = progress.get(item.id);
    if (p?.status === "in_progress" && (p.lastActivityAt?.getTime() ?? 0) >= lastActivity) {
      lastActivity = p.lastActivityAt?.getTime() ?? 0;
      lastInProgress = item;
    }
  }

  const nextItem =
    lastInProgress ?? order.find((i) => progress.get(i.id)?.status !== "completed") ?? null;

  // En un curso 100% opcional (sin ítems requeridos) el % se calcula con
  // los ítems visibles no requeridos, para que no quede en 0% eterno.
  let percent = 0;
  if (required.length > 0) {
    percent = Math.round((completedRequired / required.length) * 100);
  } else if (order.length > 0) {
    const completedAll = order.filter(
      (i) => progress.get(i.id)?.status === "completed"
    ).length;
    percent = Math.round((completedAll / order.length) * 100);
  }

  return {
    percent,
    totalRequired: required.length,
    completedRequired,
    nextItem,
    lastInProgress,
  };
}
