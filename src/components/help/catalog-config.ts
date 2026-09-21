import { EXAMPLE_CLOSES, EXAMPLE_OPENS } from "./scenes/exam.story";
import type { HelpTopicId } from "./topics";

/** Control del catálogo para un dato del valor de ejemplo. */
export type CatalogField = {
  key: string;
  /** Solo se muestra si se cumple (p. ej. meses solo con «Meses desde que se aprueba») */
  when?: (value: Record<string, unknown>) => boolean;
} & (
  | { type: "switch"; on: string; off: string }
  | { type: "select"; label: string; options: readonly (readonly [string, string])[] }
  | {
      type: "number";
      label: string;
      min: number;
      max: number;
      /** Texto junto al campo («%», «segundos»…) */
      suffix?: string;
      /** Si se permite vacío: texto del campo vacío (se guarda null) */
      nullable?: string;
      /** Valor que se muestra cuando es null y no se permite vacío */
      fallback?: number;
    }
  /** Interruptor que pone un valor de ejemplo o null (p. ej. «con fecha de apertura») */
  | { type: "presence"; on: string; off: string; present: unknown }
  | { type: "text"; label: string; placeholder?: string }
);

/** Grupos del catálogo /teach/ayuda, en el orden en que se muestran. */
export const CATALOG_GROUPS: readonly { title: string; topics: readonly HelpTopicId[] }[] = [
  { title: "Curso y ajustes", topics: ["course.status", "course.sequential", "course.cover", "course.certificate", "course.validity"] },
  { title: "Reglas de aprobación", topics: ["rules.operator", "rules.viewing", "rules.examAverage", "rules.examSpecific", "rules.allItems"] },
  {
    title: "Contenido",
    topics: ["content.types", "content.docSeconds", "content.textSeconds", "content.videoSpeed", "content.required", "content.resourceLink"],
  },
  {
    title: "Exámenes",
    topics: ["exam.window", "exam.attempts", "exam.timeLimit", "exam.passing", "exam.shuffle", "exam.pool", "exam.results", "exam.openQuestion", "exam.ordering"],
  },
  { title: "Tareas", topics: ["assignment.late", "assignment.replace", "assignment.fileTypes"] },
  { title: "Alumnos, grupos y vencimientos", topics: ["groups.close", "groups.import", "students.trash", "renewals.actions"] },
  { title: "Certificados y administración", topics: ["templates.fields", "admin.storage", "branding.cover"] },
];

/** Controles para cambiar el valor de ejemplo (los temas sin valor no tienen). */
export const CATALOG_FIELDS: Partial<Record<HelpTopicId, readonly CatalogField[]>> = {
  "course.status": [
    {
      type: "select",
      key: "status",
      label: "Estado",
      options: [
        ["draft", "Borrador"],
        ["published", "Publicado"],
        ["archived", "Archivado"],
      ],
    },
  ],
  "rules.viewing": [{ type: "number", key: "min", label: "Mínimo", min: 1, max: 100, suffix: "% mínimo" }],
  "rules.examAverage": [{ type: "number", key: "min", label: "Mínimo", min: 1, max: 100, suffix: "% mínimo" }],
  "rules.examSpecific": [{ type: "number", key: "min", label: "Mínimo", min: 1, max: 100, suffix: "% mínimo" }],
  "content.textSeconds": [{ type: "number", key: "seconds", label: "Segundos de lectura", min: 0, max: 86400, suffix: "segundos" }],
  "content.videoSpeed": [{ type: "switch", key: "allowed", on: "Encendido", off: "Apagado" }],
  "content.required": [{ type: "switch", key: "required", on: "Requerido", off: "Opcional" }],
  "content.resourceLink": [
    {
      type: "select",
      key: "kind",
      label: "Tipo",
      options: [
        ["resource", "Recurso descargable"],
        ["link", "Enlace externo"],
      ],
    },
  ],
  "exam.window": [
    { type: "presence", key: "opensAt", on: "Con fecha de apertura", off: "Sin apertura", present: EXAMPLE_OPENS },
    { type: "presence", key: "closesAt", on: "Con fecha de cierre", off: "Sin cierre", present: EXAMPLE_CLOSES },
  ],
  "exam.timeLimit": [{ type: "number", key: "minutes", label: "Minutos", min: 1, max: 600, nullable: "Sin límite", suffix: "minutos" }],
  "exam.passing": [{ type: "number", key: "passScore", label: "Mínimo", min: 0, max: 100, nullable: "Sin mínimo", suffix: "% mínimo" }],
  "exam.shuffle": [{ type: "switch", key: "shuffle", on: "Encendido", off: "Apagado" }],
  "exam.pool": [
    { type: "number", key: "draw", label: "Preguntas por intento", min: 1, max: 50, nullable: "Todas", suffix: "por intento" },
    { type: "number", key: "bank", label: "Preguntas en el banco", min: 1, max: 50, suffix: "en el banco" },
  ],
  "exam.results": [
    {
      type: "select",
      key: "mode",
      label: "Mostrar resultados",
      options: [
        ["immediately", "Al enviar"],
        ["after_close", "Al cerrar el examen"],
        ["manual", "Cuando yo decida"],
      ],
    },
  ],
  "assignment.late": [
    { type: "switch", key: "hasDue", on: "Con fecha límite", off: "Sin fecha límite" },
    { type: "switch", key: "allowLate", on: "Acepta tardías", off: "No acepta tardías", when: (v) => v.hasDue === true },
  ],
  "assignment.replace": [{ type: "switch", key: "allowed", on: "Permitido", off: "No permitido" }],
  "assignment.fileTypes": [{ type: "text", key: "types", label: "Tipos permitidos", placeholder: ".pdf,.docx" }],
  "groups.close": [
    {
      type: "select",
      key: "status",
      label: "Estado del grupo",
      options: [
        ["open", "Abierto"],
        ["closed", "Cerrado"],
      ],
    },
  ],
  "templates.fields": [
    {
      type: "select",
      key: "field",
      label: "Campo",
      options: [
        ["validity", "Vigencia"],
        ["qr", "Código QR"],
      ],
    },
  ],
  "branding.cover": [
    {
      type: "select",
      key: "placement",
      label: "Dónde",
      options: [
        ["login", "Inicio de sesión"],
        ["dashboard", "Panel de inicio"],
        ["both", "Ambas"],
      ],
    },
  ],
  "course.sequential": [{ type: "switch", key: "enabled", on: "Activado", off: "Desactivado" }],
  "course.validity": [
    {
      type: "select",
      key: "mode",
      label: "Vigencia",
      options: [
        ["lifetime", "Vitalicio"],
        ["calendar_year", "Año calendario"],
        ["months", "Meses desde que se aprueba"],
      ],
    },
    { type: "number", key: "months", label: "Meses", min: 1, max: 120, fallback: 12, suffix: "meses", when: (v) => v.mode === "months" },
  ],
  "rules.operator": [
    {
      type: "select",
      key: "op",
      label: "Operador",
      options: [
        ["AND", "Todas (Y)"],
        ["OR", "Al menos una (O)"],
      ],
    },
  ],
  "content.docSeconds": [{ type: "number", key: "seconds", label: "Segundos por página", min: 0, max: 600, suffix: "segundos por página" }],
  "exam.attempts": [
    { type: "number", key: "attempts", label: "Intentos máximos", min: 1, max: 100, nullable: "Ilimitados", suffix: "intentos" },
    {
      type: "select",
      key: "policy",
      label: "Calificación que cuenta",
      options: [
        ["best", "El mejor"],
        ["last", "El último"],
        ["average", "El promedio"],
      ],
    },
  ],
};
