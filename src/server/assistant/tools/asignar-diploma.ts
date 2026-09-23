import "server-only";
import { audit } from "@/server/services/audit";
import {
  assignableTemplateInfo,
  canAssignTemplate,
  listAssignableTemplates,
  type AssignableTemplate,
} from "@/server/services/certificates";
import { getOwnedCourse, updateCourse, type Course } from "@/server/services/courses";
import type { AssistantBlock, ProposalRow } from "@/lib/assistant-blocks";
import { createProposal } from "../proposal-store";
import {
  schema,
  str,
  strEnum,
  strList,
  param,
  paramList,
  type AssistantTool,
  type ToolCtx,
  type ToolResult,
} from "../tool-types";

/**
 * Qué diploma sale cuando alguien aprueba un curso: la plantilla que guarda
 * `courses.certificate_template_id` (el selector de Ajustes del curso). Un
 * curso sin plantilla no emite certificados.
 *
 * Solo se pueden poner las plantillas que el usuario podría elegir en esa
 * pantalla (las suyas y las generales del administrador), así que la búsqueda
 * por nombre se hace sobre esa lista y nunca sobre las de otro maestro.
 *
 * Con un curso se hace al momento y se deshace (vuelve al diploma anterior o a
 * ninguno); con varios se propone una tabla para revisar.
 */

// Todo viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "curso", label: "Curso", editable: false },
  { key: "actual", label: "Diploma actual", editable: false },
  { key: "nuevo", label: "Diploma nuevo", editable: false },
];

const NINGUNO = "Sin diploma";

/** Cuántas plantillas se enumeran en el chat cuando hay que preguntar. */
const MAX_SUGERIDAS = 8;

function enlaces(courseId: string): AssistantBlock {
  return {
    type: "links",
    links: [
      { label: "Ajustes del curso", href: `/teach/courses/${courseId}/settings`, icon: "course" },
      { label: "Ver plantillas de diploma", href: "/teach/templates", icon: "page" },
    ],
  };
}

/** Minúsculas, sin acentos y sin espacios de sobra: así se compara un nombre dicho de viva voz. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function nombreDe(templateId: string | null): string {
  if (!templateId) return NINGUNO;
  // Sin permisos: es el diploma que YA tiene el curso, solo hay que nombrarlo
  return assignableTemplateInfo(templateId)?.name ?? "Otro diploma";
}

/** Las plantillas, para enumerarlas cuando hay que preguntar cuál. */
function listaDe(plantillas: AssignableTemplate[]): string {
  const nombres = plantillas.slice(0, MAX_SUGERIDAS).map((t) => `«${t.name}»${t.general ? " (general)" : ""}`);
  if (plantillas.length > MAX_SUGERIDAS) nombres.push(`y ${plantillas.length - MAX_SUGERIDAS} más`);
  return nombres.join(", ");
}

/**
 * La plantilla que quiso decir el usuario: por id, por nombre exacto (sin
 * distinguir mayúsculas ni acentos) o por un trozo del nombre. Si hay varias
 * parecidas no se elige ninguna: se enumeran y se pregunta.
 */
function resolverPlantilla(texto: string, ctx: ToolCtx): { plantilla: AssignableTemplate } | { error: string } {
  const plantillas = listAssignableTemplates(ctx.user);
  if (plantillas.length === 0) {
    return { error: "No tienes ninguna plantilla de diploma todavía. Se crean en la pantalla de Certificados (/teach/templates)." };
  }
  const porId = plantillas.find((t) => t.id === texto);
  if (porId) return { plantilla: porId };

  const buscado = normalizar(texto);
  const exactas = plantillas.filter((t) => normalizar(t.name) === buscado);
  const candidatas = exactas.length > 0 ? exactas : plantillas.filter((t) => normalizar(t.name).includes(buscado));
  if (candidatas.length === 1) return { plantilla: candidatas[0] };
  if (candidatas.length > 1) {
    return { error: `Hay varias plantillas que se parecen a «${texto}»: ${listaDe(candidatas)}. Pregúntale al usuario cuál de ellas y no elijas tú.` };
  }
  return { error: `No encontré ninguna plantilla de diploma que se llame «${texto}». Las que puedes usar son: ${listaDe(plantillas)}.` };
}

