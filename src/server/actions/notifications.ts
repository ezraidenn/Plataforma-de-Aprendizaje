"use server";

import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { courseItems, users } from "@/server/db/schema";
import { requireUser } from "@/server/auth/guards";
import { getSessionUser, type SessionUser } from "@/server/auth/sessions";
import {
  deleteAllNotifications,
  deleteNotification,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  type Notification,
  type NotificationType,
} from "@/server/services/notifications";

// ─── DTOs (título y destino ya resueltos server-side) ────────────────────────

export type NotificationDto = {
  id: string;
  type: NotificationType;
  /** Título en español, armado con el payload (nombres ya resueltos). */
  title: string;
  /** Segunda línea: hoy solo la tienen los avisos del maestro (el cuerpo, recortado). */
  description?: string;
  /** Destino al que navega el clic, según tipo y rol. «» = no lleva a ningún sitio. */
  href: string;
  createdAtMs: number;
  read: boolean;
};

export type NotificationsResult = {
  items: NotificationDto[];
  unread: number;
  /** Reloj del servidor para calcular "hace 2 h" sin depender del reloj local. */
  serverNowMs: number;
};

// ─── Lectura defensiva del payload ───────────────────────────────────────────

type Payload = {
  courseId: string | null;
  courseTitle: string | null;
  itemId: string | null;
  itemTitle: string | null;
  studentId: string | null;
  attemptId: string | null;
  submissionId: string | null;
  /** Solo en los avisos del maestro: lo que escribió y quién lo manda */
  noticeTitle: string | null;
  noticeBody: string | null;
  from: string | null;
};

/** Lo que se enseña del cuerpo del aviso en la campana; el resto se recorta. */
const NOTICE_PREVIEW = 140;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readPayload(n: Notification): Payload {
  const p = (typeof n.payload === "object" && n.payload !== null ? n.payload : {}) as Record<
    string,
    unknown
  >;
  return {
    courseId: str(p.courseId),
    courseTitle: str(p.courseTitle),
    itemId: str(p.itemId),
    itemTitle: str(p.itemTitle),
    studentId: str(p.studentId),
    attemptId: str(p.attemptId),
    submissionId: str(p.submissionId),
    noticeTitle: str(p.title),
    noticeBody: str(p.body),
    from: str(p.from),
  };
}

/** Segunda línea del aviso del maestro: su cuerpo, recortado para la campana. */
function buildDescription(n: Notification, p: Payload): string | undefined {
  if (n.type !== "teacher_notice" || !p.noticeBody) return undefined;
  const clean = p.noticeBody.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length <= NOTICE_PREVIEW ? clean : `${clean.slice(0, NOTICE_PREVIEW - 1)}…`;
}

const q = (s: string) => `«${s}»`;

function buildTitle(
  n: Notification,
  p: Payload,
  user: SessionUser,
  studentNames: Map<string, string>
): string {
  const studentName = p.studentId ? (studentNames.get(p.studentId) ?? null) : null;
  const itemOrCourse = p.itemTitle ?? p.courseTitle;

  switch (n.type) {
    case "course_completed": {
      // La misma notificación llega al alumno y al maestro dueño del curso
      const mine = user.role === "student" || p.studentId === user.id;
      if (mine) {
        return p.courseTitle ? `Completaste ${q(p.courseTitle)}` : "Completaste un curso";
      }
      const who = studentName ?? "Un estudiante";
      return p.courseTitle ? `${who} completó ${q(p.courseTitle)}` : `${who} completó un curso`;
    }
    case "assignment_submitted": {
      if (studentName && itemOrCourse) {
        return `Nueva entrega de ${studentName} en ${q(itemOrCourse)}`;
      }
      return itemOrCourse ? `Nueva entrega en ${q(itemOrCourse)}` : "Nueva entrega de tarea";
    }
    case "exam_needs_grading": {
      if (studentName && itemOrCourse) {
        return `${studentName} envió el examen ${q(itemOrCourse)}`;
      }
      return itemOrCourse
        ? `Examen por calificar en ${q(itemOrCourse)}`
        : "Un examen necesita tu calificación";
    }
    case "certificate_issued":
      return p.courseTitle
        ? `Tu certificado de ${q(p.courseTitle)} está listo`
        : "Tu certificado está listo";
    case "deadline_reminder":
      return itemOrCourse
        ? `Se acerca la fecha límite de ${q(itemOrCourse)}`
        : "Se acerca una fecha límite";
    case "submission_returned":
      return itemOrCourse
        ? `Tu entrega de ${q(itemOrCourse)} fue devuelta`
        : "Tu entrega fue devuelta para corrección";
    case "grade_published":
      return itemOrCourse
        ? `Calificación publicada en ${q(itemOrCourse)}`
        : "Tienes una calificación nueva";
    case "results_available":
      return itemOrCourse
        ? `Tus resultados de ${q(itemOrCourse)} ya están disponibles`
        : "Tus resultados ya están disponibles";
    case "teacher_notice":
      // Lo escribió una persona: su título va tal cual
      return p.noticeTitle ?? (p.from ? `Aviso de ${p.from}` : "Aviso de tu maestro");
  }
}

