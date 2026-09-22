import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/auth/passwords";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { audit } from "./audit";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getOwnProfile(userId: string) {
  return db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      canEditBranding: users.canEditBranding,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/** ¿Puede editar la identidad de la empresa? admin siempre; maestro con permiso. */
export function canEditBranding(user: { id: string; role: string }): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "teacher") return false;
  return !!db.select({ v: users.canEditBranding }).from(users).where(eq(users.id, user.id)).get()?.v;
}

/**
 * Cambio de contraseña propio: exige la actual y cierra las demás sesiones
 * (la actual se conserva para no expulsar al usuario).
 */
export async function changeOwnPassword(opts: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const user = db.select().from(users).where(eq(users.id, opts.userId)).get();
  if (!user) throw new Error("Usuario no encontrado");
  if (opts.newPassword.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres");
  if (opts.newPassword === opts.currentPassword) throw new Error("La nueva contraseña debe ser distinta a la actual");
  const ok = await verifyPassword(user.passwordHash, opts.currentPassword);
  if (!ok) throw new Error("La contraseña actual no es correcta");

  const passwordHash = await hashPassword(opts.newPassword);
  db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, opts.userId)).run();

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const currentHash = token ? await sha256Hex(token) : null;
  if (currentHash) {
    db.delete(sessions).where(and(eq(sessions.userId, opts.userId), ne(sessions.id, currentHash))).run();
  } else {
    db.delete(sessions).where(eq(sessions.userId, opts.userId)).run();
  }
  audit(opts.userId, "change_own_password", "user", opts.userId);
}

/** Solo maestro/admin pueden cambiar su nombre (los estudiantes no). */
export function updateOwnName(user: { id: string; role: string }, fullName: string) {
  if (user.role === "student") throw new Error("Los estudiantes no pueden cambiar su nombre");
  const name = fullName.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 80) throw new Error("El nombre debe tener entre 3 y 80 caracteres");
  db.update(users).set({ fullName: name, updatedAt: new Date() }).where(eq(users.id, user.id)).run();
  audit(user.id, "update_own_name", "user", user.id, { fullName: name });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Cambio de correo propio (solo maestro/admin, como el nombre). El correo es
 * el usuario de acceso, así que exige la contraseña actual.
 */
export async function updateOwnEmail(opts: {
  user: { id: string; role: string };
  email: string;
  currentPassword: string;
}) {
  if (opts.user.role === "student") throw new Error("Los estudiantes no pueden cambiar su correo");
  const email = opts.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("El correo no es válido");

  const row = db.select().from(users).where(eq(users.id, opts.user.id)).get();
  if (!row) throw new Error("Usuario no encontrado");
  if (row.email === email) return;
  const ok = await verifyPassword(row.passwordHash, opts.currentPassword);
  if (!ok) throw new Error("La contraseña actual no es correcta");
  const taken = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, row.id)))
    .get();
  if (taken) throw new Error("Ya existe un usuario con ese correo");

  db.update(users).set({ email, updatedAt: new Date() }).where(eq(users.id, row.id)).run();
  audit(row.id, "update_own_email", "user", row.id, { from: row.email, to: email });
}
