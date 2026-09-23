import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { describePolicy } from "@/lib/validity";
import { itemAssignments, itemDocuments, questions } from "@/server/db/schema";
import { getTemplate } from "@/server/services/certificates";
import { getOwnedCourse, listCourseStudents, publishBlockers } from "@/server/services/courses";
import { getExam } from "@/server/services/exams";
import { getCourseRules, type Condition, type RuleGroup } from "@/server/services/rules-engine";
import { getItems, linearOrder } from "@/server/services/tree";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { clampForModel } from "../queries";
import { param, schema, str, type AssistantTool, type ToolResult } from "../tool-types";

/**
 * La lista de revisión de un curso: qué está listo y qué falta antes de
 * soltarlo a los alumnos.
 *
 * Todo lo que dice se comprueba de verdad contra el contenido y los
 * servicios (`publishBlockers`, las reglas de aprobación, los exámenes, las
 * tareas y los documentos). Un punto que no se pueda comprobar no se inventa:
 * lo que no aplica al curso (sin exámenes, sin tareas) ni siquiera aparece.
 */

type Punto = { punto: string; bien: boolean; detalle: string };

/** Hasta tres nombres en el detalle; el resto se resume. */
function pocos(nombres: string[]): string {
  const muestra = nombres.slice(0, 3).map((n) => `«${n}»`).join(", ");
  return nombres.length > 3 ? `${muestra} y ${nombres.length - 3} más` : muestra;
}

/** ¿El árbol de reglas incluye «completar todo el contenido requerido»? */
function exigeTodoElContenido(node: Condition | RuleGroup): boolean {
  if ("op" in node) return node.conditions.some(exigeTodoElContenido);
  return node.type === "all_items_completed";
}

const ESTADO: Record<string, string> = { draft: "borrador", published: "publicado", archived: "archivado" };

function enlaces(courseId: string): AssistantBlock {
  return {
    type: "links",
    links: [
      { label: "Ver el contenido del curso", href: `/teach/courses/${courseId}/content`, icon: "page" },
      { label: "Ajustes del curso", href: `/teach/courses/${courseId}/settings`, icon: "course" },
      { label: "Ver plantillas de diploma", href: "/teach/templates", icon: "page" },
    ],
  };
}

