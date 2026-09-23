import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { getOwnedCourse, type Course } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import { getExam } from "@/server/services/exams";
import { audit } from "@/server/services/audit";
import { BOM, csvLine } from "@/server/services/csv-core";
import { validateRosterCsv, importRosterCsv } from "@/server/services/bulk-roster";
import { validateLessonsCsv, importLessonsCsv } from "@/server/services/bulk-lessons";
import { validateExamCsv } from "@/server/services/exam-csv";
import { importQuestionInputs } from "@/server/services/exam-import";
import { attachmentBytes, attachmentsOf, type StoredAttachment } from "@/server/services/attachment-intake";
import { readSheetRows, type SheetData } from "@/server/services/sheet-colors";
import { detectFormat, FORMAT_LABELS, type ExcelFormat } from "@/lib/excel-formats";
import type { AssistantBlock, ProposalColumn, ProposalRow } from "@/lib/assistant-blocks";
import { createProposal } from "../proposal-store";
import { schema, str, strEnum, param, type AssistantTool, type ToolCtx } from "../tool-types";

/**
 * La vuelta de `formato_excel`: el usuario devuelve la hoja ya editada y esto
 * la aplica. El formato se reconoce SOLO por sus encabezados (la IA no tiene
 * que adivinarlo) y todo pasa por la tabla de revisión antes de tocar nada.
 *
 * Aquí viven los tres formatos que no tenían herramienta: matrícula, lecciones
 * y examen. Las listas de alumnos y de cursos ya las hacen `alta_alumnos` y
 * `crear_cursos`, así que esas se remiten en vez de duplicarse.
 *
 * El CSV que se valida se guarda en la propuesta: al aplicar no se vuelve a
 * leer el archivo (salvo que sea enorme) y se revalida con las MISMAS reglas
 * de la pantalla de operaciones masivas.
 */

const FORMATOS = ["", "alumnos", "cursos", "matricula", "lecciones", "examen"] as const;

/** Las listas reales traen título arriba: el encabezado se busca un poco más abajo. */
const HEADER_SEARCH_ROWS = 5;

/** A partir de aquí el CSV no cabe cómodo en la propuesta: se relee el adjunto al aplicar. */
const MAX_PAYLOAD_CHARS = 200_000;

const QUE_ENTIENDO =
  "matrícula (correo + accion), lecciones (id + titulo + requerido/secuencia/visible), preguntas de examen (tipo + pregunta + puntos), alumnos (nombre + correo) y cursos (titulo + descripcion/vigencia)";

type Hoja = { nombre: string; headers: string[]; rows: string[][]; formato: ExcelFormat };

/**
 * Primera hoja (y primera fila) cuyos encabezados son de un formato conocido.
 * Con `forzado` se admite la primera hoja tal cual aunque no se reconozca:
 * el usuario dijo qué es.
 */
function hojaDe(sheets: SheetData[], forzado: ExcelFormat | ""): Hoja | null {
  for (const sheet of sheets) {
    for (let i = 0; i < Math.min(sheet.rows.length, HEADER_SEARCH_ROWS); i++) {
      const headers = sheet.rows[i].cells;
      const formato = detectFormat(headers);
      if (formato) {
        return { nombre: sheet.name, headers, rows: sheet.rows.slice(i + 1).map((r) => r.cells), formato };
      }
    }
  }
  const primera = sheets[0];
  if (!forzado || !primera || primera.rows.length === 0) return null;
  return {
    nombre: primera.name,
    headers: primera.rows[0].cells,
    rows: primera.rows.slice(1).map((r) => r.cells),
    formato: forzado,
  };
}

/** La hoja tal cual → el CSV que esperan los validadores. */
function csvOf(hoja: Hoja): string {
  return BOM + [csvLine(hoja.headers), ...hoja.rows.map((cells) => csvLine(cells))].join("\r\n");
}

/** Id de fila = su línea en el CSV, para poder rehacerlo con solo las que queden. */
const rowId = (line: number) => `l${line}`;

/**
 * El CSV con solo las líneas que siguen en la tabla (el usuario pudo quitar
 * filas, y las bloqueadas nunca llegan aquí). `null` = no quedó ninguna.
 */
