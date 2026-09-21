"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/guards";
import { updateBranding } from "@/server/services/branding";

export type BrandingActionResult = { ok: true } | { error: string };

export async function updateBrandingAction(input: {
  platformName?: string;
  /** undefined = no tocar · null = quitar logo · string = fileId subido */
  logoFileId?: string | null;
}): Promise<BrandingActionResult> {
  const admin = await requireAdmin();
  try {
    updateBranding({
      actorId: admin.id,
      platformName: input.platformName,
      logoFileId: input.logoFileId,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar la identidad" };
  }
  // El logo/nombre aparecen en todos los shells
  revalidatePath("/", "layout");
  return { ok: true };
}
