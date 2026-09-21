/**
 * Dos alumnos de demostración para las capturas de la guía:
 *  - guia.examen@empresa.local: todo completado hasta ANTES del examen parcial (puede presentarlo)
 *  - guia.tarea@empresa.local: todo completado hasta ANTES de la tarea (puede entregarla)
 * Contraseña: demo1234. Idempotente.
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/seed-guide-students.ts
 */
import { eq, like } from "drizzle-orm";
import { db } from "@/server/db";
import { courses, itemProgress, users } from "@/server/db/schema";
import { createStudent, enrollStudents } from "@/server/services/courses";
import { linearOrder } from "@/server/services/tree";
import { ensureItemProgress, getEnrollment } from "@/server/services/progress";

const courseRow = db.select().from(courses).where(like(courses.title, "Uso y Manejo%")).get();
if (!courseRow) throw new Error("No existe el curso demo");
const course = courseRow;
const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
const order = linearOrder(course.id);

async function ensureStudent(email: string, fullName: string) {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return existing.id;
  return createStudent({ fullName, email, password: "demo1234", createdBy: teacher.id });
}

function completeUntil(studentId: string, stopKind: "exam" | "assignment") {
  const enrollment = getEnrollment(course.id, studentId)!;
  const now = new Date();
  for (const item of order) {
    if (item.kind === stopKind) break;
    const ip = ensureItemProgress(enrollment.id, item.id);
    db.update(itemProgress)
      .set({ status: "completed", percent: 100, completedAt: ip.completedAt ?? now, lastActivityAt: now, updatedAt: now })
      .where(eq(itemProgress.id, ip.id))
      .run();
  }
}

(async () => {
  const a = await ensureStudent("guia.examen@empresa.local", "Alumno Guía (examen)");
  const b = await ensureStudent("guia.tarea@empresa.local", "Alumna Guía (tarea)");
  enrollStudents(course.id, [a, b], teacher.id);
  completeUntil(a, "exam");
  completeUntil(b, "assignment");
  console.log("✓ guia.examen@empresa.local listo para el examen · guia.tarea@empresa.local lista para la tarea (demo1234)");
})();
