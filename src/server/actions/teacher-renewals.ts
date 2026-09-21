"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import {
  DISMISS_REASONS,
  dismissCertificates,
  renewCertificates,
  type DismissReason,
  type RenewCohort,
} from "@/server/services/renewals";

type Result<T = object> = ({ ok: true } & T) | { error: string };

function revalidateRenewalViews() {
  revalidatePath("/teach/renewals");
  revalidatePath("/teach/dashboard");
  revalidatePath("/teach/students");
  revalidatePath("/teach/courses", "layout");
}

/**
 * Reinscribe a los seleccionados: abre el ciclo siguiente (en cero). El grupo
 * se resuelve por curso (ver RenewCohort); por defecto conserva el que tenían.
 */
export async function renewCertificatesAction(
  certificateIds: string[],
  cohort: RenewCohort
): Promise<Result<{ renewed: number; skipped: number }>> {
  const user = await requireTeacher();
  if (certificateIds.length === 0) return { error: "Selecciona al menos un certificado" };
  try {
    const result = renewCertificates(user, certificateIds, cohort);
    revalidateRenewalViews();
    return { ok: true, ...result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo reinscribir" };
  }
}

/** Descarta con motivo: sale del panel y queda en el historial y la auditoría. */
export async function dismissCertificatesAction(
  certificateIds: string[],
  reason: DismissReason,
  note?: string
): Promise<Result<{ count: number }>> {
  const user = await requireTeacher();
  if (certificateIds.length === 0) return { error: "Selecciona al menos un certificado" };
  if (!(reason in DISMISS_REASONS)) return { error: "Motivo no válido" };
  if (reason === "otro" && !note?.trim()) return { error: "Escribe el motivo" };
  try {
    const count = dismissCertificates(user, certificateIds, reason, note);
    revalidateRenewalViews();
    return { ok: true, count };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo descartar" };
  }
}
