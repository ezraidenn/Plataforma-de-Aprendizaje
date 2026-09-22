import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { getOwnedCourse } from "@/server/services/courses";
import { cohortsForRows, importStudents, studentRowsToCsv } from "@/server/services/csv-import";
import { studentDraftProblem } from "@/lib/student-draft";
import { attachmentBytes } from "@/server/services/attachment-intake";
import { getAiKey, getAiSettings } from "@/server/services/ai-settings";
import { peopleRows, type PersonRow, type RowsResult } from "../rows-from-attachment";
import { createProposal } from "../proposal-store";
import { schema, str, strEnum, param, type AssistantTool, type ToolCtx } from "../tool-types";
import type { AssistantBlock, ProposalRow } from "@/lib/assistant-blocks";
import type { ColorFamily } from "@/lib/attachment-summary";

/**
 * Alta de alumnos en lote, del archivo adjunto o de una lista pegada. La IA
 * solo dice de dónde sacarlos; el servidor lee el archivo completo, arma la
 * tabla de revisión y, al confirmar, crea las cuentas con las MISMAS reglas
 * que el CSV (`importStudents`).
 */

const COLUMNS = [
  { key: "nombre", label: "Nombre" },
  { key: "correo", label: "Correo" },
  { key: "grupo", label: "Grupo" },
];

/** Aviso de quien ya tiene cuenta cuando hay curso: no se bloquea, solo se matricula. */
const ONLY_ENROLL = "Ya tiene cuenta: solo se matriculará";

/**
 * Avisos por fila: los del CSV, más los repetidos dentro del propio archivo.
 * Un correo que ya tiene cuenta solo bloquea la fila cuando NO hay curso: con
 * curso, la lista mixta es lo normal y a esa persona se le matricula sin más.
 */
function toRows(people: PersonRow[], hasCourse: boolean): ProposalRow[] {
  const emails = people.map((p) => p.email).filter(Boolean);
  const existing = new Map(
    emails.length
      ? db.select({ email: users.email, role: users.role }).from(users).where(inArray(users.email, emails)).all().map((u) => [u.email, u.role] as const)
      : []
  );
  const seen = new Set<string>();
  return people.map((p, i) => {
    const cells = { nombre: p.fullName, correo: p.email, grupo: p.group };
    const problem = studentDraftProblem(p);
    if (problem) return { id: `f${i}`, cells, warning: problem, blocked: true };
    if (seen.has(p.email)) return { id: `f${i}`, cells, warning: "Repetida en el archivo", blocked: true };
    seen.add(p.email);
    const role = existing.get(p.email);
    if (role) {
      // Solo una cuenta de alumno se puede matricular: la de un maestro no
      if (!hasCourse || role !== "student") return { id: `f${i}`, cells, warning: "Ese correo ya tiene cuenta", blocked: true };
      return { id: `f${i}`, cells, warning: ONLY_ENROLL };
    }
    return { id: `f${i}`, cells };
  });
}

/** También la usa `baja_alumnos`: el origen (adjunto o texto pegado) se lee igual. */
export async function readPeople(params: Record<string, unknown>, ctx: ToolCtx): Promise<RowsResult | { error: string }> {
  const origen = param(params, "origen") || "adjunto";
  const color = (param(params, "filtro_color") || undefined) as ColorFamily | undefined;
  const sheet = param(params, "hoja") || undefined;
  const key = getAiKey();
  const ai = key ? { key, model: getAiSettings().model } : undefined;

  if (origen === "texto") {
    const texto = param(params, "texto");
    if (!texto) return { error: "No me diste la lista." };
    return peopleRows({ text: texto }, { sheet, color, ai });
  }
  const attachment = ctx.attachments.at(-1);
  if (!attachment) return { error: "No hay ningún archivo adjunto en este mensaje. Pide al usuario que lo adjunte." };
  const { bytes, fileName } = await attachmentBytes(attachment);
  return peopleRows({ bytes, fileName }, { sheet, color, ai });
}

