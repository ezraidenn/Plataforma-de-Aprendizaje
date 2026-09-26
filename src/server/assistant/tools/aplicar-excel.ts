import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { getOwnedCourse, type Course } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import { getExam, listQuestions } from "@/server/services/exams";
import { audit } from "@/server/services/audit";
import { BOM, csvLine, csvRecords } from "@/server/services/csv-core";
import { validateRosterCsv, importRosterCsv } from "@/server/services/bulk-roster";
import { validateLessonsCsv, importLessonsCsv } from "@/server/services/bulk-lessons";
import { validateExamCsv, countNotInCsv } from "@/server/services/exam-csv";
import { importQuestionInputs } from "@/server/services/exam-import";
import { attachmentBytes, attachmentsOf, type StoredAttachment } from "@/server/services/attachment-intake";
import { readSheetRows, type SheetData } from "@/server/services/sheet-colors";
import { detectFormat, FORMAT_LABELS, type ExcelFormat } from "@/lib/excel-formats";
import { extOf } from "@/lib/ai-import-files";
import { plural } from "@/lib/plural";
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
 *
 * El archivo puede venir de un mensaje anterior: el examen se pregunta antes
 * («¿reemplazar o agregar?») y la respuesta del usuario ya no lleva adjunto.
 *
 * El examen tiene los dos modos de la pantalla de importar (reemplazar o
 * agregar) y no se adivina ninguno: sin `modo` no se crea propuesta y se pide
 * preguntárselo al usuario.
 */

const FORMATOS = ["", "alumnos", "cursos", "matricula", "lecciones", "examen"] as const;

/**
 * Solo para el formato de examen: si las preguntas del archivo sustituyen a
 * las que ya hay o se suman al final. Vacío = todavía no se sabe y hay que
 * preguntarlo (el caso natural —bajar el formato del examen, corregir dos
 * preguntas y devolverlo— acaba en preguntas duplicadas si se agrega).
 */
const MODOS = ["", "agregar", "reemplazar"] as const;
type Modo = "agregar" | "reemplazar";

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

/**
 * La hoja tal cual → el CSV que esperan los validadores. Las celdas llegan con
 * sus renglones (ver `sheetsOf`): las preguntas de examen los conservan (un
 * texto de completar con párrafos); los demás formatos, en una sola línea,
 * como siempre.
 */
function csvOf(hoja: Hoja, formato: ExcelFormat): string {
  const cell = formato === "examen" ? (c: string) => c : (c: string) => c.replace(/\s*\n\s*/g, " ");
  return BOM + [csvLine(hoja.headers.map(cell)), ...hoja.rows.map((cells) => csvLine(cells.map(cell)))].join("\r\n");
}

/** Id de fila = su número de fila en el CSV, para poder rehacerlo con solo las que queden. */
const rowId = (line: number) => `l${line}`;

/**
 * El CSV con solo las filas que siguen en la tabla (el usuario pudo quitar
 * filas, y las bloqueadas nunca llegan aquí). `null` = no quedó ninguna.
 */
