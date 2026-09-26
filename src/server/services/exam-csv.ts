import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { questions } from "@/server/db/schema";
import type { ImageQuestionType } from "@/lib/image-questions";
import { csvRepresentable } from "@/lib/csv-fit";
import { categorizeProblem, formatGroupsCsv, parseGroupsCsv, readCategorize } from "@/lib/categorize";
import { clozeProblem, lfOnly, type ClozeConfig, type ClozeMode } from "@/lib/cloze";
import { listQuestions, type QuestionInput } from "./exams";
import { BOM, csvLine, parseCsv, columnGetter, parseBoolEs } from "./csv-core";
import { importQuestionInputs } from "./exam-import";

/**
 * Formato CSV de exámenes — editable en Excel y re-subible.
 *
 * Columnas: tipo, pregunta, puntos, opcion_1..opcion_6, correctas,
 *           respuestas_aceptadas, pares, pasos, grupos, texto, modo, distractores,
 *           mayusculas, acentos
 * - tipo: opcion_unica | opcion_multiple | verdadero_falso | respuesta_corta |
 *         relacionar | ordenar | clasificar | completar | abierta
 * - correctas: números de opción separados por | (ej. "2" o "1|3").
 *   En verdadero_falso: V o F.
 * - respuestas_aceptadas (respuesta_corta): variantes separadas por |
 * - pares (relacionar): "izquierda=derecha | izquierda2=derecha2"
 * - pasos (ordenar): "paso 1 | paso 2 | paso 3" en el orden correcto.
 * - grupos (clasificar): "Grupo: tarjeta; tarjeta | Grupo2: tarjeta" (tarjetas
 *   de texto; con alguna de ícono, o con separadores que no volverían igual,
 *   la pregunta no cabe: ver `csvRepresentable`).
 * - texto (completar): el texto con cada hueco entre [[ ]], con sus variantes
 *   y opciones incorrectas: [[respuesta|variante|!incorrecta]]. Puede tener
 *   varios renglones (la celda va entre comillas: ver `csvRecords`).
 * - modo (completar): escribir | banco | lista (vacío = escribir).
 * - distractores (completar en modo banco): palabras de más, "a | b".
 * - mayusculas, acentos (completar en modo escribir): SI para distinguirlos
 *   al calificar (vacío = NO).
 * Las columnas a partir de «pasos» son opcionales: un CSV sin ellas sirve
 * para los demás tipos.
 */

/**
 * Tipado exhaustivo: si se agrega un tipo de pregunta, el compilador obliga a
 * decidir aquí su columna CSV (o a excluirlo, como las preguntas sobre imagen).
 */
const TYPE_TO_CSV: Record<Exclude<QuestionInput["type"], ImageQuestionType>, string> = {
  single_choice: "opcion_unica",
  multiple_choice: "opcion_multiple",
  true_false: "verdadero_falso",
  short_text: "respuesta_corta",
  matching: "relacionar",
  ordering: "ordenar",
  categorize: "clasificar",
  cloze: "completar",
  open_text: "abierta",
};
type CsvType = keyof typeof TYPE_TO_CSV;
const CSV_TO_TYPE: Record<string, QuestionInput["type"]> = {
  opcion_unica: "single_choice",
  opcion_multiple: "multiple_choice",
  verdadero_falso: "true_false",
  respuesta_corta: "short_text",
  relacionar: "matching",
  ordenar: "ordering",
  clasificar: "categorize",
  completar: "cloze",
  abierta: "open_text",
};

/** «Completar el texto»: cómo se contesta, en la columna «modo». */
const CLOZE_MODE_TO_CSV: Record<ClozeMode, string> = { write: "escribir", bank: "banco", select: "lista" };
const CSV_TO_CLOZE_MODE: Record<string, ClozeMode> = { escribir: "write", banco: "bank", lista: "select" };