type Fila = { row: ProposalRow; course: Course | null };

/** Una fila por curso, con el diploma que tiene y el que tendría. */
function filasDe(courseIds: string[], plantilla: AssignableTemplate | null, ctx: ToolCtx): Fila[] {
  const nuevo = plantilla?.name ?? NINGUNO;
  return courseIds.map((id) => {
    const course = getOwnedCourse(id, ctx.user);
    if (!course) {
      return { course: null, row: { id, cells: { curso: id, actual: "", nuevo }, warning: "No es uno de tus cursos", blocked: true } };
    }
    const cells = { curso: course.title, actual: nombreDe(course.certificateTemplateId), nuevo };
    if (plantilla && !canAssignTemplate(ctx.user, plantilla.id)) {
      return { course, row: { id, cells, warning: "No puedes asignar esa plantilla", blocked: true } };
    }
    if ((course.certificateTemplateId ?? null) === (plantilla?.id ?? null)) {
      const aviso = plantilla ? "Ya tiene ese diploma" : "No tiene ningún diploma asignado";
      return { course, row: { id, cells, warning: aviso, blocked: true } };
    }
    return { course, row: { id, cells } };
  });
}

/** Pone (o quita) el diploma y deja constancia. */
function asignar(course: Course, templateId: string | null, ctx: ToolCtx, accion: string) {
  const anterior = course.certificateTemplateId ?? null;
  updateCourse(course.id, { certificateTemplateId: templateId });
  audit(ctx.user.id, accion, "courses", course.id, {
    via: "assistant",
    conversationId: ctx.conversationId,
    plantilla: templateId,
    anterior,
  });
}

