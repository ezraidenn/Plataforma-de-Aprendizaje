import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { VIEW_COOKIE } from "@/lib/view-context";
import type { SessionUser } from "./sessions";
import { resolveViewScope, type ViewScope } from "./view-scope";

// Una sola consulta por render aunque layout, página y componentes la pidan
const resolveCached = cache(
  (id: string, role: SessionUser["role"], value: string | undefined): ViewScope =>
    resolveViewScope({ id, role }, value)
);

/** Alcance de la vista de la petición actual (cookie `vista`). */
export async function getViewScope(user: SessionUser): Promise<ViewScope> {
  const store = await cookies();
  return resolveCached(user.id, user.role, store.get(VIEW_COOKIE)?.value || undefined);
}

/**
 * Guarda el contexto (null = «Mi contenido», que es no tener cookie). Cookie de
 * sesión: además, el middleware la quita en cada carga completa.
 */
export async function setViewCookie(value: string | null): Promise<void> {
  const store = await cookies();
  if (value === null) {
    store.delete(VIEW_COOKIE);
    return;
  }
  store.set(VIEW_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // LAN sin TLS, igual que la cookie de sesión
    path: "/",
  });
}