const HEADER = [
  "tipo",
  "pregunta",
  "puntos",
  "opcion_1",
  "opcion_2",
  "opcion_3",
  "opcion_4",
  "opcion_5",
  "opcion_6",
  "correctas",
  "respuestas_aceptadas",
  "pares",
  "pasos",
  "grupos",
  "texto",
  "modo",
  "distractores",
  "mayusculas",
  "acentos",
] as const;
type Column = (typeof HEADER)[number];

/** Una fila con las columnas que se den (las demás, vacías), en el orden de la cabecera. */
function csvRow(values: Partial<Record<Column, string | number>>): string {
  return csvLine(HEADER.map((h) => values[h] ?? ""));
}

export const EXAM_CSV_TEMPLATE =
  BOM +
  [
    csvLine([...HEADER]),
    csvRow({ tipo: "opcion_unica", pregunta: "¿Qué extintor se usa en fuego eléctrico?", puntos: 2, opcion_1: "Agua", opcion_2: "CO2", opcion_3: "Espuma", correctas: "2" }),
    csvRow({ tipo: "opcion_multiple", pregunta: "Elementos del triángulo del fuego", puntos: 3, opcion_1: "Oxígeno", opcion_2: "Calor", opcion_3: "Nitrógeno", opcion_4: "Combustible", correctas: "1|2|4" }),
    csvRow({ tipo: "verdadero_falso", pregunta: "El CO2 conduce electricidad", puntos: 1, correctas: "F" }),
    csvRow({ tipo: "respuesta_corta", pregunta: "Número de emergencias en México", puntos: 2, respuestas_aceptadas: "911|9 1 1" }),
    csvRow({ tipo: "relacionar", pregunta: "Relaciona el tipo de fuego con su extintor", puntos: 4, pares: "Clase A=Agua | Clase B=Espuma | Clase C=CO2" }),
    csvRow({ tipo: "ordenar", pregunta: "Ordena los pasos para usar el extintor", puntos: 2, pasos: "Jalar el seguro | Apuntar a la base | Presionar la palanca | Barrer de lado a lado" }),
    csvRow({ tipo: "clasificar", pregunta: "Clasifica cada material según la clase de fuego", puntos: 3, grupos: "Clase A: Madera; Papel; Tela | Clase B: Gasolina; Alcohol" }),
    csvRow({ tipo: "completar", pregunta: "Completa cómo se usa el extintor", puntos: 2, texto: "Primero jala el [[seguro]] y apunta a la [[base]] del fuego.", modo: "banco", distractores: "manguera | etiqueta" }),
    csvRow({ tipo: "abierta", pregunta: "Describe el procedimiento de evacuación de tu área", puntos: 5 }),
  ].join("\r\n");

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Preguntas (ya en la forma del servicio) → CSV del mismo formato que la
 * plantilla. Lo usan la exportación y «Descargar como CSV» de la IA. Las que
 * no caben en el CSV (`csvRepresentable`: sobre imagen, o clasificar con
 * íconos o con separadores que no volverían igual) se omiten; la IA nunca
 * las crea, así que solo importa para la exportación real del examen, que
 * las cuenta aparte.
 */