export const revisarCurso: AssistantTool = {
  name: "revisar_curso",
  description:
    "Revisa un curso y dice qué está listo y qué falta antes de soltarlo: contenido, lecciones que cuentan para completar, exámenes, fechas límite de las tareas, documentos, diploma y publicación.",
  parameters: schema({ curso_id: str("Id del curso, de buscar_curso") }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx): ToolResult {
    const courseId = param(params, "curso_id");
    if (!courseId) return { forModel: "Falta curso_id: dime qué curso reviso. Búscalo con buscar_curso." };
    const course = getOwnedCourse(courseId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };

    const puntos: Punto[] = [];
    const items = getItems(course.id);
    const lecciones = items.filter((i) => i.kind !== "folder");
    const visibles = linearOrder(course.id).filter((i) => i.visible);
    const requeridas = visibles.filter((i) => i.requiredForCompletion);

    // 1. Contenido
    puntos.push(
      lecciones.length > 0
        ? { punto: "Contenido", bien: true, detalle: `${lecciones.length} lección(es).` }
        : { punto: "Contenido", bien: false, detalle: "El curso no tiene ninguna lección: los alumnos lo verían vacío." }
    );

    // 2. Lecciones que cuentan para completar. Sin ninguna, la condición
    //    «completar todo el contenido requerido» se cumple sola (en el motor
    //    de reglas, `required.every(...)` sobre una lista vacía es verdadero).
    if (lecciones.length > 0) {
      const seCumpleSola = exigeTodoElContenido(getCourseRules(course.id));
      puntos.push(
        requeridas.length > 0
          ? { punto: "Lecciones para completar", bien: true, detalle: `${requeridas.length} lección(es) cuentan para aprobar.` }
          : {
              punto: "Lecciones para completar",
              bien: false,
              detalle: seCumpleSola
                ? "Ninguna lección visible cuenta para completar el curso: la condición «completar todo el contenido requerido» se cumple sola y cualquiera quedaría aprobado."
                : "Ninguna lección visible cuenta para completar el curso: el avance de los alumnos no se mide contra nada.",
            }
      );
    }

    // 3. Ocultas pero marcadas como requeridas: no se ven y tampoco cuentan
    const ocultasRequeridas = items.filter((i) => i.kind !== "folder" && !i.visible && i.requiredForCompletion);
    if (lecciones.length > 0) {
      puntos.push(
        ocultasRequeridas.length === 0
          ? { punto: "Lecciones ocultas", bien: true, detalle: "Ninguna lección oculta está marcada como requerida." }
          : {
              punto: "Lecciones ocultas",
              bien: false,
              detalle: `${pocos(ocultasRequeridas.map((i) => i.title))}: están ocultas y marcadas como requeridas, así que ni se ven ni cuentan para completar.`,
            }
      );
    }

    // 4. Exámenes: con preguntas y con puntaje mínimo
    const examenes = items.filter((i) => i.kind === "exam");
    if (examenes.length > 0) {
      const ids = examenes.map((e) => e.id);
      const conPreguntas = new Set(
        db.select({ itemId: questions.examItemId }).from(questions).where(inArray(questions.examItemId, ids)).all().map((q) => q.itemId)
      );
      const sinPreguntas = examenes.filter((e) => !conPreguntas.has(e.id));
      puntos.push(
        sinPreguntas.length === 0
          ? { punto: "Exámenes", bien: true, detalle: `${examenes.length} examen(es), todos con preguntas.` }
          : {
              punto: "Exámenes",
              bien: false,
              detalle: `${pocos(sinPreguntas.map((e) => e.title))}: sin ninguna pregunta; el alumno abriría un examen vacío.`,
            }
      );

      const sinMinimo = examenes.filter((e) => (getExam(e.id)?.passScore ?? null) === null);
      puntos.push(
        sinMinimo.length === 0
          ? { punto: "Puntaje mínimo", bien: true, detalle: "Todos los exámenes tienen puntaje mínimo." }
          : {
              punto: "Puntaje mínimo",
              bien: false,
              detalle: `${pocos(sinMinimo.map((e) => e.title))}: sin puntaje mínimo, así que nadie los reprueba.`,
            }
      );
    }

    // 5. Tareas con fecha límite
    const tareas = items.filter((i) => i.kind === "assignment");
    if (tareas.length > 0) {
      const conFecha = new Set(
        db
          .select({ itemId: itemAssignments.itemId, dueAt: itemAssignments.dueAt })
          .from(itemAssignments)
          .where(inArray(itemAssignments.itemId, tareas.map((t) => t.id)))
          .all()
          .filter((a) => a.dueAt !== null)
          .map((a) => a.itemId)
      );
      const sinFecha = tareas.filter((t) => !conFecha.has(t.id));
      puntos.push(
        sinFecha.length === 0
          ? { punto: "Fechas límite", bien: true, detalle: `Las ${tareas.length} tarea(s) tienen fecha límite.` }
          : {
              punto: "Fechas límite",
              bien: false,
              detalle: `${pocos(sinFecha.map((t) => t.title))}: sin fecha límite, así que nunca se marcan como vencidas.`,
            }
      );
    }

    // 6. Documentos: los que no están listos abrirían una lección en blanco
    const documentos =
      items.length === 0
        ? []
        : db
            .select({ itemId: itemDocuments.itemId, estado: itemDocuments.processingStatus })
            .from(itemDocuments)
            .where(inArray(itemDocuments.itemId, items.map((i) => i.id)))
            .all();
    if (documentos.length > 0) {
      const titulo = new Map(items.map((i) => [i.id, i.title]));
      const fallados = documentos.filter((d) => d.estado === "error").map((d) => titulo.get(d.itemId) ?? "Una lección");
      const enProceso = documentos.filter((d) => d.estado !== "error" && d.estado !== "ready").map((d) => titulo.get(d.itemId) ?? "Una lección");
      const problemas = [
        fallados.length > 0 ? `${pocos(fallados)}: el documento falló al procesarse` : "",
        enProceso.length > 0 ? `${pocos(enProceso)}: el documento sigue procesándose` : "",
      ].filter(Boolean);
      puntos.push(
        problemas.length === 0
          ? { punto: "Documentos", bien: true, detalle: `${documentos.length} documento(s) listos.` }
          : { punto: "Documentos", bien: false, detalle: `${problemas.join("; ")}.` }
      );
    }

    // 7. Diploma
    const plantilla = course.certificateTemplateId ? getTemplate(course.certificateTemplateId) : null;
    const vigencia = course.validityMode !== "lifetime" ? ` El curso tiene vigencia: ${describePolicy(course.validityMode, course.validityMonths).toLowerCase()}.` : "";
    puntos.push(
      plantilla
        ? { punto: "Diploma", bien: true, detalle: `Diploma «${plantilla.name}».${vigencia}` }
        : {
            punto: "Diploma",
            bien: false,
            detalle: course.certificateTemplateId
              ? `La plantilla de diploma que tenía asignada ya no existe: quien complete el curso no recibirá certificado.${vigencia}`
              : `Sin plantilla de diploma: quien complete el curso no recibirá certificado.${vigencia}`,
          }
    );

    // 8. Estado: publicar (borrador) o matriculados (publicado)
    if (course.status === "draft") {
      const bloqueos = publishBlockers(course.id);
      puntos.push(
        bloqueos.length === 0
          ? { punto: "Publicar", bien: true, detalle: "Está en borrador y no hay nada que impida publicarlo." }
          : { punto: "Publicar", bien: false, detalle: bloqueos.join(" ") }
      );
    } else if (course.status === "published") {
      const matriculados = listCourseStudents(course.id).length;
      puntos.push(
        matriculados > 0
          ? { punto: "Matriculados", bien: true, detalle: `${matriculados} alumno(s) matriculados.` }
          : { punto: "Matriculados", bien: false, detalle: "Está publicado y todavía no hay nadie matriculado." }
      );
    } else {
      puntos.push({ punto: "Estado", bien: true, detalle: "Está archivado: los alumnos ya no lo ven y no se borró nada." });
    }

    const faltan = puntos.filter((p) => !p.bien);
    const blocks: AssistantBlock[] = [];
    if (faltan.length === 0) {
      blocks.push({ type: "text", text: `Todo en orden en **${course.title}**: no encontré nada pendiente.` });
    }
    blocks.push(
      { type: "tiles", tiles: [{ label: "Listo", value: String(puntos.length - faltan.length) }, { label: "Por revisar", value: String(faltan.length) }] },
      {
        type: "table",
        columns: ["Punto", "Estado", "Detalle"],
        rows: puntos.map((p) => [p.punto, p.bien ? "bien" : "falta", p.detalle]),
      },
      enlaces(course.id)
    );

    const resumen =
      faltan.length === 0
        ? `«${course.title}» (${ESTADO[course.status] ?? course.status}): los ${puntos.length} puntos están bien, no hay nada pendiente.`
        : `«${course.title}» (${ESTADO[course.status] ?? course.status}): ${puntos.length - faltan.length} bien y ${faltan.length} por revisar — ${faltan.map((p) => p.punto.toLowerCase()).join(", ")}.`;
    return { forModel: clampForModel(`${resumen} id=${course.id}`), blocks };
  },
};
