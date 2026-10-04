"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { checkToken, consumeToken } from "@/server/mail/tokens";
import { queueMail, requestPasswordReset } from "@/server/mail/outbox";
import { audit } from "@/server/services/audit";
import { hashPassword } from "./passwords";
import { createSession } from "./sessions";
import { homeFor } from "./guards";

export type SetPasswordState = { error?: string };

const TOKEN_ERRORS = {
  invalido: "El enlace no es válido. Pide uno nuevo a tu instructor o desde «¿Olvidaste tu contraseña?».",
  usado: "Este enlace ya se usó. Entra con tu contraseña o pide uno nuevo desde «¿Olvidaste tu contraseña?».",
  vencido: "El enlace venció. Pide uno nuevo desde «¿Olvidaste tu contraseña?».",
} as const;

/**
 * Crear contraseña (bienvenida) o elegir una nueva (restablecer) con el enlace
 * del correo. Gasta el enlace, cierra las sesiones anteriores y deja dentro.
 */
export async function setPasswordWithTokenAction(
  _prev: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const check = checkToken(token);
  if (!check.ok) return { error: TOKEN_ERRORS[check.reason] };
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };
  if (password.length > 200) return { error: "La contraseña es demasiado larga." };
  if (password !== confirm) return { error: "Las dos contraseñas no coinciden." };

  const passwordHash = await hashPassword(password);
  if (!consumeToken(check.id, check.userId)) return { error: TOKEN_ERRORS.usado };

  const now = new Date();
  db.update(users).set({ passwordHash, updatedAt: now, lastLoginAt: now }).where(eq(users.id, check.userId)).run();
  // La contraseña anterior deja de servir de verdad: sesiones abiertas fuera
  db.delete(sessions).where(eq(sessions.userId, check.userId)).run();
  audit(check.userId, check.purpose === "invite" ? "accept_invite" : "reset_password_link", "users", check.userId);
  if (check.purpose === "reset") {
    queueMail({ kind: "cambio_cuenta", userId: check.userId, payload: { what: "password", at: now.getTime(), account: check.email } });
  }

  const h = await headers();
  await createSession(check.userId, {
    ip: h.get("x-forwarded-for") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  });
  redirect(homeFor(check.role));
}

export type RequestResetState = { sent?: boolean; error?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «¿Olvidaste tu contraseña?»: misma respuesta exista o no la cuenta. */
export async function requestResetAction(_prev: RequestResetState, formData: FormData): Promise<RequestResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Escribe el correo con el que entras." };
  requestPasswordReset(email);
  return { sent: true };
}
