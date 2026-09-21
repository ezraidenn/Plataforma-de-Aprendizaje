import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "../../src/server/db";
import { certificates, courseItems, courses, notifications } from "../../src/server/db/schema";
import { deleteCourse } from "../../src/server/services/courses";
import { enqueueJob } from "../../src/server/jobs/queue";

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

/**
 * Los cursos «Curso demo…» de los smokes viven en la base real y se quedaban a
 * la vista del maestro demo. Al terminar bien, cada prueba borra los suyos (por
 * título exacto y dueño): antes sus certificados de prueba, que deleteCourse
 * protege, y todos los avisos del curso, que sin él quedarían huérfanos.
 * Devuelve cuántos cursos borró.
 */
export function removeDemoCourses(titles: string[], ownerId: string): number {
  if (titles.length === 0) return 0;
  const found = db
    .select({ id: courses.id })
    .from(courses)
    .where(and(inArray(courses.title, titles), eq(courses.ownerId, ownerId)))
    .all();
  for (const { id } of found) {
    db.transaction(() => {
      const pdfIds = db
        .select({ fileId: certificates.pdfFileId })
        .from(certificates)
        .where(eq(certificates.courseId, id))
        .all()
        .flatMap((c) => (c.fileId ? [c.fileId] : []));
      db.delete(certificates).where(eq(certificates.courseId, id)).run();
      const itemIds = db
        .select({ id: courseItems.id })
        .from(courseItems)
        .where(eq(courseItems.courseId, id))
        .all()
        .map((r) => r.id);
      db.delete(notifications)
        .where(
          or(
            eq(sql`json_extract(${notifications.payload}, '$.courseId')`, id),
            itemIds.length ? inArray(sql`json_extract(${notifications.payload}, '$.itemId')`, itemIds) : undefined
          )
        )
        .run();
      deleteCourse(id);
      // Ya nadie apunta al PDF de esos certificados: el worker lo retira del disco
      if (pdfIds.length) enqueueJob("cleanup_files", { fileIds: pdfIds });
    });
  }
  return found.length;
}
