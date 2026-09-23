import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { courses } from "@/server/db/schema";
import { createCourse, updateCourse } from "@/server/services/courses";
import { audit } from "@/server/services/audit";
import { attachmentBytes } from "@/server/services/attachment-intake";
import { getAiKey, getAiSettings } from "@/server/services/ai-settings";
import { courseRows, type CourseRow, type CourseRowsResult } from "../rows-from-attachment";
import { createProposal } from "../proposal-store";
import { schema, str, strEnum, param, type AssistantTool, type ToolCtx } from "../tool-types";
import type { ProposalRow } from "@/lib/assistant-blocks";

/**
 * Crear cursos en lote, del archivo adjunto o de una lista pegada. La IA solo
 * dice de dónde sacarlos; el servidor lee el archivo completo, arma la tabla de
 * revisión y, al confirmar, crea cada curso EN BORRADOR (nunca publicado) a
 * nombre de quien corresponde.
 */

const COLUMNS = [
  { key: "titulo", label: "Título" },
  { key: "descripcion", label: "Descripción" },
  { key: "vigencia", label: "Vigencia (meses)" },
];

/** Lo mismo que admite la pantalla de vigencia del curso. */
const MAX_MONTHS = 120;

/** Vacío, «0» o «sin vigencia» = vitalicio, como cualquier curso nuevo. */
const NO_VALIDITY = /^(0|-|n\/?a|no|sin|sin vigencia|vitalicio|permanente)$/i;

/** «24», «24 meses», «2 años»… → meses. El aviso no bloquea: el curso nace vitalicio. */
function validityOf(raw: string): { months: number | null; warning?: string } {
  const text = raw.trim();
  if (!text || NO_VALIDITY.test(text)) return { months: null };
  const digits = text.match(/\d+/);
  if (!digits) return { months: null, warning: "No entendí la vigencia; el curso quedará sin vencimiento" };
  const months = /a[nñ]o/i.test(text) ? Number(digits[0]) * 12 : Number(digits[0]);
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    return { months: null, warning: `La vigencia debe ser de 1 a ${MAX_MONTHS} meses; el curso quedará sin vencimiento` };
  }
  return { months };
}

/** Los títulos que ya tiene ese dueño, en minúsculas, para no duplicar cursos. */
function titlesOf(ownerId: string): Set<string> {
  return new Set(
    db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.ownerId, ownerId))
      .all()
      .map((c) => c.title.trim().toLowerCase())
  );
}

/** Avisos por fila: sin título, repetido en el archivo o ya existente bloquean; la vigencia rara solo avisa. */
function toRows(list: CourseRow[], ownerId: string): ProposalRow[] {
  const existing = titlesOf(ownerId);
  const seen = new Set<string>();
  return list.map((c, i) => {
    const cells = { titulo: c.title, descripcion: c.description, vigencia: c.validity };
    const row = { id: `f${i}`, cells };
    if (!c.title) return { ...row, warning: "Falta el título", blocked: true };
    const key = c.title.toLowerCase();
    if (seen.has(key)) return { ...row, warning: "Repetido en el archivo", blocked: true };
    seen.add(key);
    if (existing.has(key)) return { ...row, warning: "Ya tienes un curso con ese título", blocked: true };
    const { warning } = validityOf(c.validity);
    return warning ? { ...row, warning } : row;
  });
}

