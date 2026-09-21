import type { NoValue, TopicsOf } from "./types";

export type RulesValues = {
  "rules.operator": { op: "AND" | "OR" };
  "rules.viewing": { min: number };
  "rules.examAverage": { min: number };
  "rules.examSpecific": { min: number };
  "rules.allItems": NoValue;
};

const WHERE = "Curso › Reglas de aprobación";

export const RULES_TOPICS: TopicsOf<RulesValues> = {
  "rules.operator": {
    label: "Combinar condiciones (Y / O)",
    where: WHERE,
    kicker: "Cuándo aprueba el alumno",
    caption: ({ op }) =>
      `Con **Y** debe cumplir **todas** las condiciones; con **O** le basta **una**. Ahora está en **${op === "AND" ? "Y (todas)" : "O (al menos una)"}**.`,
    example: { op: "AND" },
  },
  "rules.viewing": {
    label: "Ver todo el contenido requerido",
    where: WHERE,
    kicker: "Cuándo se cumple",
    caption: ({ min }) =>
      `Cuenta los **documentos, lecturas y videos requeridos** que el alumno completó. Se cumple al llegar al **${min}%**${min === 100 ? " (todos)" : ""}.`,
    example: { min: 100 },
  },
  "rules.examAverage": {
    label: "Promedio de exámenes",
    where: WHERE,
    kicker: "Cuándo se cumple",
    caption: ({ min }) => `Se promedian los exámenes elegidos (90 y 70 → **80%**) y se compara con el mínimo de **${min}%**.`,
    example: { min: 80 },
  },
  "rules.examSpecific": {
    label: "Un examen específico",
    where: WHERE,
    kicker: "Cuándo se cumple",
    caption: ({ min }) => `Solo cuenta **ese examen**: necesita **${min}%** o más. Los demás exámenes no afectan esta condición.`,
    example: { min: 80 },
  },
  "rules.allItems": {
    label: "Completar todos los ítems requeridos",
    where: WHERE,
    kicker: "Cuándo se cumple",
    caption: () => "Se cumple cuando el alumno completa **todo lo marcado como requerido**. Lo **opcional** no bloquea.",
    example: {},
  },
};
