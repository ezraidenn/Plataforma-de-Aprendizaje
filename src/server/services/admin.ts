import "server-only";
import { matchesSearch } from "@/server/db/search";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { users, courses, enrollments, jobs, files, sessions } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/passwords";
import { storageRoot } from "./storage";
import { audit } from "./audit";

export type Role = "admin" | "teacher" | "student";

// ─── Usuarios (todos los roles) ──────────────────────────────────────────────

export function adminListUsers(opts: {
  search?: string;
  role?: Role | "all";
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 50);
  const term = opts.search?.trim();

  const conditions = [] as ReturnType<typeof eq>[];
  if (opts.role && opts.role !== "all") conditions.push(eq(users.role, opts.role));
  const where = and(
    ...(conditions.length ? conditions : [sql`1=1`]),
    term
      ? matchesSearch(term, [users.fullName, users.email])!
      : sql`1=1`
  );

  const rows = db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      active: users.active,
      canEditBranding: users.canEditBranding,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(users.fullName)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const total = db.select({ n: sql<number>`COUNT(*)` }).from(users).where(where).get()?.n ?? 0;
  return { rows, total, page, pageSize };
}

export async function adminCreateUser(opts: {
  actorId: string;
  fullName: string;
  email: string;
  password: string;
  role: Role;
}) {
  const email = opts.email.trim().toLowerCase();
  if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    throw new Error("Ya existe un usuario con ese correo");
  }
  const id = nanoid();
  db.insert(users)
    .values({
      id,
      email,
      passwordHash: await hashPassword(opts.password),
      fullName: opts.fullName.trim(),
      role: opts.role,
      createdBy: opts.actorId,
    })
    .run();
  audit(opts.actorId, "create_user", "users", id, { role: opts.role, email });
  return id;
}

export async function adminResetPassword(actorId: string, userId: string, newPassword: string) {
  db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId))
    .run();
  // Cerrar todas las sesiones del usuario al resetear
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  audit(actorId, "reset_password", "users", userId);
}

export function adminSetActive(actorId: string, userId: string, active: boolean) {
  if (actorId === userId && !active) {
    throw new Error("No puedes desactivar tu propia cuenta");
  }
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) throw new Error("Usuario no encontrado");

  if (target.role === "admin" && !active) {
    const admins =
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.active, true)))
        .get()?.n ?? 0;
    if (admins <= 1) throw new Error("No puedes desactivar al único administrador activo");
  }

  db.update(users).set({ active, updatedAt: new Date() }).where(eq(users.id, userId)).run();
  if (!active) db.delete(sessions).where(eq(sessions.userId, userId)).run();
  audit(actorId, active ? "activate_user" : "deactivate_user", "users", userId);
}

/** Permiso para editar la identidad de la empresa (solo tiene sentido en maestros). */
export function adminSetCanEditBranding(actorId: string, userId: string, allowed: boolean) {
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) throw new Error("Usuario no encontrado");
  if (target.role !== "teacher") throw new Error("Este permiso solo aplica a maestros");
  db.update(users).set({ canEditBranding: allowed, updatedAt: new Date() }).where(eq(users.id, userId)).run();
  audit(actorId, allowed ? "grant_branding" : "revoke_branding", "users", userId);
}

export function adminChangeRole(actorId: string, userId: string, role: Role) {
  if (actorId === userId) throw new Error("No puedes cambiar tu propio rol");
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) throw new Error("Usuario no encontrado");

  if (target.role === "admin" && role !== "admin") {
    const admins =
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.active, true)))
        .get()?.n ?? 0;
    if (admins <= 1) throw new Error("No puedes quitar el rol al único administrador activo");
  }

  db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId)).run();
  audit(actorId, "change_role", "users", userId, { from: target.role, to: role });
}

// ─── Cursos (todos) ──────────────────────────────────────────────────────────

export function adminListCourses(opts: { search?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 50);
  const term = opts.search?.trim();

  const where = matchesSearch(term, [courses.title]) ?? sql`1=1`;

  const rows = db
    .select({
      course: courses,
      ownerName: users.fullName,
      // Columna externa calificada a mano (ver nota en courses.ts)
      enrolled: sql<number>`(SELECT COUNT(*) FROM enrollments e WHERE e.course_id = "courses"."id" AND e.status != 'dropped')`,
      completed: sql<number>`(SELECT COUNT(*) FROM enrollments e WHERE e.course_id = "courses"."id" AND e.status = 'completed')`,
    })
    .from(courses)
    .innerJoin(users, eq(courses.ownerId, users.id))
    .where(where)
    .orderBy(desc(courses.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const total = db.select({ n: sql<number>`COUNT(*)` }).from(courses).where(where).get()?.n ?? 0;
  return { rows, total, page, pageSize };
}

export function adminReassignCourse(actorId: string, courseId: string, newOwnerId: string) {
  const owner = db.select().from(users).where(eq(users.id, newOwnerId)).get();
  if (!owner || (owner.role !== "teacher" && owner.role !== "admin")) {
    throw new Error("El nuevo dueño debe ser maestro o administrador");
  }
  db.update(courses)
    .set({ ownerId: newOwnerId, updatedAt: new Date() })
    .where(eq(courses.id, courseId))
    .run();
  audit(actorId, "reassign_course", "courses", courseId, { newOwnerId });
}

// ─── Estadísticas y jobs ─────────────────────────────────────────────────────

function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else total += fs.statSync(full).size;
    }
  } catch {
    // carpeta inexistente: 0
  }
  return total;
}

export function platformStats() {
  const count = (table: string) =>
    (db.get(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)) as { n: number } | undefined)?.n ?? 0;

  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "data.db");
  let dbSize = 0;
  try {
    dbSize = fs.statSync(dbPath).size;
  } catch {
    /* sin archivo */
  }

  return {
    users: {
      total: count("users"),
      students: db.select({ n: sql<number>`COUNT(*)` }).from(users).where(eq(users.role, "student")).get()?.n ?? 0,
      teachers: db.select({ n: sql<number>`COUNT(*)` }).from(users).where(eq(users.role, "teacher")).get()?.n ?? 0,
      admins: db.select({ n: sql<number>`COUNT(*)` }).from(users).where(eq(users.role, "admin")).get()?.n ?? 0,
    },
    courses: {
      total: count("courses"),
      published:
        db.select({ n: sql<number>`COUNT(*)` }).from(courses).where(eq(courses.status, "published")).get()?.n ?? 0,
    },
    enrollments: {
      total: count("enrollments"),
      completed:
        db
          .select({ n: sql<number>`COUNT(*)` })
          .from(enrollments)
          .where(eq(enrollments.status, "completed"))
          .get()?.n ?? 0,
    },
    certificates: count("certificates"),
    files: {
      count: count("files"),
      totalBytes:
        db.select({ n: sql<number>`COALESCE(SUM(size_bytes), 0)` }).from(files).get()?.n ?? 0,
    },
    dbSizeBytes: dbSize,
    storageSizeBytes: dirSizeBytes(storageRoot()),
  };
}

export function adminListJobs(limit = 100) {
  return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).all();
}

export function adminRetryJob(actorId: string, jobId: string) {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) throw new Error("Job no encontrado");
  if (job.status !== "error") throw new Error("Solo se reintentan jobs con error");
  db.update(jobs)
    .set({ status: "pending", attempts: 0, errorMessage: null, runAfter: null, finishedAt: null })
    .where(eq(jobs.id, jobId))
    .run();
  audit(actorId, "retry_job", "jobs", jobId, { type: job.type });
}

export { listAuditLog, auditEntities } from "./audit";
