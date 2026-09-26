/**
 * «Clasificar en grupos» (categorize): tarjetas de texto o imagen que el alumno
 * acomoda en grupos. Puro (sin BD ni DOM).
 */
import { validAspect } from "./image-questions";

export type CategorizeGroup = { id: string; name: string };
export type CategorizeCard = {
  id: string;
  kind: "text" | "icon";
  text?: string;
  fileId?: string;
  /** Ícono: alto / ancho del dibujo. */
  ratio?: number;
  groupId: string;
};
export type CategorizeConfig = { groups: CategorizeGroup[]; cards: CategorizeCard[] };

export const MIN_GROUPS = 2;
export const MAX_GROUPS = 6;
export const MIN_CARDS = 2;
export const MAX_CARDS = 30;
export const MAX_GROUP_NAME = 40;
export const MAX_CARD_TEXT = 80;
const MAX_ID = 64;

const lower = (s: string) => s.trim().toLocaleLowerCase("es");

/** null = válida; si no, el primer problema (texto que ve el maestro). */
export function categorizeProblem(config: unknown): string | null {
  const c = config as Partial<CategorizeConfig> | null;
  if (!c || !Array.isArray(c.groups) || !Array.isArray(c.cards)) return "Configura los grupos y las tarjetas";
  if (c.groups.length < MIN_GROUPS) return "Crea al menos dos grupos";
  if (c.groups.length > MAX_GROUPS) return "Usa como máximo seis grupos";
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const g of c.groups) {
    if (!g || typeof g.id !== "string" || !g.id || g.id.length > MAX_ID || ids.has(g.id)) return "Hay grupos repetidos";
    ids.add(g.id);
    const name = typeof g.name === "string" ? g.name.trim() : "";
    if (!name) return "Hay un grupo sin nombre";
    if (name.length > MAX_GROUP_NAME) return `Los nombres de grupo deben tener como máximo ${MAX_GROUP_NAME} caracteres`;
    if (names.has(lower(name))) return "Hay dos grupos con el mismo nombre";
    names.add(lower(name));
  }
  if (c.cards.length < MIN_CARDS) return "Agrega al menos dos tarjetas";
  if (c.cards.length > MAX_CARDS) return `Usa como máximo ${MAX_CARDS} tarjetas`;
  const cardIds = new Set<string>();
  const looks = new Set<string>();
  const used = new Set<string>();
  for (const k of c.cards) {
    if (!k || typeof k.id !== "string" || !k.id || k.id.length > MAX_ID || cardIds.has(k.id)) return "Hay tarjetas repetidas";
    cardIds.add(k.id);
    if (typeof k.groupId !== "string" || !ids.has(k.groupId)) return "Hay una tarjeta de un grupo que ya no existe";
    used.add(k.groupId);
    if (k.kind === "text") {
      const text = typeof k.text === "string" ? k.text.trim() : "";
      if (!text) return "Hay una tarjeta sin texto";
      if (text.length > MAX_CARD_TEXT) return `Las tarjetas deben tener como máximo ${MAX_CARD_TEXT} caracteres`;
    } else if (k.kind === "icon") {
      if (typeof k.fileId !== "string" || !k.fileId) return "Hay una tarjeta sin imagen";
      if (k.ratio !== undefined && !validAspect(k.ratio)) return "Vuelve a subir la imagen de una tarjeta";
    } else {
      return "Hay una tarjeta de un tipo desconocido";
    }
    const look = k.kind === "icon" ? `i:${k.fileId}` : `t:${lower(k.text as string)}`;
    if (looks.has(look)) return "Hay dos tarjetas iguales: el alumno no las distinguiría";
    looks.add(look);
  }
  const empty = c.groups.find((g) => !used.has(g.id));
  if (empty) return `El grupo «${empty.name.trim()}» no tiene tarjetas`;
  return null;
}

/** Fracción 0–1 de tarjetas en su grupo. `placed[idTarjeta]` = id del grupo donde quedó. */
export function categorizeScore(config: CategorizeConfig, placed: Record<string, string | undefined>): number {
  if (config.cards.length === 0) return 0;
  const hits = config.cards.filter((k) => placed[k.id] === k.groupId).length;
  return hits / config.cards.length;
}

/** Cabe en el CSV si todas las tarjetas son de texto. */
export function categorizeCsvRepresentable(config: CategorizeConfig): boolean {
  return config.cards.every((k) => k.kind === "text");
}

/** «Frutas: Manzana; Pera | Verduras: Zanahoria» (solo tarjetas de texto). */
export function formatGroupsCsv(config: CategorizeConfig): string {
  return config.groups
    .map((g) => `${g.name}: ${config.cards.filter((k) => k.groupId === g.id && k.kind === "text").map((k) => k.text).join("; ")}`)
    .join(" | ");
}

/** Lee «Grupo: a; b | Grupo2: c». Ids g1…, c1… en orden. */
export function parseGroupsCsv(text: string): CategorizeConfig | { error: string } {
  const groups: CategorizeGroup[] = [];
  const cards: CategorizeCard[] = [];
  for (const chunk of text.split("|").map((s) => s.trim()).filter(Boolean)) {
    const at = chunk.indexOf(":");
    if (at < 0) return { error: 'En "grupos" usa el formato Grupo: tarjeta; tarjeta | Grupo2: tarjeta' };
    const id = `g${groups.length + 1}`;
    groups.push({ id, name: chunk.slice(0, at).trim() });
    for (const t of chunk.slice(at + 1).split(";").map((s) => s.trim()).filter(Boolean)) {
      cards.push({ id: `c${cards.length + 1}`, kind: "text", text: t, groupId: id });
    }
  }
  return { groups, cards };
}

/** Config que llega del navegador → solo los campos conocidos, con su tipo. */
export function sanitizeCategorize(raw: unknown): unknown {
  const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const id = (v: unknown) => (typeof v === "string" && v.length <= MAX_ID ? v : undefined);
  const drop = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  const c = rec(raw);
  return drop({
    groups: Array.isArray(c.groups) ? c.groups.map((v) => { const g = rec(v); return drop({ id: id(g.id), name: str(g.name)?.trim() }); }) : undefined,
    cards: Array.isArray(c.cards)
      ? c.cards.map((v) => {
          const k = rec(v);
          if (k.kind === "icon") return drop({ id: id(k.id), kind: "icon", fileId: id(k.fileId), ratio: typeof k.ratio === "number" && Number.isFinite(k.ratio) ? k.ratio : undefined, groupId: id(k.groupId) });
          if (k.kind === "text") return drop({ id: id(k.id), kind: "text", text: str(k.text)?.trim(), groupId: id(k.groupId) });
          return drop({ id: id(k.id), groupId: id(k.groupId) });
        })
      : undefined,
  });
}
