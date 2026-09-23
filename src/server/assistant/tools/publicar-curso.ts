import "server-only";
import { audit } from "@/server/services/audit";
import { getOwnedCourse, publishCourse, setCourseStatus, type Course } from "@/server/services/courses";
import { getItems } from "@/server/services/tree";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { schema, str, strEnum, param, type AssistantTool, type ToolCtx, type ToolResult } from "../tool-types";

/**
 * Publicar, archivar o devolver a borrador un curso. Es lo mismo que los
 * botones de la cabecera del curso:
 *
 * - Publicar pasa por `publishCourse`, que NO publica si algún documento
 *   sigue procesándose (el alumno abriría una lección vacía). Aquí se suma una
 *   comprobación previa: un curso sin nada dentro tampoco se publica, porque
 *   los estudiantes lo verían sin una sola lección.
 * - Archivar lo saca de la vista de los estudiantes sin borrar nada.
 * - Borrador lo devuelve a edición.
 *
 * Los tres cambios se hacen al momento y se pueden deshacer: el curso vuelve
 * al estado que tenía.
 */

type Estado = Course["status"];

const ESTADO_TEXTO: Record<Estado, string> = {
  draft: "borrador",
  published: "publicado",
  archived: "archivado",
};

/** Qué estado deja cada acción. */
const DESTINO: Record<string, Estado> = {
  publicar: "published",
  archivar: "archived",
  borrador: "draft",
};

function enlaces(courseId: string): AssistantBlock {
  return {
    type: "links",
    links: [
      { label: "Ver el curso", href: `/teach/courses/${courseId}`, icon: "course" },
      { label: "Ver el contenido del curso", href: `/teach/courses/${courseId}/content`, icon: "page" },
    ],
  };
}

/** Lo que el alumno vería: las lecciones del curso (las carpetas no cuentan). */
function tieneContenido(courseId: string): boolean {
  return getItems(courseId).some((item) => item.kind !== "folder");
}

/** Respuesta cuando no se puede publicar: qué falta y dónde arreglarlo. */
function conBloqueos(course: Course, blockers: string[]): ToolResult {
  const lista = blockers.map((b) => `- ${b}`).join("\n");
  return {
    forModel: `No publiqué ${course.title}: faltan ${blockers.length} cosa(s) y el usuario ya las ve en pantalla. Sigue en ${ESTADO_TEXTO[course.status]}.`,
    blocks: [
      { type: "text", text: `No se puede publicar **${course.title}** todavía. Falta:\n${lista}` },
      { type: "links", links: [{ label: "Ver el contenido del curso", href: `/teach/courses/${course.id}/content`, icon: "page" }] },
    ],
  };
}

/** Deja constancia del cambio de estado (también al deshacer). */
function registrar(ctx: ToolCtx, course: Course, accion: string, anterior: Estado, nuevo: Estado) {
  audit(ctx.user.id, accion, "courses", course.id, {
    via: "assistant",
    conversationId: ctx.conversationId,
    anterior,
    nuevo,
  });
}

export const publicarCurso: AssistantTool = {
  name: "publicar_curso",
  description:
    "Publica un curso (los estudiantes matriculados ya pueden verlo), lo archiva (deja de verse, no se borra nada) o lo devuelve a borrador. Publicar no se hace si falta contenido o hay documentos sin procesar: entonces se dice qué falta. El cambio se puede deshacer.",
  parameters: schema({
    curso_id: str("Id del curso, de buscar_curso"),
    accion: strEnum(
      "Qué hacer: «publicar» (los estudiantes ya lo ven), «archivar» (deja de verse, no se borra nada) o «borrador» (vuelve a edición)",
      ["publicar", "archivar", "borrador"]
    ),
  }),
  roles: ["admin", "teacher"],
  // Cambiar el estado es un clic y se deshace con otro
  risk: "instant",
  run(params, ctx) {
    const courseId = param(params, "curso_id");
    if (!courseId) return { forModel: "Falta curso_id: dime de qué curso. Búscalo con buscar_curso." };
    const course = getOwnedCourse(courseId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };

    const accion = param(params, "accion");
    const destino = DESTINO[accion];
    if (!destino) return { forModel: "No entendí la acción: usa publicar, archivar o borrador." };
    const anterior = course.status;
    if (anterior === destino) {
      return { forModel: `${course.title} ya está ${ESTADO_TEXTO[anterior]}; no cambié nada.`, blocks: [enlaces(course.id)] };
    }

    if (accion === "publicar") {
      // Antes de llamar a publishCourse: si publica, ya no hay vuelta atrás sin otro cambio
      if (!tieneContenido(course.id)) {
        return conBloqueos(course, ["No tiene ninguna lección todavía: agrega contenido antes de publicarlo."]);
      }
      const result = publishCourse(course.id);
      if (!result.ok) {
        return conBloqueos(
          course,
          result.blockers.map((titulo) => `«${titulo}»: el documento sigue procesándose o falló.`)
        );
      }
    } else {
      setCourseStatus(course.id, destino);
    }

    registrar(ctx, course, "assistant_publicar_curso", anterior, destino);
    const text =
      destino === "published"
        ? `${course.title} está publicado: los estudiantes matriculados ya pueden verlo.`
        : destino === "archived"
          ? `${course.title} está archivado: deja de verse, no se borró nada.`
          : `${course.title} volvió a borrador: los estudiantes dejan de verlo.`;
    return {
      forModel: text,
      blocks: [{ type: "result", text, undoable: true }, enlaces(course.id)],
      undo: { tool: "publicar_curso", params: { curso_id: course.id, estado_anterior: anterior } },
    };
  },
  /**
   * Deshacer: el curso vuelve al estado que tenía hace un momento, aunque sea
   * «publicado» (no se revisa de nuevo el contenido: estaba así hasta hace un
   * instante). Si no se puede, lanza: así el mensaje no se marca como deshecho.
   */
  undo(params, ctx) {
    const course = getOwnedCourse(param(params, "curso_id"), ctx.user);
    if (!course) throw new Error("No se pudo deshacer: el curso ya no está disponible.");
    const anterior = param(params, "estado_anterior") as Estado;
    if (!ESTADO_TEXTO[anterior]) throw new Error("No se pudo deshacer: no sé en qué estado estaba.");
    if (course.status === anterior) {
      throw new Error(`No se pudo deshacer: ${course.title} ya está ${ESTADO_TEXTO[anterior]}.`);
    }
    setCourseStatus(course.id, anterior);
    registrar(ctx, course, "assistant_publicar_curso_undo", course.status, anterior);
    const text = `${course.title} volvió a estar ${ESTADO_TEXTO[anterior]}.`;
    return { forModel: text, blocks: [{ type: "result", text }, enlaces(course.id)] };
  },
};
