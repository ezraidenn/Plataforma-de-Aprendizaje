"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/guards";
import { generateTempPassword } from "@/server/auth/passwords";
import {
  adminChangeRole,
  adminCreateUser,
  adminResetPassword,
  adminSetActive,
  adminSetCanEditBranding,
  type Role,
} from "@/server/services/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: Role[] = ["admin", "teacher", "student"];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Genera una contraseña temporal legible (el hash argon2 vive solo en el servidor). */
export async function newAdminTempPasswordAction(): Promise<{ password: string }> {
  await requireAdmin();
  return { password: generateTempPassword() };
}

export type AdminCreateUserResult = { ok: true; userId: string } | { error: string };

export async function adminCreateUserAction(input: {
  fullName: string;
  email: string;
  password: string;
  role: Role;
}): Promise<AdminCreateUserResult> {
  const actor = await requireAdmin();

  const fullName = input.fullName?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!fullName) return { error: "Escribe el nombre de la persona" };
  if (!email || !EMAIL_RE.test(email)) return { error: "El correo no es válido" };
  if (!input.password || input.password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres" };
  }
  if (!ROLES.includes(input.role)) return { error: "Elige un rol válido" };

  try {
    const userId = await adminCreateUser({
      actorId: actor.id,
      fullName,
      email,
      password: input.password,
      role: input.role,
    });
    revalidatePath("/admin/users");
    revalidatePath("/admin/settings");
    return { ok: true, userId };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo crear el usuario. Intenta de nuevo.") };
  }
}

export type AdminResetPasswordResult = { ok: true; password: string } | { error: string };

/** Genera y asigna una contraseña temporal; se muestra UNA sola vez. Cierra las sesiones del usuario. */
export async function adminResetPasswordAction(userId: string): Promise<AdminResetPasswordResult> {
  const actor = await requireAdmin();
  try {
    const password = generateTempPassword();
    await adminResetPassword(actor.id, userId, password);
    revalidatePath("/admin/users");
    return { ok: true, password };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo restablecer la contraseña. Intenta de nuevo.") };
  }
}

export type AdminSetActiveResult = { ok: true } | { error: string };

export async function adminSetActiveAction(
  userId: string,
  active: boolean
): Promise<AdminSetActiveResult> {
  const actor = await requireAdmin();
  try {
    adminSetActive(actor.id, userId, active);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo cambiar el estado de la cuenta. Intenta de nuevo.") };
  }
}

export async function adminSetCanEditBrandingAction(
  userId: string,
  allowed: boolean
): Promise<{ ok: true } | { error: string }> {
  const actor = await requireAdmin();
  try {
    adminSetCanEditBranding(actor.id, userId, allowed);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo cambiar el permiso. Intenta de nuevo.") };
  }
}

export type AdminChangeRoleResult = { ok: true } | { error: string };

export async function adminChangeRoleAction(
  userId: string,
  role: Role
): Promise<AdminChangeRoleResult> {
  const actor = await requireAdmin();
  if (!ROLES.includes(role)) return { error: "Elige un rol válido" };
  try {
    adminChangeRole(actor.id, userId, role);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo cambiar el rol. Intenta de nuevo.") };
  }
}
