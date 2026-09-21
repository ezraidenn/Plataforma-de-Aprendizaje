import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { auditLog, users } from "@/server/db/schema";

/** Registro de auditoría: quién hizo qué y sobre qué entidad. Nunca lanza. */
export function audit(
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string,
  detail?: Record<string, unknown>
) {
  try {
    db.insert(auditLog)
      .values({ id: nanoid(), userId, action, entity, entityId: entityId ?? null, detail: detail ?? null })
      .run();
  } catch (err) {
    console.error("[audit] no se pudo registrar:", err);
  }
}

export function listAuditLog(opts: { page?: number; pageSize?: number; entity?: string }) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 50);
  const where = opts.entity ? eq(auditLog.entity, opts.entity) : undefined;

  const rows = db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      userName: users.fullName,
      userEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const total = db.select({ n: sql<number>`COUNT(*)` }).from(auditLog).where(where).get()?.n ?? 0;
  return { rows, total, page, pageSize };
}

export function auditEntities(): string[] {
  return db
    .selectDistinct({ entity: auditLog.entity })
    .from(auditLog)
    .all()
    .map((r) => r.entity)
    .sort();
}
