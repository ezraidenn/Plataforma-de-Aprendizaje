"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/guards";
import { queueMail } from "@/server/mail/outbox";
import { audit } from "@/server/services/audit";

/** Manda el correo de prueba al propio admin (sale en unos segundos). */
export async function sendTestMailAction(): Promise<{ ok: true; message: string } | { error: string }> {
  const user = await requireAdmin();
  const r = queueMail({ kind: "prueba", userId: user.id });
  if (!r) return { error: "Tu cuenta no puede recibir correos ahora." };
  if (r.status === "omitido") return { error: r.reason ?? "No se pudo encolar el correo." };
  audit(user.id, "send_test_mail", "app_settings");
  revalidatePath("/admin/settings");
  return { ok: true, message: `Se envió un correo de prueba a ${user.email}. Revisa tu bandeja en un minuto.` };
}