function keepLines(csv: string, rows: ProposalRow[]): string | null {
  const wanted = new Set(rows.map((r) => Number(r.id.slice(1))).filter((n) => Number.isFinite(n)));
  // Las filas se cuentan como en `parseCsv`: por registro (una celda de varias
  // líneas es una sola fila), sin los renglones vacíos y empezando en 1
  const records = csvRecords(csv);
  const kept = records.filter((_, i) => wanted.has(i + 1));
  if (records.length === 0 || kept.length === 0) return null;
  return BOM + [records[0], ...kept].join("\r\n");
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

function examRows(csv: string, modo: Modo, conservadas: number): { rows: ProposalRow[]; resumen: string } {
  const { rows, ok, invalid } = validateExamCsv(csv);
  const reemplaza = modo === "reemplazar";
  const proposalRows = rows.map((r): ProposalRow => {
    const cells = {
      pregunta: r.preview || "—",
      tipo: r.typeLabel,
      puntos: r.input ? String(r.input.points) : "",
      estado: r.status === "ok" ? (reemplaza ? "Quedará en el examen" : "Se agregará") : r.message,
    };
    return r.status === "ok" ? { id: rowId(r.line), cells } : { id: rowId(r.line), cells, warning: r.message, blocked: true };
  });
  const partes = [reemplaza ? `${ok} que reemplazan a las actuales` : `${ok} por agregar`];
  // Lo que no cabe en el Excel no lo puede traer: "reemplazar" lo conserva, no lo borra
  if (reemplaza && conservadas > 0) {
    partes.push(plural(conservadas, "1 que no cabe en el Excel se conserva", `${conservadas} que no caben en el Excel se conservan`));
  }
  if (invalid > 0) partes.push(`${invalid} con problema`);
  return { rows: proposalRows, resumen: partes.join(", ") };
}

/**
 * Texto del resultado al aplicar «reemplazar»: qué llegó, a cuántas
 * reemplazó y cuántas que no caben en el Excel se conservaron, con
 * concordancia y sin frases como «reemplazaron a las 0 que tenía» cuando no
 * había ninguna que reemplazar (nada del examen cabía en el Excel).
 */
function reemplazoTexto(examTitle: string, imported: number, kept: number, antes: number, skipped: number): string {
  const total = imported + kept;
  const reemplazadas = antes - kept;
  // Con preguntas conservadas, «la que tenía» es ambiguo (¿cuál, si algunas
  // se conservaron?): se aclara que son las que sí cabían en el Excel
  const objetivo =
    kept > 0
      ? plural(reemplazadas, "la que sí cabía en el Excel", `las ${reemplazadas} que sí cabían en el Excel`)
      : plural(reemplazadas, "la que tenía", `las ${reemplazadas} que tenía`);
  const partes = [
    reemplazadas > 0
      ? `${plural(imported, "1 del archivo reemplazó a", `${imported} del archivo reemplazaron a`)} ${objetivo}`
      : plural(imported, "se agregó 1 del archivo (no había ninguna que reemplazar)", `se agregaron ${imported} del archivo (no había ninguna que reemplazar)`),
  ];
  if (kept > 0) partes.push(plural(kept, "se conservó 1 que no cabe en el Excel", `se conservaron ${kept} que no caben en el Excel`));
  if (skipped > 0) partes.push(plural(skipped, "1 omitida", `${skipped} omitidas`));
  return `${plural(total, `${examTitle} quedó con 1 pregunta`, `${examTitle} quedó con ${total} preguntas`)}: ${partes.join("; ")}.`;
}

/** Las hojas del último adjunto del mensaje, con los renglones de cada celda (`csvOf` decide qué hacer con ellos). */
async function sheetsOf(adjunto: StoredAttachment): Promise<SheetData[]> {
  const { bytes, fileName } = await attachmentBytes(adjunto);
  return readSheetRows(bytes, fileName, { lineBreaks: true });
}

/**
 * El archivo que se aplica: el de este mensaje o, si no trae ninguno, el
 * último de la conversación.
 *
 * Hace falta para las vueltas de dos mensajes: con un examen esta herramienta
 * devuelve la pregunta («¿reemplazar o agregar?») y el usuario contesta en el
 * mensaje siguiente, que ya no lleva adjunto —nadie vuelve a subir el mismo
 * archivo para contestar «reemplazar»—. Lo que se usó se dice en el texto,
 * y como siempre no se toca nada hasta que el usuario aplica la tabla.
 */
function archivoDe(ctx: ToolCtx): { adjunto: StoredAttachment; deAntes: boolean } | null {
  const deEsteMensaje = ctx.attachments.at(-1);
  if (deEsteMensaje) return { adjunto: deEsteMensaje, deAntes: false };
  const anterior = attachmentsOf(ctx.conversationId).at(-1);
  return anterior ? { adjunto: anterior, deAntes: true } : null;
}

export const aplicarExcel: AssistantTool = {
  name: "aplicar_excel",
  description:
    "Aplica el Excel adjunto que el usuario llenó o editó (el que dio formato_excel, o el que bajó de Operaciones masivas): reconoce por sus encabezados si es matrícula, lecciones o preguntas de examen y deja una tabla para revisar antes de aplicar. Con preguntas de examen hace falta el modo (reemplazar o agregar). Si el archivo resulta ser una lista de alumnos o de cursos, te lo dice para que uses alta_alumnos o crear_cursos.",
  parameters: schema({
    curso_id: str("Id del curso al que se aplica, de buscar_curso. Hace falta en matrícula y lecciones («» si no se sabe todavía)"),
    item_id: str("Id del examen al que van las preguntas («» si el archivo no es de examen)"),
    formato: strEnum(
      "Déjalo en «» para que el servidor lo reconozca por los encabezados. Solo dilo si el usuario fue explícito: «alumnos», «cursos», «matricula», «lecciones» o «examen»",
      [...FORMATOS]
    ),
    modo: strEnum(
      'SOLO para preguntas de examen: «reemplazar» borra las preguntas que tiene el examen (las que no caben en el Excel —sobre imagen, o de clasificar con íconos o con «:», «;» o «|» en sus grupos o tarjetas— se conservan) y deja las del archivo; «agregar» las suma al final. Déjalo en «» la primera vez: el servidor te dirá que se lo preguntes al usuario',
      [...MODOS]
    ),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  async run(params, ctx) {
    const archivo = archivoDe(ctx);
    if (!archivo) {
      return { forModel: "No hay ningún archivo adjunto en este mensaje ni antes en esta conversación. Pide al usuario que lo adjunte." };
    }
    const { adjunto } = archivo;
    // Si se rescató de antes, la IA lo dice: el usuario tiene que saber qué archivo se aplicó
    const deAntes = archivo.deAntes ? ` (se usó el archivo de antes en esta conversación: ${adjunto.summary.fileName})` : "";

    // Una foto o un PDF no son una hoja de cálculo, pero eso no quiere decir
    // que no se puedan leer: los lee la IA desde la herramienta que toque
    const nombre = adjunto.summary.fileName;
    if (adjunto.summary.kind === "image" || extOf(nombre) === ".pdf") {
      const que = adjunto.summary.kind === "image" ? (adjunto.summary.pages ? "un PDF escaneado" : "una foto o una captura") : "un PDF";
      return {
        forModel: `«${nombre}» es ${que}, no una hoja de cálculo: esta herramienta solo aplica Excel y CSV. Sí se puede leer con la IA: si es una lista de alumnos, llama a alta_alumnos con origen "adjunto" (y curso_id si además se matriculan); si es una lista de cursos, a crear_cursos con origen "adjunto"; y si solo quieren saber qué contiene, a leer_archivo. No digas que no se puede leer.${deAntes}`,
      };
    }

    let sheets: SheetData[];
    try {
      sheets = await sheetsOf(adjunto);
    } catch (err) {
      return { forModel: err instanceof Error ? err.message : "No pude leer el archivo adjunto." };
    }
    if (sheets.length === 0) {
      return { forModel: `No pude leer ese archivo como hoja de cálculo; tiene que ser un Excel o un CSV.${deAntes}` };
    }

    const pedido = param(params, "formato");
    const forzado = (FORMATOS as readonly string[]).includes(pedido) ? (pedido as ExcelFormat | "") : "";
    const hoja = hojaDe(sheets, forzado);
    if (!hoja) {
      const encabezados = (sheets[0]?.rows[0]?.cells ?? []).filter(Boolean).slice(0, 8).join(", ");
      return {
        forModel: `No reconocí el formato de ese archivo${encabezados ? ` (sus encabezados son: ${encabezados})` : ""}. Los que entiendo son ${QUE_ENTIENDO}. Ofrécele el formato correcto con formato_excel.${deAntes}`,
      };
    }

    // Lo que dijo el usuario manda; si no coincide con lo que dicen los
    // encabezados, la IA se entera para poder avisarlo
    const formato = forzado || hoja.formato;
    const discrepa =
      (forzado && hoja.formato !== forzado
        ? ` Ojo: los encabezados parecen de ${FORMAT_LABELS[hoja.formato]}, pero se pidió ${FORMAT_LABELS[forzado]}.`
        : "") + deAntes;

    if (formato === "alumnos") {
      return { forModel: `Ese archivo es una lista de alumnos, no lo aplico yo: llama a alta_alumnos con origen "adjunto" (y curso_id si además se matriculan).${discrepa}` };
    }
    if (formato === "cursos") {
      return { forModel: `Ese archivo es una lista de cursos, no lo aplico yo: llama a crear_cursos con origen "adjunto".${discrepa}` };
    }
    if (hoja.rows.length === 0) {
      return { forModel: `El archivo trae los encabezados de ${FORMAT_LABELS[formato]} pero ninguna fila debajo; no hay nada que aplicar.${discrepa}` };
    }

    const csv = csvOf(hoja, formato);
    const cursoId = param(params, "curso_id");
    const itemId = param(params, "item_id");
    // Lo que no esté en el enum se trata como «todavía no se sabe»: se pregunta
    const pedidoModo = param(params, "modo");
    const modo: Modo | "" = pedidoModo === "agregar" || pedidoModo === "reemplazar" ? pedidoModo : "";
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
        // Sin modo no se propone nada: agregar cuando el archivo salió del
        // propio examen deja las preguntas duplicadas, y eso no se deshace
        // desde aquí. Lo decide el usuario, no la IA.
        if (!modo) {
          const actuales = listQuestions(examen.id).length;
          const noCaben = countNotInCsv(examen.id);
          // Con preguntas que no caben en el Excel de por medio, "reemplazar"
          // no cambia TODAS las preguntas (esas se quedan), así que no se dice «todas»
          const etiquetaReemplazar = noCaben > 0 ? "«reemplazar las preguntas del examen»" : "«reemplazar todas las preguntas del examen»";
          const notaNoCaben = noCaben > 0
            ? ` (${plural(noCaben, "se conserva 1 que no cabe en el Excel", `se conservan ${noCaben} que no caben en el Excel`)})`
            : "";
          return {
            forModel: `Ese archivo trae ${plural(hoja.rows.length, "1 pregunta", `${hoja.rows.length} preguntas`)} para ${examen.title}, que ahora tiene ${actuales}. No propuse nada todavía: pregúntale al usuario, con estas dos opciones, qué hacer — ${etiquetaReemplazar}${notaNoCaben} (modo "reemplazar") o «agregarlas a las que ya hay» (modo "agregar"). Si el archivo salió de ese mismo examen, lo normal es reemplazar: agregar las dejaría duplicadas. Vuelve a llamar a aplicar_excel con el modo que elija.${discrepa}`,
          };
        }
        title = modo === "reemplazar" ? `Reemplazar las preguntas de ${examen.title}` : `Agregar preguntas a ${examen.title}`;
        ({ rows, resumen } = examRows(csv, modo, countNotInCsv(examen.id)));
        payload.itemId = examen.id;
        payload.modo = modo;
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
        csv = csvOf(hoja, formato);
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
        // El modo lo eligió el usuario al crear la propuesta; las de antes de
        // que existiera el parámetro se aplican como siempre (agregar)
        const reemplaza = payload.modo === "reemplazar";
        const antes = reemplaza ? listQuestions(examen.id).length : 0;
        const { imported, skipped, kept } = importQuestionInputs({
          actorId: ctx.user.id,
          examItemId: examen.id,
          inputs,
          // «replace» borra las anteriores dentro de la misma transacción: ese
          // borrado no se reescribe aquí (conserva las que no caben en el Excel)
          mode: reemplaza ? "replace" : "append",
          source: "csv",
          alreadySkipped: revisadas.length - inputs.length,
        });
        audit(ctx.user.id, "assistant_aplicar_excel", "exams", examen.id, { formato, modo: reemplaza ? "replace" : "append", imported, skipped, kept });
        blocks.push({
          type: "links",
          links: [{ label: `Ver ${examen.title}`, href: `/teach/courses/${examen.courseId}/items/${examen.id}/edit`, icon: "page" }],
        });
        return {
          text: reemplaza
            ? reemplazoTexto(examen.title, imported, kept, antes, skipped)
            : `${plural(imported, "1 pregunta agregada", `${imported} preguntas agregadas`)} al final de ${examen.title}${skipped > 0 ? `; ${plural(skipped, "1 omitida", `${skipped} omitidas`)}` : ""}.`,
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
