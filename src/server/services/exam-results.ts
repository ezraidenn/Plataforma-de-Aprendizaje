import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { attemptAnswers, courseItems, courses, examAttempts, exams, notifications, questions } from "@/server/db/schema";
import { resultsVisible } from "@/lib/exam-results";
import { IMAGE_QUESTION_TYPES } from "@/lib/image-questions";
import { notify } from "./notifications";

/** Alumnos distintos con al menos un intento enviado o calificado. */
export function studentsWithAttempts(itemId: string): number {
  return (
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${examAttempts.studentId})` })
      .from(examAttempts)
      .where(and(eq(examAttempts.examItemId, itemId), inArray(examAttempts.status, ["submitted", "graded"])))
      .get()?.n ?? 0
  );
}

/**
 * Preguntas sobre imagen del examen con respuestas ya guardadas en intentos EN
 * CURSO (los enviados los cuenta `studentsWithAttempts`): en el editor,
 * cambiar, recortar o girar su foto pide confirmación. Las de otros tipos no
 * tienen foto: no se cuentan.
 */
export function questionsAnsweredInProgress(itemId: string): string[] {
  return db
    .selectDistinct({ id: attemptAnswers.questionId })
    .from(attemptAnswers)
    .innerJoin(examAttempts, eq(examAttempts.id, attemptAnswers.attemptId))
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .where(
      and(
        eq(examAttempts.examItemId, itemId),
        eq(examAttempts.status, "in_progress"),
        inArray(questions.type, [...IMAGE_QUESTION_TYPES])
      )
    )
    .all()
    .map((r) => r.id);
}

/**
 * Avisa «Tus resultados ya están disponibles» a cada alumno con un intento
 * calificado, una sola vez por alumno y examen. Quien solo tiene intentos en
 * revisión recibe «Calificación publicada» al terminar de calificarlo (para
 * entonces ya son visibles). Devuelve cuántos avisos envió.
 */
export function notifyResultsAvailable(itemId: string): number {
  const item = db
    .select({ title: courseItems.title, courseId: courseItems.courseId })
    .from(courseItems)
    .where(eq(courseItems.id, itemId))
    .get();
  if (!item) return 0;

  const graded = db
    .selectDistinct({ studentId: examAttempts.studentId })
    .from(examAttempts)
    .where(and(eq(examAttempts.examItemId, itemId), eq(examAttempts.status, "graded")))
    .all();

  let sent = 0;
  for (const { studentId } of graded) {
    const already = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, studentId),
          eq(notifications.type, "results_available"),
          sql`json_extract(${notifications.payload}, '$.itemId') = ${itemId}`
        )
      )
      .get();
    if (already) continue;
    notify(studentId, "results_available", { courseId: item.courseId, itemId, itemTitle: item.title });
    sent++;
  }
  return sent;
}

/**
 * «Publicar resultados» / «Ocultar» del maestro. Publicar avisa en ese
 * momento; ocultar deja el aviso por cierre pendiente otra vez (sin repetirlo
 * a quien ya lo recibió). Los avisos enviados no se retiran.
 */
export function setExamResultsPublished(itemId: string, published: boolean): { notified: number } {
  const exam = db.select().from(exams).where(eq(exams.itemId, itemId)).get();
  if (!exam) throw new Error("No encontramos este examen");
  if (exam.showResultsMode === "immediately") {
    throw new Error("Este examen ya muestra los resultados al enviar");
  }

  if (!published) {
    db.update(exams)
      .set({ resultsPublishedAt: null, resultsNotifiedAt: null })
      .where(eq(exams.itemId, itemId))
      .run();
    return { notified: 0 };
  }

  if (exam.resultsPublishedAt === null) {
    const now = new Date();
    db.update(exams)
      .set({ resultsPublishedAt: now, resultsNotifiedAt: now })
      .where(eq(exams.itemId, itemId))
      .run();
  }
  return { notified: notifyResultsAvailable(itemId) };
}

/**
 * Pase del worker: exámenes «al cierre» que ya cerraron y aún no avisan.
 * Marca cada uno para no volver a revisarlo. Devuelve cuántos avisos envió.
 */
export function runResultsAvailable(now = Date.now()): number {
  const due = db
    .select({ itemId: exams.itemId })
    .from(exams)
    .innerJoin(courseItems, eq(exams.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .where(
      and(
        eq(exams.showResultsMode, "after_close"),
        lte(exams.closesAt, new Date(now)),
        isNull(exams.resultsNotifiedAt),
        eq(courses.status, "published")
      )
    )
    .all();

  let sent = 0;
  for (const { itemId } of due) {
    sent += notifyResultsAvailable(itemId);
    db.update(exams).set({ resultsNotifiedAt: new Date(now) }).where(eq(exams.itemId, itemId)).run();
  }
  return sent;
}

/** Exámenes del curso cuyas calificaciones el alumno aún no puede ver. */
export function hiddenResultsExamIds(courseId: string, now = Date.now()): Set<string> {
  const rows = db
    .select({ exam: exams })
    .from(exams)
    .innerJoin(courseItems, eq(exams.itemId, courseItems.id))
    .where(eq(courseItems.courseId, courseId))
    .all();
  return new Set(rows.filter((r) => !resultsVisible(r.exam, now)).map((r) => r.exam.itemId));
}
