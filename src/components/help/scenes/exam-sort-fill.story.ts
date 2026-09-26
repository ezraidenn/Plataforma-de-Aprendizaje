import { categorizeHits, type CategorizeConfig } from "@/lib/categorize";
import { clozeHits, type ClozeConfig, type ClozeMode } from "@/lib/cloze";
import { between } from "../scene-clock";

// ─── Clasificar en grupos ─────────────────────────────────────────────────────

export const SORT_CYCLE_MS = 10_000;

/**
 * La pregunta de la escena, tal como la guarda el maestro (las pruebas la
 * validan con las reglas del editor). El ícono es un dibujo de la escena: su
 * `fileId` no es un archivo.
 */
export const SORT_CONFIG: CategorizeConfig = {
  groups: [
    { id: "frutas", name: "Frutas" },
    { id: "verduras", name: "Verduras" },
    { id: "lacteos", name: "Lácteos" },
  ],
  cards: [
    { id: "manzana", kind: "text", text: "Manzana", groupId: "frutas" },
    { id: "apio", kind: "text", text: "Apio", groupId: "verduras" },
    { id: "aguacate", kind: "text", text: "Aguacate", groupId: "frutas" },
    { id: "leche", kind: "text", text: "Leche", groupId: "lacteos" },
    { id: "queso", kind: "icon", fileId: "escena-queso", ratio: 0.7, groupId: "lacteos" },
  ],
};

/** Lo que hace el alumno: toma una tarjeta y la suelta en un grupo (índices). El aguacate va a dar a Verduras. */
const SORT_MOVES = [
  { card: 0, group: 0, at: 0.04 },
  { card: 1, group: 1, at: 0.165 },
  { card: 3, group: 2, at: 0.29 },
  { card: 4, group: 2, at: 0.415 },
  { card: 2, group: 1, at: 0.54 },
] as const;
/** Desde que la toma: sale hacia el grupo (el viaje dura 0.06), el grupo se ilumina al llegar y cae casi medio segundo después. */
const SORT_TRAVEL = 0.03;
const SORT_HOT = 0.07;
const SORT_DROP = 0.115;

export type SortState = {
  /** Tarjeta en la mano (índice de SORT_CONFIG.cards) o null */
  held: number | null;
  /** Grupo al que va la tarjeta en la mano (índice de SORT_CONFIG.groups) o null */
  target: number | null;
  /** La tarjeta en la mano ya salió del banco hacia su grupo */
  travelling: boolean;
  /** Grupo iluminado: la tarjeta está encima y caería ahí */
  hot: number | null;
  /** Grupo donde quedó cada tarjeta (índice) o null si sigue en el banco */
  placedIn: (number | null)[];
  /**
   * Lugar de cada tarjeta dentro de su grupo (0: primera, 1: segunda), en el
   * orden en que se pusieron; la de la mano, el que tomará al caer. null: en el banco.
   */
  slot: (number | null)[];
  /** Ya no quedan tarjetas en el banco */
  bankEmpty: boolean;
  graded: boolean;
  /** Cada tarjeta: ¿quedó en su grupo? (la misma regla que la calificación) */
  correct: boolean[];
  ok: number;
  total: number;
};

/**
 * Las cinco tarjetas en el banco. Una a una: la toma, los grupos se marcan
 * como destino, viaja, el grupo de abajo se ilumina y cae. El aguacate queda en
 * Verduras. Al revisar, 4 de 5 tarjetas: cada una vale su parte.
 */
export function sortStory(phase: number): SortState {
  const n = SORT_CONFIG.cards.length;
  const placedIn: (number | null)[] = Array(n).fill(null);
  const slot: (number | null)[] = Array(n).fill(null);
  const count = SORT_CONFIG.groups.map(() => 0);
  let held: number | null = null;
  let target: number | null = null;
  let travelling = false;
  let hot: number | null = null;
  for (const move of SORT_MOVES) {
    if (phase < move.at) break;
    const t = phase - move.at;
    slot[move.card] = count[move.group];
    if (t >= SORT_DROP) {
      placedIn[move.card] = move.group;
      count[move.group]++;
      continue;
    }
    held = move.card;
    target = move.group;
    travelling = t >= SORT_TRAVEL;
    hot = t >= SORT_HOT ? move.group : null;
  }
  const placed: Record<string, string | undefined> = {};
  SORT_CONFIG.cards.forEach((card, i) => {
    const g = placedIn[i];
    if (g !== null) placed[card.id] = SORT_CONFIG.groups[g].id;
  });
  const correct = categorizeHits(SORT_CONFIG, placed);
  return {
    held,
    target,
    travelling,
    hot,
    placedIn,
    slot,
    bankEmpty: placedIn.every((g) => g !== null),
    graded: phase >= 0.72,
    correct,
    ok: correct.filter(Boolean).length,
    total: n,
  };
}

