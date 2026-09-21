import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./sessions";

/** Página protegida: redirige a /login si no hay sesión. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Maestro o admin. */
export async function requireTeacher(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "teacher" && user.role !== "admin") redirect(homeFor(user.role));
  return user;
}

/** Solo admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect(homeFor(user.role));
  return user;
}

/** Solo estudiante (los maestros tienen su propio dashboard). */
export async function requireStudent(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "student") redirect(homeFor(user.role));
  return user;
}

/** Para route handlers (API): devuelve null en vez de redirigir. */
export async function apiUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export function homeFor(role: SessionUser["role"]): string {
  return role === "student" ? "/dashboard" : "/teach/dashboard";
}
