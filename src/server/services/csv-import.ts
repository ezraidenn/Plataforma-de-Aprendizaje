import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { createStudent, enrollStudents } from "./courses";
import { findOrCreateCohort } from "./cohorts";
import { BOM, csvLine } from "./csv-core";
import { generateTempPassword } from "@/server/auth/passwords";
import { normalizeStudentEmail, normalizeStudentName } from "@/lib/student-draft";
import { audit } from "./audit";

// ─── Parseo y validación ─────────────────────────────────────────────────────

export type CsvRow = {
  line: number;
  fullName: string;
  email: string;
  password: string; // generada si venía vacía
  passwordGenerated: boolean;
  status: "ok" | "duplicate" | "invalid";
  message: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 5000;

/** Parser CSV simple con soporte de comillas (suficiente para la plantilla). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === "," || ch === ";") {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim());
}

export const CSV_TEMPLATE =
  "﻿nombre,correo,contrasena\r\n" +
  "Laura Pérez,laura.perez@empresa.com,\r\n" +
  "Juan Gómez,juan.gomez@empresa.com,MiClave123\r\n";

/**
 * Valida el CSV completo (paso "Revisar" del asistente). No escribe nada.
 * Columnas: nombre, correo, contrasena (opcional — vacía = se genera).
 */
export function validateStudentsCsv(text: string): {
  rows: CsvRow[];
  ok: number;
  duplicates: number;
  invalid: number;
} {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("El archivo está vacío");
  if (lines.length > MAX_ROWS + 1) throw new Error(`Máximo ${MAX_ROWS} estudiantes por importación`);

  // Encabezado opcional: se detecta si la primera línea no trae un email válido
  const first = parseCsvLine(lines[0]);
  const hasHeader = !EMAIL_RE.test(first[1] ?? "");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const seenEmails = new Set<string>();
  const rows: CsvRow[] = dataLines.map((line, idx) => {
    const lineNo = idx + (hasHeader ? 2 : 1);
    const cols = parseCsvLine(line);
    const fullName = cols[0] ?? "";
    const email = (cols[1] ?? "").toLowerCase();
    const givenPassword = cols[2] ?? "";

    const base = {
      line: lineNo,
      fullName,
      email,
      password: givenPassword || generateTempPassword(),
      passwordGenerated: !givenPassword,
    };

    if (!fullName || fullName.length < 3) {
      return { ...base, status: "invalid" as const, message: "Falta el nombre" };
    }
    if (!EMAIL_RE.test(email)) {
      return { ...base, status: "invalid" as const, message: "Correo inválido" };
    }
    if (givenPassword && givenPassword.length < 8) {
      return { ...base, status: "invalid" as const, message: "La contraseña debe tener al menos 8 caracteres" };
    }
    if (seenEmails.has(email)) {
      return { ...base, status: "invalid" as const, message: "Correo repetido en el archivo" };
    }
    seenEmails.add(email);

    const exists = db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (exists) {
      // Un correo de maestro o admin no es un duplicado de alumno: no se inscribirá
      if (exists.role !== "student") {
        return {
          ...base,
          status: "invalid" as const,
          message: "Ese correo pertenece a una cuenta de personal",
        };
      }
      return { ...base, status: "duplicate" as const, message: "Ya existe una cuenta con este correo" };
    }
    return { ...base, status: "ok" as const, message: "Se creará" };
  });

  return {
    rows,
    ok: rows.filter((r) => r.status === "ok").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
  };
}

// ─── Filas ya revisadas (importar con IA) ────────────────────────────────────

/**
 * Filas → CSV de esta importación (contraseña vacía = se genera), para que
 * pasen por las MISMAS reglas que un CSV subido.
 */
export function studentRowsToCsv(rows: { fullName: string; email: string }[]): string {
  // Con encabezado SIEMPRE: si la primera fila trajera un correo inválido, sin
  // él se tomaría por encabezado y se perdería
  const lines = [csvLine(["nombre", "correo", "contrasena"])];
  for (const r of rows) {
    lines.push(csvLine([normalizeStudentName(r.fullName), normalizeStudentEmail(r.email), ""]));
  }
  return BOM + lines.join("\r\n");
}

/**
 * Grupo que traía cada fila → grupo del curso (creándolo si no existe; uno
 * CERRADO se rechaza). Devuelve correo → id del grupo; sin grupo, sin entrada.
 */
export function cohortsForRows(
  courseId: string,
  rows: { email: string; group?: string }[],
  actorId: string
): Record<string, string> {
  const byEmail: Record<string, string> = {};
  const idByName = new Map<string, string>();
  for (const r of rows) {
    const name = normalizeStudentName(r.group ?? "");
    if (!name) continue;
    const key = name.toLowerCase();
    if (!idByName.has(key)) idByName.set(key, findOrCreateCohort(courseId, name, actorId));
    byEmail[normalizeStudentEmail(r.email)] = idByName.get(key)!;
  }
  return byEmail;
}

// ─── Importación (paso final) ────────────────────────────────────────────────

export type ImportResult = {
  created: number;
  skipped: number;
  enrolled: number;
  /** CSV de resultado con las credenciales generadas (descargable UNA vez) */
  resultCsv: string;
};

function csvEscape(s: string): string {
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Importa las filas válidas (revalida contra la BD por si cambió algo entre
 * pasos). `enrollCourseId` opcional: matricula a los creados Y a los
 * duplicados existentes en ese curso.
 */
export async function importStudents(opts: {
  csvText: string;
  createdBy: string;
  /** Quién ejecuta (auditoría y matrícula); por defecto, createdBy */
  actorId?: string;
  enrollCourseId?: string | null;
  enrollDuplicates?: boolean;
  /** Grupo del curso de cada correo (importar con IA); sin entrada = sin grupo */
  cohortByEmail?: Record<string, string>;
  /** Acción de auditoría (por defecto «import_csv») */
  auditAction?: string;
}): Promise<ImportResult> {
  const { rows } = validateStudentsCsv(opts.csvText);

  const resultLines = ["﻿nombre,correo,contrasena,resultado"];
  const toEnroll: { id: string; email: string }[] = [];
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.status === "invalid") {
      skipped++;
      resultLines.push(
        [row.fullName, row.email, "", `Omitido: ${row.message}`].map(csvEscape).join(",")
      );
      continue;
    }
    if (row.status === "duplicate") {
      skipped++;
      const existing = db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, row.email))
        .get();
      // Solo cuentas de alumno: un correo de maestro o admin no se inscribe como alumno
      if (existing?.role === "student" && opts.enrollDuplicates && opts.enrollCourseId) {
        toEnroll.push({ id: existing.id, email: row.email });
      }
      resultLines.push(
        [row.fullName, row.email, "", "Omitido: ya existía"].map(csvEscape).join(",")
      );
      continue;
    }
    try {
      const id = await createStudent({
        fullName: row.fullName,
        email: row.email,
        password: row.password,
        createdBy: opts.createdBy,
      });
      created++;
      toEnroll.push({ id, email: row.email });
      resultLines.push(
        [
          row.fullName,
          row.email,
          row.passwordGenerated ? row.password : "(la que venía en el archivo)",
          "Creado",
        ]
          .map(csvEscape)
          .join(",")
      );
    } catch (err) {
      skipped++;
      resultLines.push(
        [row.fullName, row.email, "", `Omitido: ${err instanceof Error ? err.message : "error"}`]
          .map(csvEscape)
          .join(",")
      );
    }
  }

  let enrolled = 0;
  if (opts.enrollCourseId && toEnroll.length > 0) {
    // Una matrícula por grupo (sin grupos, todos juntos como siempre)
    const byCohort = new Map<string | null, string[]>();
    for (const s of toEnroll) {
      const cohortId = opts.cohortByEmail?.[s.email] ?? null;
      byCohort.set(cohortId, [...(byCohort.get(cohortId) ?? []), s.id]);
    }
    for (const [cohortId, ids] of byCohort) {
      enrolled += enrollStudents(opts.enrollCourseId, ids, opts.actorId ?? opts.createdBy, { cohortId });
    }
  }

  audit(opts.actorId ?? opts.createdBy, opts.auditAction ?? "import_csv", "users", undefined, {
    created,
    skipped,
    enrolled,
    courseId: opts.enrollCourseId ?? null,
    ...(opts.actorId && opts.createdBy !== opts.actorId ? { onBehalfOf: opts.createdBy } : {}),
  });

  return { created, skipped, enrolled, resultCsv: resultLines.join("\r\n") };
}
