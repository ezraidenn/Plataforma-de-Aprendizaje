"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { verifyPassword } from "./passwords";
import { createSession, destroySession } from "./sessions";
import { homeFor } from "./guards";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Escribe tu correo y contraseña." };
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();

  // Mensaje idéntico exista o no el usuario (no revelar cuál falló)
  const genericError = { error: "Correo o contraseña incorrectos." };
  if (!user || !user.active) return genericError;

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return genericError;

  const h = await headers();
  await createSession(user.id, {
    ip: h.get("x-forwarded-for") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  });

  db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).run();

  // B3: si el middleware mandó a /login con ?next=<ruta>, volver ahí tras
  // entrar. El action se POSTea desde /login?next=..., así que la ruta viene
  // en el referer (misma origin: el navegador manda la URL completa). Solo se
  // aceptan rutas internas ("/..." pero no "//...": nada de dominios externos).
  let next: string | null = null;
  const referer = h.get("referer");
  if (referer) {
    try {
      next = new URL(referer).searchParams.get("next");
    } catch {
      next = null;
    }
  }
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  redirect(safeNext ?? homeFor(user.role));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