export const altaAlumnos: AssistantTool = {
  name: "alta_alumnos",
  description:
    "Da de alta alumnos en lote desde el archivo adjunto o una lista pegada: muestra una tabla para revisar antes de crear las cuentas y, si se indica un curso, los matricula en el mismo paso.",
  parameters: schema({
    origen: strEnum("De dónde salen los alumnos: «adjunto» (el archivo de este mensaje) o «texto» (una lista pegada en el chat)", ["adjunto", "texto"]),
    texto: str("Solo con origen «texto»: la lista tal como la escribió el usuario («» si viene del adjunto)"),
    hoja: str("Nombre de la hoja del archivo cuando hay varias («» = la primera)"),
    filtro_color: strEnum("Tomar solo las filas pintadas de ese color en la hoja («» = todas)", ["", "rojo", "verde", "amarillo", "azul"]),
    curso_id: str("Id del curso en el que matricularlos al crearlos, de buscar_curso («» = solo darlos de alta)"),
    grupo: str("Grupo del curso para todas las filas («» = el que traiga cada una)"),
  }),
  roles: ["admin", "teacher"],
  risk: "review",
  async run(params, ctx) {
    const courseId = param(params, "curso_id");
    const course = courseId ? getOwnedCourse(courseId, ctx.user) : null;
    if (courseId && !course) return { forModel: "No encontramos ese curso o no te pertenece; no se dio de alta a nadie." };

    let people: RowsResult;
    try {
      const read = await readPeople(params, ctx);
      if ("error" in read) return { forModel: read.error };
      people = read;
    } catch (err) {
      return { forModel: err instanceof Error ? err.message : "No pude leer la lista de alumnos." };
    }
    if (people.rows.length === 0) {
      return { forModel: `No encontré personas en esa lista. ${people.note}`.trim() };
    }

    const rows = toRows(people.rows, !!course);
    const grupo = param(params, "grupo");
    const proposalId = createProposal("alta_alumnos", ctx, ctx.messageId, {
      title: course ? `Dar de alta y matricular en ${course.title}` : "Dar de alta alumnos",
      applyLabel: "Dar de alta",
      columns: COLUMNS,
      rows,
      payload: { courseId: course?.id ?? "", courseTitle: course?.title ?? "", grupo },
    });

    // La IA solo ve cuántas son: los nombres y correos se quedan en la tabla
    const yaExisten = rows.filter((r) => r.warning === ONLY_ENROLL).length;
    const ok = rows.filter((r) => !r.blocked).length - yaExisten;
    const blocked = rows.length - ok - yaExisten;
    const parts = [`Se creó una propuesta con ${rows.length} fila(s): ${ok} nueva(s) para dar de alta`];
    if (yaExisten > 0) parts.push(`${yaExisten} que ya tienen cuenta y solo se matriculan`);
    if (blocked > 0) parts.push(`${blocked} con aviso (sin correo, repetidas o con cuenta ya creada)`);
    if (course) parts.push(`se matricularán en ${course.title}`);
    if (people.note) parts.push(people.note);
    return { forModel: `${parts.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  // Sin confirmWord: crear cuentas no borra nada y el alta se revisa en la tabla
  async apply(rows, payload, ctx) {
    const courseId = String(payload.courseId ?? "");
    const course = courseId ? getOwnedCourse(courseId, ctx.user) : null;
    if (courseId && !course) return { text: "El curso ya no está disponible; no se dio de alta a nadie." };

    const forced = String(payload.grupo ?? "").trim();
    const people = rows
      .map((r) => ({
        fullName: (r.cells.nombre ?? "").trim(),
        email: (r.cells.correo ?? "").trim().toLowerCase(),
        group: forced || (r.cells.grupo ?? "").trim(),
      }))
      .filter((p) => p.email);
    if (people.length === 0) return { text: "No quedó ninguna fila que dar de alta." };

    // El grupo solo existe dentro de un curso; sin curso se ignora
    let cohortByEmail: Record<string, string> | undefined;
    if (course && people.some((p) => p.group)) {
      try {
        cohortByEmail = cohortsForRows(course.id, people, ctx.user.id);
      } catch (err) {
        // Un grupo cerrado con ese nombre: se dice y no se crea ninguna cuenta
        return { text: `${err instanceof Error ? err.message : "No se pudo preparar el grupo."} No se dio de alta a nadie.` };
      }
    }

    const result = await importStudents({
      csvText: studentRowsToCsv(people),
      createdBy: course ? course.ownerId : ctx.actingOwnerId,
      actorId: ctx.user.id,
      enrollCourseId: course?.id ?? null,
      // Con curso, quien ya tenía cuenta no se crea de nuevo pero sí se matricula
      enrollDuplicates: !!course,
      cohortByEmail,
      auditAction: "assistant_alta_alumnos",
    });

    const parts = [`${result.created} alumno(s) creado(s)`];
    if (course) parts.push(`${result.enrolled} matriculado(s) en ${course.title}`);
    if (result.skipped > 0) parts.push(`${result.skipped} omitido(s)`);
    let text = `${parts.join(", ")}.`;
    if (result.created > 0) {
      text += " Las contraseñas se generaron automáticamente: si alguien no puede entrar, restablécela desde Estudiantes.";
    }

    const links: AssistantBlock = {
      type: "links",
      links: [
        { label: "Ver estudiantes", href: "/teach/students", icon: "user" },
        ...(course ? [{ label: `Ver ${course.title}`, href: `/teach/courses/${course.id}/students`, icon: "course" as const }] : []),
      ],
    };
    return { text, blocks: [links] };
  },
};
