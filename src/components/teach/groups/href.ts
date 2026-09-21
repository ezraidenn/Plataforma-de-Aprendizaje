// URL de la página de grupos (servidor y cliente). Pestaña, curso y búsqueda
// viven en la URL para que el filtrado sea server-side y la vista se comparta.

export const GROUPS_PATH = "/teach/groups";

export type CohortStatusTab = "open" | "closed" | "all";

export type GroupsQuery = {
  tab: CohortStatusTab;
  /** id del curso (`?curso=`); ausente = todos los cursos */
  curso?: string;
  q?: string;
};

/** `?estado=` → pestaña. Acepta también los valores en español. */
export function parseStatusTab(raw: string | undefined): CohortStatusTab {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "closed" || v === "cerrados") return "closed";
  if (v === "all" || v === "todos") return "all";
  return "open";
}

/** Href de la página de grupos conservando curso y búsqueda. */
export function groupsHref({ tab, curso, q }: GroupsQuery): string {
  const params = new URLSearchParams();
  if (tab !== "open") params.set("estado", tab);
  if (curso) params.set("curso", curso);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `${GROUPS_PATH}?${qs}` : GROUPS_PATH;
}