export function inputsToCsv(inputs: QuestionInput[]): string {
  const lines = [csvLine([...HEADER])];

  for (const q of inputs) {
    if (!csvRepresentable(q)) continue;
    const values: Partial<Record<Column, string | number>> = {
      tipo: TYPE_TO_CSV[q.type as CsvType],
      pregunta: q.promptMd,
      puntos: q.points,
    };
    const opts = q.options ?? [];

    if (q.type === "single_choice" || q.type === "multiple_choice") {
      opts.slice(0, 6).forEach((o, i) => {
        values[`opcion_${i + 1}` as Column] = o.textMd;
      });
      values.correctas = opts
        .map((o, i) => (o.isCorrect ? String(i + 1) : null))
        .filter(Boolean)
        .join("|");
    } else if (q.type === "true_false") {
      // Por POSICIÓN (0 = Verdadero, 1 = Falso), no por texto: una opción
      // con etiqueta distinta exportaría la respuesta invertida
      values.correctas = opts[0]?.isCorrect ? "V" : "F";
    } else if (q.type === "short_text") {
      values.respuestas_aceptadas = ((q.config as { accepted?: string[] } | null)?.accepted ?? []).join("|");
    } else if (q.type === "matching") {
      values.pares = ((q.config as { pairs?: { left: string; right: string }[] } | null)?.pairs ?? [])
        .map((pair) => `${pair.left}=${pair.right}`)
        .join(" | ");
    } else if (q.type === "ordering") {
      values.pasos = ((q.config as { steps?: string[] } | null)?.steps ?? []).join(" | ");
    } else if (q.type === "categorize") {
      // Lo guardado siempre está completo; una config rota sale sin grupos y,
      // al volver a subirla, su fila dice qué falta
      const config = readCategorize({ config: q.config });
      values.grupos = config ? formatGroupsCsv(config) : "";
    } else if (q.type === "cloze") {
      const config = (q.config ?? {}) as Partial<ClozeConfig>;
      values.texto = config.text ?? "";
      values.modo = config.mode && Object.hasOwn(CLOZE_MODE_TO_CSV, config.mode) ? CLOZE_MODE_TO_CSV[config.mode] : "";
      // Los distractores solo existen en el banco, y distinguir mayúsculas y
      // acentos solo al escribir (en otro modo, al importarlos la fila lo diría)
      values.distractores = config.mode === "bank" ? (config.distractors ?? []).join(" | ") : "";
      values.mayusculas = config.mode === "write" && config.matchCase ? "SI" : "";
      values.acentos = config.mode === "write" && config.matchAccents ? "SI" : "";
    }

    lines.push(csvRow(values));
  }

  return BOM + lines.join("\r\n");
}

export function exportExamCsv(examItemId: string): string {
  return inputsToCsv(
    listQuestions(examItemId).map((q) => ({
      type: q.type,
      promptMd: q.promptMd,
      points: q.points,
      config: q.config ?? undefined,
      options: q.options.map((o) => ({ textMd: o.textMd, isCorrect: o.isCorrect })),
    }))
  );
}

/**
 * Cuántas preguntas del examen no caben en el CSV/Excel (`csvRepresentable`):
 * exportar las omite y «reemplazar» las conserva, así que los avisos las cuentan.
 */
export function countNotInCsv(examItemId: string): number {
  return db
    .select({ type: questions.type, config: questions.config })
    .from(questions)
    .where(eq(questions.examItemId, examItemId))
    .all()
    .filter((q) => !csvRepresentable(q)).length;
}

// ─── Validación e import ─────────────────────────────────────────────────────

export type ExamCsvRow = {
  line: number;
  status: "ok" | "invalid";
  message: string;
  preview: string;
  typeLabel: string;
  input?: QuestionInput;
};

const ALIASES = {
  tipo: ["tipo"],
  pregunta: ["pregunta", "enunciado"],
  puntos: ["puntos", "pts", "valor"],
  opcion_1: ["opcion_1", "opcion_a", "opcion1"],
  opcion_2: ["opcion_2", "opcion_b", "opcion2"],
  opcion_3: ["opcion_3", "opcion_c", "opcion3"],
  opcion_4: ["opcion_4", "opcion_d", "opcion4"],
  opcion_5: ["opcion_5", "opcion_e", "opcion5"],
  opcion_6: ["opcion_6", "opcion_f", "opcion6"],
  correctas: ["correctas", "correcta", "respuesta_correcta"],
  respuestas_aceptadas: ["respuestas_aceptadas", "aceptadas", "respuestas"],
  pares: ["pares", "parejas", "relaciones"],
  pasos: ["pasos", "orden", "secuencia"],
  grupos: ["grupos", "categorias", "clasificacion"],
  texto: ["texto", "texto_con_huecos", "huecos"],
  modo: ["modo", "forma_de_contestar"],
  distractores: ["distractores", "palabras_de_mas", "palabras_extra"],
  mayusculas: ["mayusculas", "distinguir_mayusculas"],
  acentos: ["acentos", "distinguir_acentos"],
};

