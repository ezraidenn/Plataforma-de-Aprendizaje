"use server";

import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/guards";
import { setViewCookie } from "@/server/auth/view-scope-cookie";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { VIEW_ALL, VIEW_OWN } from "@/lib/view-context";

export type SetViewContextResult = { ok: true } | { error: string };

/** Cambia el contexto de vista del admin: "own" | "all" | id de un maestro. */
export async function setViewContextAction(value: string): Promise<SetViewContextResult> {
  await requireAdmin();
  if (typeof value !== "string" || !value) return { error: "Contexto no válido." };
  if (value === VIEW_OWN) {
    await setViewCookie(null);
    return { ok: true };
  }
  if (value === VIEW_ALL) {
    await setViewCookie(VIEW_ALL);
    return { ok: true };
  }
  const teacher = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, value), eq(users.role, "teacher")))
    .get();
  if (!teacher) return { error: "Ese maestro ya no existe o cambió de rol." };
  await setViewCookie(teacher.id);
  return { ok: true };
}
