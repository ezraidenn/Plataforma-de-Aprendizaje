import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { eq, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { nanoid } from "nanoid";
import { VIEW_COOKIE } from "@/lib/view-context";

export const SESSION_COOKIE = "session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días
const RENEW_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 15; // renovar si quedan < 15 días

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "teacher" | "student";
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = nanoid(40);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  db.insert(sessions)
    .values({
      id: tokenHash,
      userId,
      expiresAt,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    })
    .run();

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // LAN sin TLS; activar si se agrega HTTPS
    path: "/",
    expires: expiresAt,
  });
  // Cada ingreso arranca en «Mi contenido»
  cookieStore.delete(VIEW_COOKIE);
}

/**
 * Valida la sesión de la petición actual. Cacheada por request:
 * múltiples llamadas en un mismo render hacen una sola consulta.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, tokenHash))
    .get();

  if (!row || !row.active) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, tokenHash)).run();
    return null;
  }

  // Renovación deslizante
  if (row.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
    db.update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DURATION_MS) })
      .where(eq(sessions.id, tokenHash))
      .run();
  }

  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
});

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = await sha256Hex(token);
    db.delete(sessions).where(eq(sessions.id, tokenHash)).run();
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(VIEW_COOKIE);
}

export function purgeExpiredSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}
