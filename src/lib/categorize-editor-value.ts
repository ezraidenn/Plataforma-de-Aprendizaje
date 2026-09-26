/**
 * Valor del editor de «Clasificar en grupos»: lo que se abre (sin lo ilegible)
 * y las claves de lo nuevo. Puro (sin DOM): lo prueba `pnpm smoke:categorize`.
 */
import { sanitizeCategorize, type CategorizeCard, type CategorizeConfig } from "./categorize";

/** Clave nueva de un grupo («g…») o una tarjeta («c…»): ocho caracteres al azar, distinta de las que ya hay. */
export function newCategorizeId(prefix: "g" | "c", taken: { id: string }[]): string {
  const used = new Set(taken.map((t) => t.id));
  let id = "";
  while (!id || used.has(id)) id = `${prefix}${Math.random().toString(36).slice(2, 10)}`;
  return id;
}

/**
 * Lo guardado → valor del editor, sin lo ilegible (grupos sin clave, tarjetas
 * de un grupo que no existe o sin texto ni archivo). Sin grupos (una pregunta
 * nueva), dos vacíos para empezar a escribir sus nombres.
 */
export function initialCategorizeValue(raw: unknown): CategorizeConfig {
  const c = sanitizeCategorize(raw) as {
    groups?: { id?: string; name?: string }[];
    cards?: Partial<CategorizeCard>[];
  };
  const groups: CategorizeConfig["groups"] = [];
  for (const g of c.groups ?? []) {
    if (g.id && !groups.some((x) => x.id === g.id)) groups.push({ id: g.id, name: g.name ?? "" });
  }
  if (groups.length === 0) {
    const first = newCategorizeId("g", []);
    return { groups: [{ id: first, name: "" }, { id: newCategorizeId("g", [{ id: first }]), name: "" }], cards: [] };
  }
  const cards: CategorizeCard[] = [];
  for (const k of c.cards ?? []) {
    if (!k.id || cards.some((x) => x.id === k.id) || !groups.some((g) => g.id === k.groupId)) continue;
    if (k.kind === "text" && typeof k.text === "string") cards.push({ id: k.id, kind: "text", text: k.text, groupId: k.groupId! });
    else if (k.kind === "icon" && k.fileId) {
      cards.push({ id: k.id, kind: "icon", fileId: k.fileId, ...(k.ratio !== undefined ? { ratio: k.ratio } : {}), groupId: k.groupId! });
    }
  }
  return { groups, cards };
}
