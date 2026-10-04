import "server-only";
import { createHash, createHmac } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db";
import { accountTokens, users } from "@/server/db/schema";

/**
 * Enlaces de un solo uso para crear o restablecer la contraseña.
 *
 * El token se deriva del id del correo con APP_SECRET: si el envío se
 * reintenta, sale el mismo enlace (el servicio deduplica por la llave de
 * idempotencia y el correo que llegó sigue sirviendo). En la base solo queda su
 * SHA-256, nunca el token en claro.
 */

export type TokenPurpose = "invite" | "reset";

function secret(): string {
  return process.env.APP_SECRET ?? "dev-secret";
}

export function tokenFor(mailId: string, purpose: TokenPurpose): string {
  return createHmac("sha256", secret()).update(`cuenta:${purpose}:${mailId}`).digest("base64url").slice(0, 43);
}

export function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Da de alta el enlace del correo `mailId` y anula los anteriores sin usar del
 * mismo tipo (el último correo es el que vale). `expiresAt` null = no caduca.
 */
export function issueToken(opts: {
  userId: string;
  purpose: TokenPurpose;
  mailId: string;
  expiresAt: Date | null;
}): string {
  const token = tokenFor(opts.mailId, opts.purpose);
  const id = tokenId(token);
  db.transaction(() => {
    db.delete(accountTokens)
      .where(
        and(
          eq(accountTokens.userId, opts.userId),
          eq(accountTokens.purpose, opts.purpose),
          isNull(accountTokens.usedAt),
          ne(accountTokens.id, id)
        )
      )
      .run();
    db.insert(accountTokens)
      .values({ id, userId: opts.userId, purpose: opts.purpose, expiresAt: opts.expiresAt })
      .onConflictDoNothing()
      .run();
  });
  return token;
}

export type TokenCheck =
  | { ok: true; id: string; userId: string; purpose: TokenPurpose; fullName: string; email: string; role: "admin" | "teacher" | "student" }
  | { ok: false; reason: "invalido" | "usado" | "vencido" };

/** Revisa un enlace sin gastarlo (para mostrar la pantalla). */
export function checkToken(token: string | null | undefined, now = Date.now()): TokenCheck {
  if (!token || token.length < 20 || token.length > 100) return { ok: false, reason: "invalido" };
  const row = db
    .select({
      id: accountTokens.id,
      userId: accountTokens.userId,
      purpose: accountTokens.purpose,
      expiresAt: accountTokens.expiresAt,
      usedAt: accountTokens.usedAt,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      active: users.active,
    })
    .from(accountTokens)
    .innerJoin(users, eq(accountTokens.userId, users.id))
    .where(eq(accountTokens.id, tokenId(token)))
    .get();
  if (!row || !row.active) return { ok: false, reason: "invalido" };
  if (row.usedAt) return { ok: false, reason: "usado" };
  if (row.expiresAt && row.expiresAt.getTime() < now) return { ok: false, reason: "vencido" };
  return { ok: true, id: row.id, userId: row.userId, purpose: row.purpose, fullName: row.fullName, email: row.email, role: row.role };
}

/**
 * Gasta el enlace y anula todos los demás de la persona (invitación y
 * restablecimiento): con la contraseña nueva ya no hacen falta.
 */
export function consumeToken(id: string, userId: string): boolean {
  return db.transaction(() => {
    // Solo uno gana si se manda dos veces a la vez
    const r = db
      .update(accountTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(accountTokens.id, id), isNull(accountTokens.usedAt)))
      .run();
    if (r.changes === 0) return false;
    db.delete(accountTokens)
      .where(and(eq(accountTokens.userId, userId), isNull(accountTokens.usedAt)))
      .run();
    return true;
  });
}
