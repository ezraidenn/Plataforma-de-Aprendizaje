"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/guards";
import {
  canEditBranding,
  changeOwnPassword,
  updateOwnEmail,
  updateOwnName,
  setMailPref,
  type MailPref,
} from "@/server/services/profile";
import {
  updateBranding,
  type CoverKind,
  type CoverPlacement,
} from "@/server/services/branding";

export type AccountActionResult = { ok: true } | { error: string };

/** Enciende o apaga un aviso por correo opcional de la propia cuenta. */
export async function setMailPrefAction(pref: MailPref, on: boolean): Promise<AccountActionResult> {
  const user = await requireUser();
  try {
    setMailPref(user, pref, on);
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : "No se pudo guardar" };
  }
  revalidatePath("/ajustes");
  return { ok: true };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Cambia el nombre propio (solo maestro/admin; el servicio rechaza estudiantes). */
export async function updateOwnNameAction(fullName: string): Promise<AccountActionResult> {
  const user = await requireUser();
  try {
    updateOwnName(user, fullName);
  } catch (err) {
    return { error: errorMessage(err, "No se pudo actualizar el nombre") };
  }
  // El nombre aparece en el shell (header/menú) de todas las rutas
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Cambia el correo propio (solo maestro/admin); exige la contraseña actual. */
export async function updateOwnEmailAction(input: {
  email: string;
  currentPassword: string;
}): Promise<AccountActionResult> {
  const user = await requireUser();
  if (!input.currentPassword) return { error: "Escribe tu contraseña actual para cambiar el correo" };
  try {
    await updateOwnEmail({ user, email: input.email, currentPassword: input.currentPassword });
  } catch (err) {
    return { error: errorMessage(err, "No se pudo actualizar el correo") };
  }
  // El correo aparece en el menú de la cuenta de todas las rutas
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Cambia la contraseña propia y cierra las demás sesiones. */
export async function changeOwnPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<AccountActionResult> {
  const user = await requireUser();
  if (!input.currentPassword) return { error: "Escribe tu contraseña actual" };
  try {
    await changeOwnPassword({
      userId: user.id,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
  } catch (err) {
    return { error: errorMessage(err, "No se pudo cambiar la contraseña") };
  }
  return { ok: true };
}

export type BrandingSelfInput = {
  platformName?: string;
  /** undefined = no tocar · null = quitar logo · string = fileId subido */
  logoFileId?: string | null;
  cover?: {
    enabled?: boolean;
    kind?: CoverKind;
    presetId?: string;
    /** undefined = no tocar · null = quitar foto */
    fileId?: string | null;
    placement?: CoverPlacement;
  };
};

/** Identidad de la empresa desde /ajustes: admin o maestro con permiso. */
export async function updateBrandingSelfAction(
  input: BrandingSelfInput
): Promise<AccountActionResult> {
  const user = await requireUser();
  if (!canEditBranding(user)) {
    return { error: "No tienes permiso para editar la identidad de la empresa" };
  }
  try {
    updateBranding({
      actorId: user.id,
      platformName: input.platformName,
      logoFileId: input.logoFileId,
      cover: input.cover,
    });
  } catch (err) {
    return { error: errorMessage(err, "No se pudo guardar la identidad") };
  }
  revalidatePath("/", "layout");
  revalidatePath("/login");
  revalidatePath("/dashboard");
  revalidatePath("/teach/dashboard");
  revalidatePath("/ajustes");
  return { ok: true };
}
