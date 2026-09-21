"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/guards";
import { canEditBranding, changeOwnPassword, updateOwnName } from "@/server/services/profile";
import {
  updateBranding,
  type CoverKind,
  type CoverPlacement,
} from "@/server/services/branding";

export type AccountActionResult = { ok: true } | { error: string };

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
