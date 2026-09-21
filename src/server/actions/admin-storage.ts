"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import {
  checkStorageRoot,
  setStorageRootSetting,
  storageRoot,
} from "@/server/services/storage";

export type StorageRootResult =
  | { ok: true; root: string; warning?: string }
  | { error: string };

/**
 * Cambia la carpeta donde se guardan los archivos (por ejemplo el NAS).
 * Valida acceso y escritura ANTES de guardar; no mueve nada: para eso está
 * `pnpm storage move --to "<ruta>"`, que copia y verifica por hash.
 */
export async function updateStorageRootAction(rawPath: string): Promise<StorageRootResult> {
  const user = await requireAdmin();
  const previous = storageRoot();

  const verdict = await checkStorageRoot(rawPath);
  if (!verdict.ok) return { error: verdict.error };

  try {
    setStorageRootSetting(rawPath);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar la ruta" };
  }

  const root = storageRoot();
  audit(user.id, "update_storage_root", "app_settings", undefined, { from: previous, to: root });
  revalidatePath("/admin/settings");
  return { ok: true, root, warning: verdict.warning };
}

/** Comprueba una ruta sin guardarla (botón «Probar»). */
export async function testStorageRootAction(rawPath: string): Promise<StorageRootResult> {
  await requireAdmin();
  const verdict = await checkStorageRoot(rawPath);
  if (!verdict.ok) return { error: verdict.error };
  return { ok: true, root: rawPath.trim(), warning: verdict.warning };
}