function keepLines(csv: string, rows: ProposalRow[]): string | null {
  const wanted = new Set(rows.map((r) => Number(r.id.slice(1))).filter((n) => Number.isFinite(n)));
  // Las líneas se cuentan como en `parseCsv`: sin las vacías y empezando en 1
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const kept = lines.filter((_, i) => wanted.has(i + 1));
  if (lines.length === 0 || kept.length === 0) return null;
  return BOM + [lines[0], ...kept].join("\r\n");
}

/** Curso del parámetro, comprobando que sea suyo. */
function cursoDe(id: string, ctx: ToolCtx): Course | null {
  return id ? getOwnedCourse(id, ctx.user) : null;
}

/** Ítem de examen, por el mismo camino que «Importar CSV» del examen (ítem → curso → dueño). */
function examenDe(itemId: string, ctx: ToolCtx): { id: string; title: string; courseId: string } | null {
  if (!itemId) return null;
  const item = getItem(itemId);
  if (!item || item.kind !== "exam" || !getExam(itemId)) return null;
  if (!getOwnedCourse(item.courseId, ctx.user)) return null;
  return { id: item.id, title: item.title, courseId: item.courseId };
}

const COLUMNS: Record<"matricula" | "lecciones" | "examen", ProposalColumn[]> = {
  // Nada es editable: lo que se aplica es el archivo, no la tabla. Lo que sí
  // puede hacer el usuario es quitar filas que no quiera aplicar.
  matricula: [
    { key: "alumno", label: "Alumno", editable: false },
    { key: "correo", label: "Correo", editable: false },
    { key: "accion", label: "Acción", editable: false },
    { key: "estado", label: "Estado", editable: false },
  ],
  lecciones: [
    { key: "leccion", label: "Lección", editable: false },
    { key: "cambio", label: "Cambio", editable: false },
    { key: "estado", label: "Estado", editable: false },
  ],
  examen: [
    { key: "pregunta", label: "Pregunta", editable: false },
    { key: "tipo", label: "Tipo", editable: false },
    { key: "puntos", label: "Puntos", editable: false },
    { key: "estado", label: "Estado", editable: false },
  ],
};

