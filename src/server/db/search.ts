import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { normalizeSearch } from "@/lib/search";

export { normalizeSearch };

/**
 * Búsqueda tolerante: sin acentos, sin mayúsculas, y cada palabra escrita
 * debe aparecer en alguna de las columnas (en cualquier orden: "raul cetina"
 * = "cetina raul" = "Raúl Cetina"). Requiere la función SQL `unaccent`
 * registrada en la conexión (src/server/db/index.ts).
 */

export function searchTokens(term: string | undefined | null): string[] {
  return normalizeSearch(term ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

/** Condición SQL (o null si no hay término). */
export function matchesSearch(term: string | undefined | null, columns: AnyColumn[]): SQL | null {
  const tokens = searchTokens(term);
  if (tokens.length === 0) return null;
  const perToken = tokens.map((tok) => {
    const pattern = `%${tok.replace(/[%_]/g, "")}%`;
    const ors = columns.map((c) => sql`unaccent(lower(${c})) LIKE ${pattern}`);
    return sql`(${sql.join(ors, sql` OR `)})`;
  });
  return sql`(${sql.join(perToken, sql` AND `)})`;
}