export const asignarDiploma: AssistantTool = {
  name: "asignar_diploma",
  description:
    "Dice qué plantilla de diploma usa un curso al aprobarlo, o se la quita. La plantilla se busca por nombre entre las que el usuario puede usar (las suyas y las generales). Con un curso se aplica al momento; con varios se muestra una tabla para revisar.",
  parameters: schema({
    plantilla: str("Nombre (o id) de la plantilla de diploma; «» cuando se está quitando"),
    curso_ids: strList("Ids de los cursos, de buscar_curso (lista vacía = pregúntale al usuario a qué curso)"),
    quitar: strEnum('«si» para dejar el curso sin diploma; «» para asignar la plantilla', ["", "si"]),
  }),
  roles: ["admin", "teacher"],
  // Como matricular: un curso al momento con deshacer; varios, tabla de revisión
  risk: "instant",
  run(params, ctx): ToolResult {
    const courseIds = [...new Set(paramList(params, "curso_ids"))];
    if (courseIds.length === 0) {
      return { forModel: "Falta a qué curso: pásame los curso_ids (de buscar_curso) o pregúntale al usuario de qué curso habla." };
    }

    const quitar = param(params, "quitar") === "si";
    let plantilla: AssignableTemplate | null = null;
    if (!quitar) {
      const texto = param(params, "plantilla");
      if (!texto) {
        const disponibles = listAssignableTemplates(ctx.user);
        return {
          forModel:
            disponibles.length === 0
              ? "No tienes ninguna plantilla de diploma todavía. Se crean en la pantalla de Certificados (/teach/templates)."
              : `Falta qué diploma poner. Las que puedes usar son: ${listaDe(disponibles)}. Pregúntale al usuario cuál.`,
        };
      }
      const resuelta = resolverPlantilla(texto, ctx);
      if ("error" in resuelta) return { forModel: resuelta.error };
      plantilla = resuelta.plantilla;
    }

    const filas = filasDe(courseIds, plantilla, ctx);
    const destino = plantilla ? `«${plantilla.name}»` : "sin diploma";

    // Uno solo: no hay nada que revisar y volver atrás es un clic
    if (filas.length === 1) {
      const [fila] = filas;
      if (fila.row.blocked || !fila.course) return { forModel: `No se pudo cambiar el diploma: ${fila.row.warning}.` };
      const anterior = fila.course.certificateTemplateId ?? null;
      asignar(fila.course, plantilla?.id ?? null, ctx, "assistant_asignar_diploma");
      const text = plantilla
        ? `${fila.course.title} emitirá el diploma «${plantilla.name}» (antes ${fila.row.cells.actual.toLowerCase()}).`
        : `${fila.course.title} se quedó sin diploma: ya no emitirá certificados al aprobarlo (antes «${fila.row.cells.actual}»).`;
      return {
        forModel: text,
        blocks: [{ type: "result", text, undoable: true }, enlaces(fila.course.id)],
        undo: { tool: "asignar_diploma", params: { curso_id: fila.course.id, plantilla_anterior: anterior ?? "" } },
      };
    }

    const rows = filas.map((f) => f.row);
    const proposalId = createProposal("asignar_diploma", ctx, ctx.messageId, {
      title: plantilla ? `Poner el diploma «${plantilla.name}» en ${rows.length} cursos` : `Quitar el diploma de ${rows.length} cursos`,
      applyLabel: plantilla ? "Asignar diploma" : "Quitar diploma",
      columns: COLUMNS,
      rows,
      payload: { templateId: plantilla?.id ?? "", templateName: plantilla?.name ?? "" },
    });
    const ok = rows.filter((r) => !r.blocked).length;
    const bloqueadas = rows.length - ok;
    const partes = [`Se creó una propuesta con ${rows.length} curso(s): ${ok} quedarían ${destino}`];
    if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (no es tu curso, la plantilla no es tuya o ya lo tenían así)`);
    return { forModel: `${partes.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Aplica las filas ya revisadas. Revalida: los cursos siguen siendo del
   * usuario y la plantilla sigue siendo suya (o general); lo que hoy esté
   * bloqueado no se toca.
   */
  apply(rows, payload, ctx) {
    const templateId = String(payload.templateId ?? "");
    const plantilla = templateId ? assignableTemplateInfo(templateId) : null;
    if (templateId && !plantilla) return { text: "Esa plantilla de diploma ya no existe; no cambié ningún curso." };

    const filas = filasDe(rows.map((r) => r.id), plantilla, ctx);
    const motivos: string[] = [];
    let hechos = 0;
    for (const fila of filas) {
      if (fila.row.blocked || !fila.course) {
        motivos.push(fila.row.warning ?? "ya no se puede");
        continue;
      }
      asignar(fila.course, plantilla?.id ?? null, ctx, "assistant_asignar_diploma");
      hechos++;
    }

    let text = plantilla
      ? `${hechos} curso(s) emitirán el diploma «${plantilla.name}».`
      : `${hechos} curso(s) se quedaron sin diploma: ya no emitirán certificados al aprobarlos.`;
    if (motivos.length > 0) text += ` ${motivos.length} no se pudieron: ${[...new Set(motivos)].join("; ")}.`;
    const primero = filas.find((f) => f.course)?.course;
    return { text, blocks: primero ? [enlaces(primero.id)] : [] };
  },
  /**
   * Deshacer: el curso vuelve al diploma que tenía (o a ninguno). No se vuelve
   * a comprobar la plantilla: estaba puesta hace un momento. Si no se puede,
   * lanza: así el mensaje no se marca como deshecho.
   */
  undo(params, ctx) {
    const course = getOwnedCourse(param(params, "curso_id"), ctx.user);
    if (!course) throw new Error("No se pudo deshacer: el curso ya no está disponible.");
    const anterior = param(params, "plantilla_anterior");
    if (anterior && !assignableTemplateInfo(anterior)) {
      throw new Error("No se pudo deshacer: la plantilla que tenía antes ya no existe.");
    }
    asignar(course, anterior || null, ctx, "assistant_asignar_diploma_undo");
    const text = anterior
      ? `${course.title} vuelve a emitir el diploma «${nombreDe(anterior)}».`
      : `${course.title} se quedó otra vez sin diploma.`;
    return { forModel: text, blocks: [{ type: "result", text }, enlaces(course.id)] };
  },
};
