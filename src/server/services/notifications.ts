import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";

export type Notification = typeof notifications.$inferSelect;
export type NotificationType = Notification["type"];

export function notify(userId: string, type: NotificationType, payload: Record<string, unknown>) {
  // createdAt explícito con precisión de milisegundos: el default de la
  // columna redondea al segundo y desordena la campana cuando varias
  // notificaciones nacen en el mismo segundo.
  db.insert(notifications)
    .values({ id: nanoid(), userId, type, payload, createdAt: new Date() })
    .run();
}

export function listNotifications(userId: string, limit = 20): Notification[] {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
}

export function unreadCount(userId: string): number {
  return (
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .get()?.n ?? 0
  );
}

export function markRead(userId: string, notificationId: string) {
  db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .run();
}

export function markAllRead(userId: string) {
  db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .run();
}

/**
 * Borrar es definitivo (como en Facebook): la campana queda limpia y lo que
 * llegue después es realmente nuevo. Lo importante sigue en la bitácora de
 * auditoría y en cada pantalla (cola de calificación, certificados…).
 */
export function deleteNotification(userId: string, notificationId: string): number {
  return db
    .delete(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .run().changes;
}

export function deleteAllNotifications(userId: string): number {
  return db.delete(notifications).where(eq(notifications.userId, userId)).run().changes;
}
