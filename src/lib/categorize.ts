/**
 * «Clasificar en grupos» (categorize): tarjetas de texto o imagen que el alumno
 * acomoda en grupos. Puro (sin BD ni DOM).
 */
import { iconNumbers, imageItemName, validAspect } from "./image-questions";

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

/**
 * Clave para comparar nombres de grupo y textos de tarjeta: sin los espacios
 * de las orillas ni mayúsculas. «Manzana» y «manzana » son la misma tarjeta
 * (la validación y el editor usan esta misma clave).
 */
export const categorizeTextKey = (s: string) => s.trim().toLocaleLowerCase("es");

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
    if (names.has(categorizeTextKey(name))) return "Hay dos grupos con el mismo nombre";
    names.add(categorizeTextKey(name));
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
    const look = k.kind === "icon" ? `i:${k.fileId}` : `t:${categorizeTextKey(k.text as string)}`;
    if (looks.has(look)) return "Hay dos tarjetas iguales: el alumno no las distinguiría";
    looks.add(look);
  }
  const empty = c.groups.find((g) => !used.has(g.id));
  if (empty) return `El grupo «${empty.name.trim()}» no tiene tarjetas`;
  return null;
}

/**
 * Pregunta guardada → su config, o null si no está completa. Es el único
 * criterio para lo que ve el alumno, la calificación y la revisión (como
 * `readImageDrag`): usa las mismas reglas que al guardar.
 */
export function readCategorize(q: { config: unknown }): CategorizeConfig | null {
  return categorizeProblem(q.config) === null ? (q.config as CategorizeConfig) : null;
}

/** Una tarjeta tal como se dibuja: sin su id ni su grupo. */
export type CategorizeCardView = { kind: "text" | "icon"; text?: string; fileId?: string; ratio?: number };

export function categorizeCardView(card: CategorizeCard): CategorizeCardView {
  if (card.kind === "icon") return { kind: "icon", fileId: card.fileId, ...(card.ratio !== undefined ? { ratio: card.ratio } : {}) };
  return { kind: "text", text: card.text?.trim() };
}

/**
 * Lo que recibe el alumno: los grupos en su orden y las tarjetas revueltas,
 * cada uno con su ficha. Nunca el grupo de una tarjeta ni los ids.
 * Respuesta: `{ fichaDeTarjeta: fichaDeGrupo }`.
 */
export type CategorizeView = {
  groups: { token: string; name: string }[];
  cards: (CategorizeCardView & { token: string })[];
};

/** La vista del alumno con las fichas que dan `tokens` (el servidor: HMAC por intento; la vista previa: locales). */
export function categorizeView(
  config: CategorizeConfig,
  tokens: { group: (groupId: string) => string; card: (cardId: string) => string },
  shuffle: <T>(items: T[]) => T[]
): CategorizeView {
  return {
    groups: config.groups.map((g) => ({ token: tokens.group(g.id), name: g.name.trim() })),
    cards: shuffle(config.cards.map((k) => ({ token: tokens.card(k.id), ...categorizeCardView(k) }))),
  };
}

/** Qué tarjetas quedaron en su grupo, en el orden de `config.cards`. `placed[idTarjeta]` = id del grupo donde quedó. */
export function categorizeHits(config: CategorizeConfig, placed: Record<string, string | undefined>): boolean[] {
  return config.cards.map((k) => placed[k.id] === k.groupId);
}

/** Fracción 0–1 de tarjetas en su grupo. */
export function categorizeScore(config: CategorizeConfig, placed: Record<string, string | undefined>): number {
  const hits = categorizeHits(config, placed);
  return hits.length === 0 ? 0 : hits.filter(Boolean).length / hits.length;
}

/**
 * Archivos que nombra una config de clasificar: los de sus tarjetas de ícono.
 * Acepta cualquier cosa: se lee también de lo ya guardado, sin validar.
 */
export function categorizeFileIds(config: unknown): string[] {
  const cards = (config as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(cards)) return [];
  return cards.flatMap((k) => {
    const f = (k as { fileId?: unknown } | null)?.fileId;
    return typeof f === "string" && f ? [f] : [];
  });
}

/**
 * Tablero de revisión (solo viaja con resultados visibles): cada grupo con las
 * tarjetas que quedaron en él, y las que no se pusieron. `expectedGroup` es el
 * nombre del grupo al que iba la tarjeta (en las mal puestas y las sin poner).
 */
export type CategorizeBoard = {
  kind: "categorize";
  groups: { name: string; cards: { view: CategorizeCardView; correct: boolean; expectedGroup?: string }[] }[];
  unplaced: { view: CategorizeCardView; expectedGroup: string }[];
};

/**
 * Sin `placed`, la solución: cada tarjeta en su grupo (la vista previa del
 * maestro). Con `placed` (id de tarjeta → id del grupo donde la puso el
 * alumno), lo que puso y si acertó.
 */
export function categorizeBoard(config: CategorizeConfig, placed?: Record<string, string | undefined>): CategorizeBoard {
  const nameOf = new Map(config.groups.map((g) => [g.id, g.name.trim()]));
  const where = (k: CategorizeCard) => {
    const g = placed ? placed[k.id] : k.groupId;
    return g !== undefined && nameOf.has(g) ? g : undefined;
  };
  // La config ya se validó: cada tarjeta es de un grupo que existe
  const expected = (k: CategorizeCard) => nameOf.get(k.groupId)!;
  return {
    kind: "categorize",
    groups: config.groups.map((g) => ({
      name: g.name.trim(),
      cards: config.cards
        .filter((k) => where(k) === g.id)
        .map((k) =>
          k.groupId === g.id
            ? { view: categorizeCardView(k), correct: true }
            : { view: categorizeCardView(k), correct: false, expectedGroup: expected(k) }
        ),
    })),
    unplaced: config.cards.filter((k) => where(k) === undefined).map((k) => ({ view: categorizeCardView(k), expectedGroup: expected(k) })),
  };
}

/** La solución en texto: «Frutas: Manzana, Pera · Verduras: Zanahoria, Ícono 1». */
export function categorizeSolutionText(config: CategorizeConfig): string {
  const icons = iconNumbers(config.cards.map((k) => k.fileId));
  return config.groups
    .map((g) => `${g.name.trim()}: ${config.cards.filter((k) => k.groupId === g.id).map((k) => imageItemName(k, icons).trim()).join(", ")}`)
    .join(" · ");
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
