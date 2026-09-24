import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { questions } from "@/server/db/schema";
import { IMAGE_QUESTION_TYPES, isImageQuestionType, type ImageQuestionType } from "@/lib/image-questions";
import { listQuestions, type QuestionInput } from "./exams";
import { BOM, csvLine, parseCsv, columnGetter } from "./csv-core";
import { importQuestionInputs } from "./exam-import";

/**
 * Formato CSV de exámenes — editable en Excel y re-subible.
 *
 * Columnas: tipo, pregunta, puntos, opcion_1..opcion_6, correctas,
 *           respuestas_aceptadas, pares, pasos
 * - tipo: opcion_unica | opcion_multiple | verdadero_falso | respuesta_corta |
 *         relacionar | ordenar | abierta
 * - correctas: números de opción separados por | (ej. "2" o "1|3").
 *   En verdadero_falso: V o F.
 * - respuestas_aceptadas (respuesta_corta): variantes separadas por |
 * - pares (relacionar): "izquierda=derecha | izquierda2=derecha2"
 * - pasos (ordenar): "paso 1 | paso 2 | paso 3" en el orden correcto. La
 *   columna es opcional: un CSV sin ella sirve para los demás tipos.
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
  open_text: "abierta",
};
const CSV_TO_TYPE: Record<string, QuestionInput["type"]> = {
  opcion_unica: "single_choice",
  opcion_multiple: "multiple_choice",
  verdadero_falso: "true_false",
  respuesta_corta: "short_text",
  relacionar: "matching",
  ordenar: "ordering",
  abierta: "open_text",
};

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
];

export const EXAM_CSV_TEMPLATE =
  BOM +
  [
    csvLine(HEADER),
    csvLine(["opcion_unica", "¿Qué extintor se usa en fuego eléctrico?", 2, "Agua", "CO2", "Espuma", "", "", "", "2", "", "", ""]),
    csvLine(["opcion_multiple", "Elementos del triángulo del fuego", 3, "Oxígeno", "Calor", "Nitrógeno", "Combustible", "", "", "1|2|4", "", "", ""]),
    csvLine(["verdadero_falso", "El CO2 conduce electricidad", 1, "", "", "", "", "", "", "F", "", "", ""]),
    csvLine(["respuesta_corta", "Número de emergencias en México", 2, "", "", "", "", "", "", "", "911|9 1 1", "", ""]),
    csvLine(["relacionar", "Relaciona el tipo de fuego con su extintor", 4, "", "", "", "", "", "", "", "", "Clase A=Agua | Clase B=Espuma | Clase C=CO2", ""]),
    csvLine(["ordenar", "Ordena los pasos para usar el extintor", 2, "", "", "", "", "", "", "", "", "", "Jalar el seguro | Apuntar a la base | Presionar la palanca | Barrer de lado a lado"]),
    csvLine(["abierta", "Describe el procedimiento de evacuación de tu área", 5, "", "", "", "", "", "", "", "", "", ""]),
  ].join("\r\n");

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Preguntas (ya en la forma del servicio) → CSV del mismo formato que la
 * plantilla. Lo usan la exportación y «Descargar como CSV» de la IA. Las
 * preguntas sobre imagen no caben en el CSV: se omiten (la IA nunca las crea,
 * así que solo importa para la exportación real del examen).
 */
export function inputsToCsv(inputs: QuestionInput[]): string {
  const lines = [csvLine(HEADER)];

  for (const q of inputs) {
    if (isImageQuestionType(q.type)) continue;
    const opts = q.options ?? [];
    const options = ["", "", "", "", "", ""];
    let correctas = "";
    let aceptadas = "";
    let pares = "";
    let pasos = "";

    if (q.type === "single_choice" || q.type === "multiple_choice") {
      opts.forEach((o, i) => {
        if (i < 6) options[i] = o.textMd;
      });
      correctas = opts
        .map((o, i) => (o.isCorrect ? String(i + 1) : null))
        .filter(Boolean)
        .join("|");
    } else if (q.type === "true_false") {
      // Por POSICIÓN (0 = Verdadero, 1 = Falso), no por texto: una opción
      // con etiqueta distinta exportaría la respuesta invertida
      correctas = opts[0]?.isCorrect ? "V" : "F";
    } else if (q.type === "short_text") {
      aceptadas = ((q.config as { accepted?: string[] } | null)?.accepted ?? []).join("|");
    } else if (q.type === "matching") {
      pares = ((q.config as { pairs?: { left: string; right: string }[] } | null)?.pairs ?? [])
        .map((pair) => `${pair.left}=${pair.right}`)
        .join(" | ");
    } else if (q.type === "ordering") {
      pasos = ((q.config as { steps?: string[] } | null)?.steps ?? []).join(" | ");
    }

    lines.push(
      csvLine([TYPE_TO_CSV[q.type], q.promptMd, q.points, ...options, correctas, aceptadas, pares, pasos])
    );
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

/** Cuántas preguntas del examen son sobre imagen: no caben en el CSV/Excel. */
export function countImageQuestions(examItemId: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(questions)
      .where(and(eq(questions.examItemId, examItemId), inArray(questions.type, IMAGE_QUESTION_TYPES)))
      .get()?.n ?? 0
  );
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
};

const TYPE_LABELS: Record<string, string> = {
  opcion_unica: "Opción única",
  opcion_multiple: "Opción múltiple",
  verdadero_falso: "Verdadero/Falso",
  respuesta_corta: "Respuesta corta",
  relacionar: "Relacionar",
  ordenar: "Ordenar pasos",
  abierta: "Texto abierto",
};

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
    const typeLabel = TYPE_LABELS[rawType] ?? rawType;

    const fail = (message: string): ExamCsvRow => ({ line, status: "invalid", message, preview, typeLabel });

    const type = CSV_TO_TYPE[rawType];
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
 * actuales primero (los intentos ya enviados conservan su snapshot; las
 * preguntas sobre imagen se conservan porque el CSV no las puede representar);
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
