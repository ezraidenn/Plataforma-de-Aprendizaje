// URL del panel de vencimientos (servidor y cliente). Los filtros viven en la
// URL para que el filtrado sea server-side y la vista se pueda compartir.

export const RENEWALS_PATH = "/teach/renewals";

export type RenewalsTabValue = "expiring" | "expired";

export type RenewalsQuery = {
  tab: RenewalsTabValue;
  /** id del curso; ausente = todos */
  course?: string;
  /** id del grupo, "none" = sin grupo; ausente = todos (incluidos cerrados) */
  grupo?: string;
  q?: string;
};

export function renewalsHref(query: RenewalsQuery): string {
  const params = new URLSearchParams({ tab: query.tab });
  if (query.course) params.set("course", query.course);
  if (query.grupo) params.set("grupo", query.grupo);
  if (query.q) params.set("q", query.q);
  return `${RENEWALS_PATH}?${params.toString()}`;
}