/** Las celdas (ya editadas por el usuario) vuelven a ser filas de curso. */
function rowsToCourses(rows: ProposalRow[]): CourseRow[] {
  return rows.map((r) => ({
    title: (r.cells.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    description: (r.cells.descripcion ?? "").trim(),
    validity: (r.cells.vigencia ?? "").trim(),
  }));
}

/** El origen (adjunto o texto pegado) se lee igual que en el alta de alumnos. */
async function readCourses(params: Record<string, unknown>, ctx: ToolCtx): Promise<CourseRowsResult | { error: string }> {
  const origen = param(params, "origen") || "adjunto";
  const sheet = param(params, "hoja") || undefined;
  const key = getAiKey();
  const ai = key ? { key, model: getAiSettings().model } : undefined;

  if (origen === "texto") {
    const texto = param(params, "texto");
    if (!texto) return { error: "No me diste la lista de cursos." };
    return courseRows({ text: texto }, { sheet, ai });
  }
  const attachment = ctx.attachments.at(-1);
  if (!attachment) return { error: "No hay ningún archivo adjunto en este mensaje. Pide al usuario que lo adjunte." };
  const { bytes, fileName } = await attachmentBytes(attachment);
  return courseRows({ bytes, fileName }, { sheet, ai });
}

export const crearCursos: AssistantTool = {
  name: "crear_cursos",
  description:
    "Crea cursos en lote desde el archivo adjunto o una lista pegada: muestra una tabla para revisar (título, descripción y vigencia) y, al confirmar, los crea en borrador para llenarlos después.",
  parameters: schema({
    origen: strEnum("De dónde salen los cursos: «adjunto» (el archivo de este mensaje) o «texto» (una lista pegada en el chat)", ["adjunto", "texto"]),
    texto: str("Solo con origen «texto»: la lista tal como la escribió el usuario («» si viene del adjunto)"),
    hoja: str("Nombre de la hoja del archivo cuando hay varias («» = la primera)"),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  async run(params, ctx) {
    let read: CourseRowsResult;
    try {
      const result = await readCourses(params, ctx);
      if ("error" in result) return { forModel: result.error };
      read = result;
    } catch (err) {
      return { forModel: err instanceof Error ? err.message : "No pude leer la lista de cursos." };
    }
    if (read.rows.length === 0) return { forModel: `No encontré cursos en esa lista. ${read.note}`.trim() };

    const rows = toRows(read.rows, ctx.actingOwnerId);
    const proposalId = createProposal("crear_cursos", ctx, ctx.messageId, {
      title: "Crear cursos",
      applyLabel: "Crear cursos",
      columns: COLUMNS,
      rows,
      payload: {},
      // Los avisos son de datos (título vacío o repetido): si el usuario los
      // corrige en la tabla, `apply` los revalida y el curso sí se crea
      recheckOnApply: true,
    });

    // La IA solo ve cuántos son: los títulos se quedan en la tabla
    const ok = rows.filter((r) => !r.blocked).length;
    const blocked = rows.length - ok;
    const parts = [`Se creó una propuesta con ${rows.length} fila(s): ${ok} curso(s) por crear`];
    if (blocked > 0) parts.push(`${blocked} con aviso (sin título, repetidos o ya existentes)`);
    if (read.note) parts.push(read.note);
    return { forModel: `${parts.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  // Sin confirmWord: un curso en borrador no toca nada y se revisa en la tabla
  async apply(rows, _payload, ctx) {
    // Se revalida con las celdas ya editadas: un título que el usuario cambió pudo quedar repetido
    const revalidated = toRows(rowsToCourses(rows), ctx.actingOwnerId);
    const wanted = rowsToCourses(revalidated.filter((r) => !r.blocked));
    const skipped = revalidated.filter((r) => r.blocked).map((r) => r.warning ?? "ya no se puede");
    if (wanted.length === 0) return { text: "No quedó ningún curso que crear." };

    for (const c of wanted) {
      const course = createCourse({ ownerId: ctx.actingOwnerId, title: c.title, description: c.description });
      const { months } = validityOf(c.validity);
      if (months) updateCourse(course.id, { validityMode: "months", validityMonths: months });
      audit(ctx.user.id, "assistant_crear_cursos", "course", course.id, { via: "assistant" });
    }

    let text = `${wanted.length} curso(s) creado(s) en borrador. Publícalos cuando estén listos.`;
    if (skipped.length > 0) text += ` ${skipped.length} no se crearon: ${[...new Set(skipped)].join("; ")}.`;
    return { text, blocks: [{ type: "links", links: [{ label: "Ver cursos", href: "/teach/courses", icon: "course" }] }] };
  },
};
