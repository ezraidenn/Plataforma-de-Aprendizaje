"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/guards";
import { adminRetryJob } from "@/server/services/admin";

export type AdminRetryJobResult = { ok: true } | { error: string };

/** Vuelve a poner en cola un trabajo que terminó con error. */
export async function adminRetryJobAction(jobId: string): Promise<AdminRetryJobResult> {
  const actor = await requireAdmin();
  try {
    adminRetryJob(actor.id, jobId);
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "No se pudo reintentar el trabajo. Intenta de nuevo.",
    };
  }
}