/** Nombre de cada correo, para que la tabla diga a quién se está moviendo. */
function namesByEmail(emails: string[]): Map<string, string> {
  const wanted = [...new Set(emails.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  return new Map(
    db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(inArray(users.email, wanted))
      .all()
      .map((u) => [u.email, u.fullName] as const)
  );
}

const ACCION_LABEL = { enroll: "Matricular", unenroll: "Quitar" } as const;

function rosterRows(courseId: string, csv: string): { rows: ProposalRow[]; resumen: string } {
  const { rows, toEnroll, toUnenroll, noop, invalid } = validateRosterCsv(courseId, csv);
  const nombres = namesByEmail(rows.map((r) => r.email));
  const proposalRows = rows.map((r): ProposalRow => {
    const cells = {
      alumno: nombres.get(r.email) ?? "—",
      correo: r.email,
      accion: ACCION_LABEL[r.action],
      estado: r.message,
    };
    // Las inválidas y las que no cambian nada quedan bloqueadas: se ven en
    // gris tachado y no se mandan al aplicar
    return r.status === "ok" ? { id: rowId(r.line), cells } : { id: rowId(r.line), cells, warning: r.message, blocked: true };
  });
  const partes = [`${toEnroll} por matricular`, `${toUnenroll} por dar de baja`];
  if (noop > 0) partes.push(`${noop} sin cambio`);
  if (invalid > 0) partes.push(`${invalid} con problema`);
  return { rows: proposalRows, resumen: partes.join(", ") };
}

function lessonRows(courseId: string, csv: string): { rows: ProposalRow[]; resumen: string } {
  const { rows, ok, unchanged, invalid } = validateLessonsCsv(courseId, csv);
  const proposalRows = rows.map((r): ProposalRow => {
    const cells = {
      leccion: r.title || r.itemId || "—",
      cambio: r.status === "ok" ? r.changes.join(" · ") : "—",
      estado: r.status === "ok" ? "Se aplicará" : r.message,
    };
    if (r.status === "ok") return { id: rowId(r.line), cells };
    return { id: rowId(r.line), cells, warning: r.status === "unchanged" ? "Sin cambios" : r.message, blocked: true };
  });
  const partes = [`${ok} con cambios`];
  if (unchanged > 0) partes.push(`${unchanged} sin cambios`);
  if (invalid > 0) partes.push(`${invalid} con problema`);
  return { rows: proposalRows, resumen: partes.join(", ") };
}

function examRows(csv: string): { rows: ProposalRow[]; resumen: string } {
  const { rows, ok, invalid } = validateExamCsv(csv);
  const proposalRows = rows.map((r): ProposalRow => {
    const cells = {
      pregunta: r.preview || "—",
      tipo: r.typeLabel,
      puntos: r.input ? String(r.input.points) : "",
      estado: r.status === "ok" ? "Se agregará" : r.message,
    };
    return r.status === "ok" ? { id: rowId(r.line), cells } : { id: rowId(r.line), cells, warning: r.message, blocked: true };
  });
  const partes = [`${ok} por agregar`];
  if (invalid > 0) partes.push(`${invalid} con problema`);
  return { rows: proposalRows, resumen: partes.join(", ") };
}

/** Las hojas del último adjunto del mensaje. */
async function sheetsOf(adjunto: StoredAttachment): Promise<SheetData[]> {
  const { bytes, fileName } = await attachmentBytes(adjunto);
  return readSheetRows(bytes, fileName);
}

export const aplicarExcel: AssistantTool = {
  name: "aplicar_excel",
  description:
    "Aplica el Excel adjunto que el usuario llenó o editó (el que dio formato_excel, o el que bajó de Operaciones masivas): reconoce por sus encabezados si es matrícula, lecciones o preguntas de examen y deja una tabla para revisar antes de aplicar. Si el archivo resulta ser una lista de alumnos o de cursos, te lo dice para que uses alta_alumnos o crear_cursos.",
  parameters: schema({
    curso_id: str("Id del curso al que se aplica, de buscar_curso. Hace falta en matrícula y lecciones («» si no se sabe todavía)"),
    item_id: str("Id del examen al que van las preguntas («» si el archivo no es de examen)"),
    formato: strEnum(
      "Déjalo en «» para que el servidor lo reconozca por los encabezados. Solo dilo si el usuario fue explícito: «alumnos», «cursos», «matricula», «lecciones» o «examen»",
      [...FORMATOS]
    ),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  async run(params, ctx) {
    const adjunto = ctx.attachments.at(-1);
    if (!adjunto) return { forModel: "No hay ningún archivo adjunto en este mensaje. Pide al usuario que lo adjunte." };

    let sheets: SheetData[];
    try {
      sheets = await sheetsOf(adjunto);
    } catch (err) {
      return { forModel: err instanceof Error ? err.message : "No pude leer el archivo adjunto." };
    }
    if (sheets.length === 0) {
      return { forModel: "No pude leer ese archivo como hoja de cálculo; tiene que ser un Excel o un CSV." };
    }

    const pedido = param(params, "formato");
    const forzado = (FORMATOS as readonly string[]).includes(pedido) ? (pedido as ExcelFormat | "") : "";
    const hoja = hojaDe(sheets, forzado);
    if (!hoja) {
      const encabezados = (sheets[0]?.rows[0]?.cells ?? []).filter(Boolean).slice(0, 8).join(", ");
      return {
        forModel: `No reconocí el formato de ese archivo${encabezados ? ` (sus encabezados son: ${encabezados})` : ""}. Los que entiendo son ${QUE_ENTIENDO}. Ofrécele el formato correcto con formato_excel.`,
      };
    }

    // Lo que dijo el usuario manda; si no coincide con lo que dicen los
    // encabezados, la IA se entera para poder avisarlo
    const formato = forzado || hoja.formato;
    const discrepa =
      forzado && hoja.formato !== forzado
        ? ` Ojo: los encabezados parecen de ${FORMAT_LABELS[hoja.formato]}, pero se pidió ${FORMAT_LABELS[forzado]}.`
        : "";

    if (formato === "alumnos") {
      return { forModel: `Ese archivo es una lista de alumnos, no lo aplico yo: llama a alta_alumnos con origen "adjunto" (y curso_id si además se matriculan).${discrepa}` };
    }
    if (formato === "cursos") {
      return { forModel: `Ese archivo es una lista de cursos, no lo aplico yo: llama a crear_cursos con origen "adjunto".${discrepa}` };
    }
    if (hoja.rows.length === 0) {
      return { forModel: `El archivo trae los encabezados de ${FORMAT_LABELS[formato]} pero ninguna fila debajo; no hay nada que aplicar.${discrepa}` };
    }

    const csv = csvOf(hoja);
    const cursoId = param(params, "curso_id");
    const itemId = param(params, "item_id");
    const curso = cursoDe(cursoId, ctx);
    const examen = examenDe(itemId, ctx);

    let title: string;
    let rows: ProposalRow[];
    let resumen: string;
    const payload: Record<string, unknown> = { formato };

    try {
      if (formato === "examen") {
        if (!examen) {
          return {
            forModel: itemId
              ? `No encontramos ese examen o es de un curso que no te pertenece; no se aplicó nada.${discrepa}`
              : `Ese archivo trae preguntas de examen, pero necesito saber a qué examen van (item_id): busca el curso con buscar_curso y pregunta al usuario a qué examen. No se aplicó nada.${discrepa}`,
          };
        }
        title = `Agregar preguntas a ${examen.title}`;
        ({ rows, resumen } = examRows(csv));
        payload.itemId = examen.id;
      } else {
        if (!curso) {
          return {
            forModel: cursoId
              ? `No encontramos ese curso o no te pertenece; no se aplicó nada.${discrepa}`
              : `Ese archivo es de ${FORMAT_LABELS[formato]}, pero necesito el id del curso (curso_id): búscalo con buscar_curso. No se aplicó nada.${discrepa}`,
          };
        }
        if (formato === "matricula") {
          title = `Actualizar la matrícula de ${curso.title}`;
          ({ rows, resumen } = rosterRows(curso.id, csv));
        } else {
          title = `Aplicar cambios de lecciones en ${curso.title}`;
          ({ rows, resumen } = lessonRows(curso.id, csv));
        }
        payload.courseId = curso.id;
      }
    } catch (err) {
      // Lo que lanzan los validadores cuando faltan columnas: se dice tal cual
      return { forModel: `${err instanceof Error ? err.message : "No pude leer ese archivo."} No se aplicó nada.${discrepa}` };
    }

    // El CSV viaja en la propuesta para no releer el archivo al aplicar; si es
    // enorme, se guarda solo el adjunto y se vuelve a leer entonces
    if (csv.length <= MAX_PAYLOAD_CHARS) payload.csv = csv;
    else payload.adjuntoId = adjunto.id;

    const proposalId = createProposal("aplicar_excel", ctx, ctx.messageId, {
      title,
      applyLabel: "Aplicar cambios",
      columns: COLUMNS[formato],
      rows,
      payload,
    });

    const aplicables = rows.filter((r) => !r.blocked).length;
    return {
      forModel: `Se creó una propuesta con el Excel de ${FORMAT_LABELS[formato]}: ${rows.length} fila(s) leída(s), ${resumen}. ${aplicables === 0 ? "Ninguna se puede aplicar tal como está." : "El usuario revisará la tabla."}${discrepa}`,
      proposalId,
    };
  },
  // Sin confirmWord: los cambios se ven fila por fila en la tabla y todo lo que
  // hacen (matricular, dar de baja, editar propiedades) es reversible
  async apply(rows, payload, ctx) {
    const formato = String(payload.formato ?? "") as ExcelFormat;

    let csv = typeof payload.csv === "string" ? payload.csv : "";
    if (!csv) {
      // Archivo grande: se vuelve a leer el adjunto de esta conversación
      const adjunto = attachmentsOf(ctx.conversationId, [String(payload.adjuntoId ?? "")])[0];
      if (!adjunto) return { text: "Ya no encuentro el archivo de esta revisión; vuelve a adjuntarlo." };
      try {
        const hoja = hojaDe(await sheetsOf(adjunto), formato);
        if (!hoja) return { text: "Ya no pude leer el archivo de esta revisión; vuelve a adjuntarlo." };
        csv = csvOf(hoja);
      } catch (err) {
        return { text: err instanceof Error ? err.message : "Ya no pude leer el archivo de esta revisión." };
      }
    }

    const filtrado = keepLines(csv, rows);
    if (!filtrado) return { text: "No quedó ninguna fila que aplicar." };

    const blocks: AssistantBlock[] = [];
    try {
      if (formato === "examen") {
        const examen = examenDe(String(payload.itemId ?? ""), ctx);
        if (!examen) return { text: "Ese examen ya no está disponible; no se agregó ninguna pregunta." };
        // Se revalida con las reglas del CSV y solo entran las preguntas buenas
        const { rows: revisadas } = validateExamCsv(filtrado);
        const inputs = revisadas.flatMap((r) => (r.status === "ok" && r.input ? [r.input] : []));
        if (inputs.length === 0) return { text: "Ninguna de esas preguntas pasó la revisión; el examen quedó igual." };
        const { imported, skipped } = importQuestionInputs({
          actorId: ctx.user.id,
          examItemId: examen.id,
          inputs,
          // Se agregan al final: reemplazar el examen entero se hace desde su pantalla
          mode: "append",
          source: "csv",
          alreadySkipped: revisadas.length - inputs.length,
        });
        audit(ctx.user.id, "assistant_aplicar_excel", "exams", examen.id, { formato, imported, skipped });
        blocks.push({
          type: "links",
          links: [{ label: `Ver ${examen.title}`, href: `/teach/courses/${examen.courseId}/items/${examen.id}/edit`, icon: "page" }],
        });
        return {
          text: `${imported} pregunta(s) agregada(s) al final de ${examen.title}${skipped > 0 ? `; ${skipped} omitida(s)` : ""}.`,
          blocks,
        };
      }

      const curso = cursoDe(String(payload.courseId ?? ""), ctx);
      if (!curso) return { text: "Ese curso ya no está disponible; no se aplicó nada." };

      if (formato === "matricula") {
        const { toEnroll, toUnenroll, invalid } = validateRosterCsv(curso.id, filtrado);
        if (toEnroll + toUnenroll === 0) return { text: "No quedó ningún cambio de matrícula que aplicar." };
        const { enrolled, unenrolled } = importRosterCsv({ actorId: ctx.user.id, courseId: curso.id, csvText: filtrado });
        audit(ctx.user.id, "assistant_aplicar_excel", "enrollments", curso.id, { formato, enrolled, unenrolled });
        blocks.push({
          type: "links",
          links: [{ label: `Ver ${curso.title}`, href: `/teach/courses/${curso.id}/students`, icon: "user" }],
        });
        return {
          text: `${enrolled} alumno(s) matriculado(s) y ${unenrolled} dado(s) de baja en ${curso.title}${invalid > 0 ? `; ${invalid} fila(s) omitida(s)` : ""}.`,
          blocks,
        };
      }

      const { ok, invalid } = validateLessonsCsv(curso.id, filtrado);
      if (ok === 0) return { text: "No quedó ningún cambio de lecciones que aplicar." };
      const { updated } = importLessonsCsv({ actorId: ctx.user.id, courseId: curso.id, csvText: filtrado });
      audit(ctx.user.id, "assistant_aplicar_excel", "course_items", curso.id, { formato, updated });
      blocks.push({
        type: "links",
        links: [{ label: `Ver ${curso.title}`, href: `/teach/courses/${curso.id}/content`, icon: "course" }],
      });
      return {
        text: `${updated} lección(es) actualizada(s) en ${curso.title}${invalid > 0 ? `; ${invalid} fila(s) omitida(s)` : ""}.`,
        blocks,
      };
    } catch (err) {
      return { text: `${err instanceof Error ? err.message : "No se pudo aplicar el archivo."} No se cambió nada.` };
    }
  },
};