// ─── Completar el texto ───────────────────────────────────────────────────────

export const FILL_CYCLE_MS = 10_000;

/** Una forma de contestar: la pregunta como la guarda el maestro y lo que pone el alumno. */
export type FillRow = { mode: ClozeMode; label: string; config: ClozeConfig; given: string };

/**
 * La misma oración en las tres formas (corta: con la revisión cabe en un
 * renglón aun en un celular). Al escribir, «peru» (sin mayúscula ni acento)
 * vale; en la lista, el alumno elige «Chile».
 */
export const FILL_ROWS: readonly FillRow[] = [
  {
    mode: "write",
    label: "Escribir",
    config: { text: "Lima es la capital de [[Perú]].", mode: "write" },
    given: "peru",
  },
  {
    mode: "bank",
    label: "Banco de palabras",
    config: { text: "Lima es la capital de [[Perú]].", mode: "bank", distractors: ["Chile", "Bolivia"] },
    given: "Perú",
  },
  {
    mode: "select",
    label: "Lista en cada hueco",
    config: { text: "Lima es la capital de [[Perú|!Chile|!Ecuador]].", mode: "select" },
    given: "Chile",
  },
];

/** Palabras del banco y opciones de la lista, revueltas como las ve el alumno. */
export const FILL_BANK_WORDS = ["Chile", "Perú", "Bolivia"] as const;
export const FILL_SELECT_OPTIONS = ["Ecuador", "Chile", "Perú"] as const;

/** Escribir: una letra cada tanto desde TYPE_AT. */
const TYPE_AT = 0.11;
const TYPE_STEP = 0.025;
/** Lista: la opción que señala el puntero, en orden. */
const HOVERS = [
  { option: 0, at: 0.55 },
  { option: 1, at: 0.58 },
] as const;

export type FillState = {
  /** Fila donde está el alumno (dónde va el puntero) o null */
  active: ClozeMode | null;
  /** El puntero está sobre lo que toca en la fila activa */
  cursor: boolean;
  pressed: boolean;
  /** Escribir: el cuadro tiene el foco y lo tecleado hasta ahora */
  writeFocus: boolean;
  typed: string;
  /** Banco: la palabra en la mano, ya viaja, el hueco se ilumina, ya quedó */
  bankHeld: boolean;
  bankTravelling: boolean;
  bankHot: boolean;
  bankPlaced: boolean;
  /** Lista: abierta, opción señalada (índice de FILL_SELECT_OPTIONS) y la elegida */
  listOpen: boolean;
  listHover: number | null;
  listChosen: string | null;
  graded: boolean;
  /** Cada fila: ¿quedó bien el hueco? (con la calificación real) */
  results: boolean[];
};

/**
 * Las tres filas se llenan por turno: escribe «peru»; toma «Perú» del banco y
 * la suelta en el hueco (que se ilumina); abre la lista y elige «Chile». Al
 * revisar: ✓, ✓ y ✗ con la respuesta correcta al lado.
 */
export function fillStory(phase: number): FillState {
  const word = FILL_ROWS[0].given;
  const letters = Math.min(word.length, Math.floor((phase - TYPE_AT) / TYPE_STEP + 1e-9) + 1);
  let listHover: number | null = null;
  for (const h of HOVERS) if (phase >= h.at) listHover = h.option;
  const listOpen = between(phase, 0.53, 0.64);

  const active: ClozeMode | null = between(phase, 0.02, 0.25)
    ? "write"
    : between(phase, 0.25, 0.45)
      ? "bank"
      : between(phase, 0.45, 0.66)
        ? "select"
        : null;

  return {
    active,
    cursor: between(phase, 0.03, 0.1) || between(phase, 0.26, 0.43) || between(phase, 0.46, 0.64),
    pressed: between(phase, 0.08, 0.1) || between(phase, 0.32, 0.43) || between(phase, 0.51, 0.53) || between(phase, 0.61, 0.64),
    writeFocus: between(phase, 0.09, 0.25),
    typed: phase >= TYPE_AT ? word.slice(0, letters) : "",
    bankHeld: between(phase, 0.33, 0.43),
    bankTravelling: between(phase, 0.35, 0.43),
    bankHot: between(phase, 0.39, 0.43),
    bankPlaced: phase >= 0.43,
    listOpen,
    listHover: listOpen ? listHover : null,
    listChosen: phase >= 0.64 ? FILL_ROWS[2].given : null,
    graded: phase >= 0.72,
    results: FILL_ROWS.map((row) => clozeHits(row.config, [row.given])[0]),
  };
}
