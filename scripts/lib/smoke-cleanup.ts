import { and, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "../../src/server/db";
import { courseItems, notifications } from "../../src/server/db/schema";

// Momento en que arrancó la prueba (este módulo se carga al inicio), con 1 s de
// margen: filas antiguas con created_at por default quedan redondeadas al segundo
const started = new Date(Date.now() - 1000);

/**
 * Las pruebas usan las cuentas demo reales (maestro, Laura…), así que cada
 * corrida llenaba su campana de avisos que parecían «volver». Borra SOLO las
 * notificaciones que esta corrida generó sobre sus cursos de prueba; las de
 * otros cursos (p. ej. de alguien probando la plataforma a la vez) no se tocan.
 */
export function cleanupSmokeNotifications(courseIds: string[]): number {
  if (courseIds.length === 0) return 0;
  const itemIds = db
    .select({ id: courseItems.id })
    .from(courseItems)
    .where(inArray(courseItems.courseId, courseIds))
    .all()
    .map((r) => r.id);
  return db
    .delete(notifications)
    .where(
      and(
        gte(notifications.createdAt, started),
        or(
          inArray(sql`json_extract(${notifications.payload}, '$.courseId')`, courseIds),
          itemIds.length ? inArray(sql`json_extract(${notifications.payload}, '$.itemId')`, itemIds) : undefined
        )
      )
    )
    .run().changes;
}
