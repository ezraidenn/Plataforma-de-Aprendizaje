/** Normaliza texto para buscar: sin acentos, minúsculas, sin espacios extra. */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** ¿Todas las palabras del término aparecen en el texto (en cualquier orden)? */
export function matchesAllWords(term: string, text: string): boolean {
  const tokens = normalizeSearch(term).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = normalizeSearch(text);
  return tokens.every((t) => hay.includes(t));
}
