/**
 * Contexto de vista del admin: «Mi contenido», «General — todos» o «Ver como
 * maestro X». Módulo puro (sin server-only ni BD): lo usan el middleware
 * (Edge), el servidor y el cliente.
 */

/** Cookie con el contexto elegido. Ausente = «Mi contenido». */
export const VIEW_COOKIE = "vista";
/** Valor de la cookie (y del selector) para «General — todos». */
export const VIEW_ALL = "all";
/** Valor del selector para «Mi contenido» (no se guarda: borra la cookie). */
export const VIEW_OWN = "own";
/** Canal entre pestañas: todas siguen el contexto real de la cookie. */
export const VIEW_CHANNEL = "vista";

/** Lo que el cliente sabe del contexto con el que se armó la pantalla. */
export type ViewContextInfo =
  | { kind: "own" }
  | { kind: "all" }
  | { kind: "teacher"; ownerId: string; ownerName: string };

/** Una opción del selector, con sus conteos. */
export type ViewContextOption = {
  /** "own" | "all" | id del maestro */
  value: string;
  name: string;
  courses: number;
  students: number;
  inactive: boolean;
};

export type ViewContextOptions = {
  own: ViewContextOption;
  all: ViewContextOption;
  teachers: ViewContextOption[];
};

/** Valor del selector que corresponde a un contexto. */
export function contextValue(info: ViewContextInfo): string {
  return info.kind === "teacher" ? info.ownerId : info.kind === "all" ? VIEW_ALL : VIEW_OWN;
}

type HeaderReader = { get(name: string): string | null };

/**
 * ¿Es una carga completa del documento (F5, Ctrl+Shift+R, abrir la app, pestaña
 * nueva, enlace pegado)? Solo esas reinician el contexto; la navegación dentro
 * de la app, el prefetch y las acciones de servidor lo conservan.
 *
 * OJO: Next 15 quita las cabeceras de vuelo (`RSC`, `Next-Router-Prefetch`…)
 * ANTES de correr el middleware (next/dist/server/web/adapter.js), así que ahí
 * las señales efectivas son:
 * - `Sec-Fetch-Dest` (el navegador solo la manda en HTTPS o localhost);
 * - `Accept` en la LAN por HTTP: una carga de página pide `text/html`, mientras
 *   que el fetch RSC de Next no fija Accept y el navegador manda `*\/*`.
 * Las comprobaciones de `RSC`/`Next-Router-Prefetch` quedan como seguro extra.
 */
export function isDocumentLoad(method: string, headers: HeaderReader): boolean {
  if (method !== "GET") return false;
  if (headers.get("rsc") !== null) return false;
  if (headers.get("next-action") !== null) return false;
  if (headers.get("next-router-prefetch") !== null) return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (headers.get("accept") ?? "").includes("text/html");
}

/** Quita una cookie de la cabecera `Cookie` sin tocar el valor de las demás. */
export function stripCookie(header: string, name: string): string {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${name}=`))
    .join("; ");
}

/** «Curso · Dueño» en la vista General; el título tal cual en las demás. */
export function titleWithOwner(title: string, ownerName: string | null | undefined, show: boolean): string {
  return show && ownerName ? `${title} · ${ownerName}` : title;
}

export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Palabras según el contexto de la pantalla: lo propio, lo de un maestro o todo. */
export function contextWords(kind: "own" | "teacher" | "all", ownerName?: string | null) {
  if (kind === "own") return { own: true, courses: "tus cursos", heading: "Mis cursos" };
  if (kind === "all") return { own: false, courses: "todos los cursos", heading: "Todos los cursos" };
  const who = ownerName ?? "—";
  return { own: false, courses: `los cursos de ${who}`, heading: `Cursos de ${who}` };
}
