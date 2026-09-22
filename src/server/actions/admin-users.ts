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
  adminDeleteUser,
  adminDeleteUserImpact,
  adminUpdateUser,
  type DeleteUserImpact,
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

export type AdminUpdateUserResult = { ok: true } | { error: string };

/** Corrige nombre y correo de una cuenta (el correo es con el que inicia sesión). */
export async function adminUpdateUserAction(
  userId: string,
  input: { fullName: string; email: string }
): Promise<AdminUpdateUserResult> {
  const actor = await requireAdmin();

  const fullName = input.fullName?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!fullName) return { error: "Escribe el nombre de la persona" };
  if (!email || !EMAIL_RE.test(email)) return { error: "El correo no es válido" };

  try {
    adminUpdateUser(actor.id, userId, { fullName, email });
    revalidatePath("/admin/users");
    // Si es la propia cuenta, el nombre aparece en el shell (header/menú) de todas las rutas
    if (userId === actor.id) revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudieron guardar los datos. Intenta de nuevo.") };
  }
}

/** Primera confirmación del borrado: qué se perdería y qué lo impide. */
export async function adminDeleteUserPreviewAction(
  userId: string
): Promise<{ ok: true; impact: DeleteUserImpact } | { error: string }> {
  const actor = await requireAdmin();
  try {
    return { ok: true, impact: adminDeleteUserImpact(actor.id, userId) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo revisar la cuenta. Intenta de nuevo.") };
  }
}

/**
 * Segunda confirmación: el admin escribe el correo de la cuenta. Se vuelve a
 * comprobar aquí, no solo en el navegador.
 */
export async function adminDeleteUserAction(
  userId: string,
  confirmEmail: string
): Promise<{ ok: true } | { error: string }> {
  const actor = await requireAdmin();
  try {
    adminDeleteUser(actor.id, userId, confirmEmail);
    revalidatePath("/admin/users");
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo eliminar la cuenta. Intenta de nuevo.") };
  }
}

export type AdminResetPasswordResult = { ok: true; password: string } | { error: string };

/**
 * Asigna la contraseña que escribió el admin o, si no escribió ninguna, una
 * temporal; se muestra UNA sola vez. Cierra las sesiones del usuario.
 */
export async function adminResetPasswordAction(
  userId: string,
  chosenPassword?: string
): Promise<AdminResetPasswordResult> {
  const actor = await requireAdmin();
  if (chosenPassword && chosenPassword.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres" };
  }
  try {
    const password = chosenPassword || generateTempPassword();
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