const TYPE_LABELS: Record<string, string> = {
  opcion_unica: "Opción única",
  opcion_multiple: "Opción múltiple",
  verdadero_falso: "Verdadero/Falso",
  respuesta_corta: "Respuesta corta",
  relacionar: "Relacionar",
  ordenar: "Ordenar pasos",
  clasificar: "Clasificar en grupos",
  completar: "Completar el texto",
  abierta: "Texto abierto",
};

/** «a | b | c» → sus partes, sin espacios ni vacías. */
const splitBars = (s: string) =>
  s
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);

export function validateExamCsv(text: string): {
  rows: ExamCsvRow[];
  ok: number;
  invalid: number;
} {
  const parsed = parseCsv(text, { maxRows: 200 });
  const col = columnGetter(parsed.headers, ALIASES);
  if (!col.has("tipo") || !col.has("pregunta")) {
    throw new Error('El archivo debe tener las columnas "tipo" y "pregunta" (descarga la plantilla)');
  }

  const rows: ExamCsvRow[] = parsed.rows.map(({ line, cells }) => {
    const rawType = col.get(cells, "tipo").toLowerCase().trim();
    const prompt = col.get(cells, "pregunta").trim();
    const preview = prompt.length > 60 ? prompt.slice(0, 57) + "…" : prompt;
    // Object.hasOwn: «constructor» o «toString» en la columna no deben leerse del prototipo
    const typeLabel = Object.hasOwn(TYPE_LABELS, rawType) ? TYPE_LABELS[rawType] : rawType;

    const fail = (message: string): ExamCsvRow => ({ line, status: "invalid", message, preview, typeLabel });

    const type = Object.hasOwn(CSV_TO_TYPE, rawType) ? CSV_TO_TYPE[rawType] : undefined;
    if (!type) return fail(`Tipo desconocido "${rawType}" — usa los de la plantilla`);
    if (!prompt) return fail("Falta el enunciado");

    const points = parseFloat(col.get(cells, "puntos").replace(",", ".") || "1");
    if (!Number.isFinite(points) || points <= 0) return fail("Puntos inválidos");

    const optionTexts = [1, 2, 3, 4, 5, 6]
      .map((n) => col.get(cells, `opcion_${n}`).trim())
      .filter((t) => t.length > 0);
    const correctasRaw = col.get(cells, "correctas").trim();

    let input: QuestionInput;
    try {
      if (type === "single_choice" || type === "multiple_choice") {
        if (optionTexts.length < 2) return fail("Agrega al menos dos opciones");
        const correctIdx = new Set(
          correctasRaw
            .split("|")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => Number.isFinite(n))
        );
        if (correctIdx.size === 0) return fail('Indica la(s) correcta(s) en "correctas" (ej. 2 o 1|3)');
        for (const idx of correctIdx) {
          if (idx < 1 || idx > optionTexts.length) return fail(`"correctas" incluye la opción ${idx}, que no existe`);
        }
        input = {
          type,
          promptMd: prompt,
          points,
          options: optionTexts.map((textMd, i) => ({ textMd, isCorrect: correctIdx.has(i + 1) })),
        };
      } else if (type === "true_false") {
        const c = correctasRaw.toUpperCase();
        if (c !== "V" && c !== "F") return fail('En verdadero_falso, "correctas" debe ser V o F');
        input = {
          type,
          promptMd: prompt,
          points,
          options: [
            { textMd: "Verdadero", isCorrect: c === "V" },
            { textMd: "Falso", isCorrect: c === "F" },
          ],
        };
      } else if (type === "short_text") {
        const accepted = col
          .get(cells, "respuestas_aceptadas")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean);
        if (accepted.length === 0) return fail('Agrega variantes en "respuestas_aceptadas" (separadas por |)');
        input = { type, promptMd: prompt, points, config: { accepted } };
      } else if (type === "matching") {
        const pairs = col
          .get(cells, "pares")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((pair) => {
            const [left, ...rest] = pair.split("=");
            return { left: (left ?? "").trim(), right: rest.join("=").trim() };
          });
        if (pairs.length < 2 || pairs.some((p) => !p.left || !p.right)) {
          return fail('En "pares" usa el formato izquierda=derecha | izquierda2=derecha2 (mínimo 2)');
        }
        input = { type, promptMd: prompt, points, config: { pairs } };
      } else if (type === "ordering") {
        const steps = col
          .get(cells, "pasos")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean);
        if (steps.length < 3) return fail('En "pasos" escribe al menos 3 pasos en orden, separados por |');
        input = { type, promptMd: prompt, points, config: { steps } };
      } else if (type === "categorize") {
        const raw = col.get(cells, "grupos").trim();
        if (!raw) return fail('En "grupos" escribe cada grupo con sus tarjetas: Grupo: tarjeta; tarjeta | Grupo2: tarjeta');
        const config = parseGroupsCsv(raw);
        if ("error" in config) return fail(config.error);
        // Los mismos textos que el editor («Crea al menos dos grupos», «El grupo «X» no tiene tarjetas»…)
        const problem = categorizeProblem(config);
        if (problem) return fail(problem);
        input = { type, promptMd: prompt, points, config };
      } else if (type === "cloze") {
        const text = lfOnly(col.get(cells, "texto").trim());
        if (!text) return fail('En "texto" escribe el texto con cada hueco entre [[ ]] (ej. La capital de Francia es [[París]])');
        const rawMode = col.get(cells, "modo").trim().toLowerCase();
        const mode: ClozeMode | undefined = !rawMode
          ? "write"
          : Object.hasOwn(CSV_TO_CLOZE_MODE, rawMode)
            ? CSV_TO_CLOZE_MODE[rawMode]
            : undefined;
        if (!mode) return fail('En "modo" escribe escribir, banco o lista');
        const distractors = splitBars(col.get(cells, "distractores"));
        if (distractors.length > 0 && mode !== "bank") {
          return fail('Los "distractores" solo se usan en el modo banco: cambia "modo" a banco o deja "distractores" vacío');
        }
        const matchCase = parseBoolEs(col.get(cells, "mayusculas"));
        const matchAccents = parseBoolEs(col.get(cells, "acentos"));
        if (matchCase === null || matchAccents === null) return fail('En "mayusculas" y "acentos" escribe SI o NO');
        if ((matchCase || matchAccents) && mode !== "write") {
          return fail('Las columnas "mayusculas" y "acentos" solo se usan en el modo escribir');
        }
        const config: ClozeConfig = {
          text,
          mode,
          ...(distractors.length > 0 ? { distractors } : {}),
          ...(matchCase ? { matchCase: true } : {}),
          ...(matchAccents ? { matchAccents: true } : {}),
        };
        // Los mismos textos que el editor («Marca al menos un hueco con [[ ]]», «Al hueco 2 le falta…»)
        const problem = clozeProblem(config);
        if (problem) return fail(problem);
        input = { type, promptMd: prompt, points, config };
      } else {
        input = { type: "open_text", promptMd: prompt, points };
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Fila inválida");
    }

    return { line, status: "ok", message: "Lista", preview, typeLabel, input };
  });

  return {
    rows,
    ok: rows.filter((r) => r.status === "ok").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
  };
}

/**
 * Importa las filas válidas al examen. mode "replace" borra las preguntas
 * actuales primero (los intentos ya enviados conservan su snapshot; las que
 * no caben en el CSV se conservan porque el archivo no las puede traer);
 * "append" agrega al final.
 */
export function importExamCsv(opts: {
  actorId: string;
  examItemId: string;
  csvText: string;
  mode: "replace" | "append";
}): { imported: number; skipped: number; kept: number } {
  const { rows, ok } = validateExamCsv(opts.csvText);
  if (ok === 0) throw new Error("No hay filas válidas para importar");
  const inputs = rows.flatMap((r) => (r.status === "ok" && r.input ? [r.input] : []));
  return importQuestionInputs({
    actorId: opts.actorId,
    examItemId: opts.examItemId,
    inputs,
    mode: opts.mode,
    source: "csv",
    // Las filas inválidas del CSV también cuentan como omitidas
    alreadySkipped: rows.length - inputs.length,
  });
}