function buildHref(n: Notification, p: Payload, user: SessionUser): string {
  const home = user.role === "student" ? "/dashboard" : "/teach/dashboard";
  switch (n.type) {
    case "certificate_issued":
      return "/dashboard#certificados";
    case "course_completed": {
      const mine = user.role === "student" || p.studentId === user.id;
      if (mine) return p.courseId ? `/courses/${p.courseId}` : home;
      return p.courseId ? `/teach/courses/${p.courseId}/students` : home;
    }
    case "exam_needs_grading":
      // Deep-link: la cola abre esa entrega en el panel (soporta ?attempt=)
      return p.attemptId ? `/teach/grading?attempt=${p.attemptId}` : "/teach/grading";
    case "assignment_submitted":
      return p.submissionId ? `/teach/grading?submission=${p.submissionId}` : "/teach/grading";
    case "grade_published":
    case "results_available":
    case "submission_returned":
    case "deadline_reminder":
      return p.courseId && p.itemId ? `/courses/${p.courseId}/items/${p.itemId}` : "/dashboard";
    case "teacher_notice":
      // Sin curso no hay a dónde ir: el aviso se lee ahí mismo y el clic no navega
      if (!p.courseId) return "";
      return user.role === "student" ? `/courses/${p.courseId}` : `/teach/courses/${p.courseId}/students`;
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Últimas 15 notificaciones con título/destino resueltos + contador. */
export async function getNotificationsAction(): Promise<NotificationsResult> {
  const user = await requireUser();
  const rows = listNotifications(user.id, 15);
  const payloads = new Map(rows.map((n) => [n.id, readPayload(n)]));

  // Completar courseId/itemTitle ausentes a partir del ítem (una sola consulta)
  const missingItemIds = [
    ...new Set(
      rows
        .map((n) => payloads.get(n.id)!)
        .filter((p) => p.itemId && (!p.courseId || !p.itemTitle))
        .map((p) => p.itemId!)
    ),
  ];
  if (missingItemIds.length > 0) {
    const items = db
      .select({ id: courseItems.id, courseId: courseItems.courseId, title: courseItems.title })
      .from(courseItems)
      .where(inArray(courseItems.id, missingItemIds))
      .all();
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const p of payloads.values()) {
      const item = p.itemId ? byId.get(p.itemId) : undefined;
      if (item) {
        p.courseId = p.courseId ?? item.courseId;
        p.itemTitle = p.itemTitle ?? item.title;
      }
    }
  }

  // Nombres de estudiantes para los títulos del maestro (una sola consulta)
  const studentIds = [
    ...new Set(
      rows
        .map((n) => payloads.get(n.id)!.studentId)
        .filter((id): id is string => !!id && id !== user.id)
    ),
  ];
  const studentNames = new Map<string, string>();
  if (studentIds.length > 0) {
    const found = db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, studentIds))
      .all();
    for (const u of found) studentNames.set(u.id, u.fullName);
  }

  const items: NotificationDto[] = rows.map((n) => {
    const p = payloads.get(n.id)!;
    return {
      id: n.id,
      type: n.type,
      title: buildTitle(n, p, user, studentNames),
      description: buildDescription(n, p),
      href: buildHref(n, p, user),
      createdAtMs: n.createdAt.getTime(),
      read: n.readAt !== null,
    };
  });

  return { items, unread: unreadCount(user.id), serverNowMs: Date.now() };
}

/**
 * Contador de no-leídas para el badge (polling). Devuelve 0 sin sesión en vez
 * de redirigir: un intervalo de fondo no debe expulsar al usuario.
 */
export async function getUnreadCountAction(): Promise<number> {
  const user = await getSessionUser();
  return user ? unreadCount(user.id) : 0;
}

export async function markReadAction(notificationId: string): Promise<{ ok: true }> {
  const user = await requireUser();
  markRead(user.id, notificationId);
  return { ok: true };
}

export async function markAllReadAction(): Promise<{ ok: true }> {
  const user = await requireUser();
  markAllRead(user.id);
  return { ok: true };
}

/** Borra una notificación propia; devuelve el contador ya actualizado. */
export async function deleteNotificationAction(notificationId: string): Promise<{ ok: true; unread: number }> {
  const user = await requireUser();
  deleteNotification(user.id, notificationId);
  return { ok: true, unread: unreadCount(user.id) };
}

/** Deja la campana en limpio: borra TODAS las notificaciones del usuario. */
export async function deleteAllNotificationsAction(): Promise<{ ok: true; count: number }> {
  const user = await requireUser();
  return { ok: true, count: deleteAllNotifications(user.id) };
}
