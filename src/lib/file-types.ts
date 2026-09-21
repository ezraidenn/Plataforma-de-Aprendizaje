/**
 * Tipos de archivo permitidos en una tarea («.pdf,.docx»). Isomórfico: lo usan
 * la entrega del alumno y la ayuda visual del maestro, con la misma regla.
 */

/** ".pdf, .DOCX" → ["pdf", "docx"] (minúsculas, sin puntos ni vacíos). */
export function parseAllowedTypes(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

/** ["pdf", "docx"] → "PDF o DOCX"; sin tipos → "Cualquier archivo". */
export function typesLabel(types: string[]): string {
  if (types.length === 0) return "Cualquier archivo";
  const upper = types.map((t) => t.toUpperCase());
  if (upper.length === 1) return upper[0];
  return `${upper.slice(0, -1).join(", ")} o ${upper[upper.length - 1]}`;
}
