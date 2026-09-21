import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { enrollStudents, unenrollStudent, listCourseStudents, restoreEnrollments } from "./courses";
import { courseProgress, getEnrollment } from "./progress";
import { BOM, csvLine, parseCsv, columnGetter } from "./csv-core";
import { audit } from "./audit";

/**
 * Gestión masiva de matrícula por CSV:
 * export → columna "accion" → import aplica (matricular | quitar | mantener).
 *
 * Columnas: correo, nombre (informativa), progreso (informativa),
 *   estado (informativa), accion = matricular | quitar | (vacío = mantener)
 */

export function exportRosterCsv(courseId: string): string {
  const students = listCourseStudents(courseId);
  const lines = [csvLine(["correo", "nombre", "progreso", "estado", "accion"])];
  for (const s of students) {
    const summary = courseProgress(courseId, s.studentId);
    lines.push(
      csvLine([
        s.email,
        s.fullName,
        `${summary.percent}%`,
        s.status === "completed" ? "Aprobado" : "Activo",
        "",
      ])
    );
  }
  return BOM + lines.join("\r\n");
}

export const ROSTER_CSV_TEMPLATE =
  BOM +
  [
    csvLine(["correo", "accion"]),
    csvLine(["laura.perez@empresa.com", "matricular"]),
    csvLine(["juan.gomez@empresa.com", "quitar"]),
  ].join("\r\n");

export type RosterCsvRow = {
  line: number;
  email: string;
  action: "enroll" | "unenroll";
  status: "ok" | "noop" | "invalid";
  message: string;
  studentId?: string;
};

function analyze(courseId: string, csvText: string): RosterCsvRow[] {
  const parsed = parseCsv(csvText, { maxRows: 5000 });
  const col = columnGetter(parsed.headers, {
    correo: ["correo", "email"],
    accion: ["accion", "acción", "action"],
  });
  if (!col.has("correo") || !col.has("accion")) {
    throw new Error('El archivo debe tener columnas "correo" y "accion" (matricular/quitar)');
  }

  const currentRoster = new Set(listCourseStudents(courseId).map((s) => s.email));
  const seen = new Set<string>();
  const rows: RosterCsvRow[] = [];

  for (const { line, cells } of parsed.rows) {
    const email = col.get(cells, "correo").toLowerCase().trim();
    const actionRaw = col.get(cells, "accion").toLowerCase().trim();
    const push = (r: Omit<RosterCsvRow, "line" | "email">) => rows.push({ line, email, ...r });

    if (!actionRaw) continue; // mantener: se ignora en silencio

    const action =
      actionRaw === "matricular" || actionRaw === "inscribir"
        ? ("enroll" as const)
        : actionRaw === "quitar" || actionRaw === "desmatricular" || actionRaw === "baja"
          ? ("unenroll" as const)
          : null;
    if (!action) {
      push({ action: "enroll", status: "invalid", message: `Acción desconocida "${actionRaw}" (usa matricular o quitar)` });
      continue;
    }
    if (!email.includes("@")) {
      push({ action, status: "invalid", message: "Correo inválido" });
      continue;
    }
    if (seen.has(email)) {
      push({ action, status: "invalid", message: "Correo repetido en el archivo" });
      continue;
    }
    seen.add(email);

    const user = db
      .select({ id: users.id, role: users.role, active: users.active })
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (!user) {
      push({ action, status: "invalid", message: "No existe una cuenta con este correo (créala primero en Estudiantes → Importar CSV)" });
      continue;
    }
    if (user.role !== "student") {
      push({ action, status: "invalid", message: "Esta cuenta no es de estudiante" });
      continue;
    }

    const isEnrolled = currentRoster.has(email);
    if (action === "enroll" && isEnrolled) {
      push({ action, status: "noop", message: "Ya estaba matriculado" });
    } else if (action === "unenroll" && !isEnrolled) {
      push({ action, status: "noop", message: "No estaba matriculado" });
    } else {
      push({
        action,
        status: "ok",
        message: action === "enroll" ? "Se matriculará" : "Se dará de baja",
        studentId: user.id,
      });
    }
  }

  return rows;
}

export function validateRosterCsv(courseId: string, csvText: string) {
  const rows = analyze(courseId, csvText);
  return {
    rows,
    toEnroll: rows.filter((r) => r.status === "ok" && r.action === "enroll").length,
    toUnenroll: rows.filter((r) => r.status === "ok" && r.action === "unenroll").length,
    noop: rows.filter((r) => r.status === "noop").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
  };
}

export function importRosterCsv(opts: {
  actorId: string;
  courseId: string;
  csvText: string;
}): { enrolled: number; unenrolled: number } {
  const rows = analyze(opts.courseId, opts.csvText).filter((r) => r.status === "ok");

  // Un estudiante dado de baja conserva su fila (unique course+student):
  // re-matricular = reactivar esa fila, no insertar otra.
  let enrolled = 0;
  const toInsert: string[] = [];
  for (const row of rows) {
    if (row.action !== "enroll" || !row.studentId) continue;
    if (reactivateDropped(opts.courseId, row.studentId)) enrolled++;
    else toInsert.push(row.studentId);
  }
  if (toInsert.length) enrolled += enrollStudents(opts.courseId, toInsert, opts.actorId);

  let unenrolled = 0;
  for (const row of rows) {
    if (row.action === "unenroll" && row.studentId) {
      unenrollStudent(opts.courseId, row.studentId);
      unenrolled++;
    }
  }

  audit(opts.actorId, "import_roster_csv", "enrollments", opts.courseId, { enrolled, unenrolled });
  return { enrolled, unenrolled };
}

/** Reactivar matrícula dada de baja al re-matricular por CSV. */
export function reactivateDropped(courseId: string, studentId: string): boolean {
  // Solo el ciclo vigente, y restaurando el estatus que tenía (un aprobado
  // vuelve como aprobado): misma regla que la papelera
  const current = getEnrollment(courseId, studentId);
  if (!current || current.status !== "dropped") return false;
  return restoreEnrollments([current.id]) > 0;
}
