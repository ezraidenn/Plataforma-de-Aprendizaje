import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { enrollments } from "@/server/db/schema";
import { audit } from "@/server/services/audit";
import {
  createCourse,
  deleteCourse,
  getOwnedCourse,
  updateCourse,
  type Course,
} from "@/server/services/courses";
import { duplicateItem, getItems } from "@/server/services/tree";
import { copyStoredFile } from "@/server/services/storage";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { schema, str, strEnum, param, type AssistantTool, type ToolCtx, type ToolResult } from "../tool-types";

/**
 * Duplicar un curso: la copia nace EN BORRADOR, a nombre del maestro del
 * contexto, con la misma configuración (descripción, vigencia, secuencia
 * obligatoria, diploma y portada) y, si se pide, con todo el contenido.
 *
 * El contenido lo copia la misma copia profunda de «copiar y pegar lecciones»
 * (`duplicateItem`), rama por rama y en orden: carpetas con lo que llevan
 * dentro, documentos, videos, textos, enlaces, recursos, tareas y exámenes con
 * sus preguntas. Los archivos de las lecciones NO se comparten: cada copia
 * estrena los suyos en el almacenamiento, así que borrar la copia nunca toca
 * los del original. Las imágenes del editor sí se comparten, entre ellas la
 * foto y los íconos de las preguntas sobre imagen: son de la plataforma y
 * borrar la copia tampoco las retira.
 *
 * Lo que NO se copia, porque es de las personas y no del curso: alumnos,
 * matrículas, entregas, intentos y certificados. Tampoco las reglas de
 * aprobación, que apuntan a los exámenes del curso original (la copia queda
 * con la regla de siempre: terminar todo).
 *
 * Se hace al momento y se puede deshacer, pero solo mientras la copia siga
 * recién hecha: en cuanto tenga alumnos o cambios, borrarla sería perder algo.
 */

/** A partir de aquí la copia tarda lo suyo y conviene decirlo. */
const CURSO_GRANDE = 200;

function enlaces(courseId: string): AssistantBlock {
  return {
    type: "links",
    links: [
      { label: "Ver el curso", href: `/teach/courses/${courseId}`, icon: "course" },
      { label: "Ver el contenido del curso", href: `/teach/courses/${courseId}/content`, icon: "page" },
    ],
  };
}

/** Matrículas del curso, de cualquier estatus (también las dadas de baja). */
function matriculas(courseId: string): number {
  return (
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))
      .get()?.n ?? 0
  );
}

/** Deja constancia de la copia (y de deshacerla) con el origen y el destino. */
function registrar(ctx: ToolCtx, accion: string, origenId: string, copiaId: string, extra: Record<string, unknown> = {}) {
  audit(ctx.user.id, accion, "courses", copiaId, {
    via: "assistant",
    conversationId: ctx.conversationId,
    origen: origenId,
    copia: copiaId,
    ...extra,
  });
}

export const duplicarCurso: AssistantTool = {
  name: "duplicar_curso",
  description:
    "Duplica un curso: crea una copia en borrador con la misma configuración (descripción, vigencia, secuencia, diploma y portada) y, si se pide, con todo su contenido (carpetas, lecciones, tareas y exámenes con sus preguntas). No copia alumnos, matrículas, entregas, intentos ni certificados. Se puede deshacer mientras la copia siga sin alumnos.",
  parameters: schema({
    curso_id: str("Id del curso que se copia, de buscar_curso"),
    titulo_nuevo: str("Título de la copia («» = el del original con «(copia)» al final)"),
    con_contenido: strEnum(
      "«si» (o «») copia también las carpetas, lecciones, tareas y exámenes; «no» crea el curso vacío, solo con su configuración",
      ["", "si", "no"]
    ),
  }),
  roles: ["admin", "teacher"],
  // Como publicar: se hace al momento y se deshace borrando la copia
  risk: "instant",
  async run(params, ctx): Promise<ToolResult> {
    const courseId = param(params, "curso_id");
    if (!courseId) return { forModel: "Falta curso_id: dime qué curso copiar. Búscalo con buscar_curso." };
    const source = getOwnedCourse(courseId, ctx.user);
    if (!source) return { forModel: "No encontramos ese curso o no te pertenece." };

    const conContenido = param(params, "con_contenido") !== "no";
    const titulo =
      param(params, "titulo_nuevo").replace(/\s+/g, " ").trim().slice(0, 200) || `${source.title} (copia)`;

    // Ramas de primer nivel, en el orden en que se ven en el contenido: cada
    // una se copia entera (una carpeta se lleva lo que tiene dentro)
    const items = conContenido ? getItems(source.id) : [];
    const ramas = items.filter((item) => item.parentId === null).sort((a, b) => a.position - b.position);

    // Desde aquí, o queda la copia entera o no queda nada: cada rama se copia
    // en su propia transacción (`duplicateItem`) y, si alguna falla, se borra
    // el curso a medio hacer con los archivos que hubiera estrenado.
    const copia = createCourse({ ownerId: ctx.actingOwnerId, title: titulo, description: source.description });
    let copiados = 0;
    let sinArchivo = 0;
    let portada: string | null = null;
    try {
      portada = source.coverFileId ? await copyStoredFile(source.coverFileId, ctx.user.id) : null;
      updateCourse(copia.id, {
        enforceSequence: source.enforceSequence,
        validityMode: source.validityMode,
        validityMonths: source.validityMonths,
        certificateTemplateId: source.certificateTemplateId,
        ...(portada ? { coverFileId: portada } : {}),
      });
      for (const [i, rama] of ramas.entries()) {
        const hecho = await duplicateItem({
          sourceItemId: rama.id,
          targetCourseId: copia.id,
          parentId: null,
          index: i,
          uploadedBy: ctx.user.id,
        });
        copiados += hecho.count;
        sinArchivo += hecho.missingFiles;
      }
    } catch (err) {
      deleteCourse(copia.id);
      return {
        forModel: `No se pudo copiar ${source.title}: ${err instanceof Error ? err.message : "falló a mitad"}. No quedó ningún curso a medias.`,
      };
    }

    registrar(ctx, "assistant_duplicar_curso", source.id, copia.id, { items: copiados, conContenido });

    const partes = [`**${titulo}** es una copia de ${source.title} y está en borrador.`];
    partes.push(
      conContenido
        ? `Se copiaron ${copiados} elemento(s) con sus carpetas, en el mismo orden, y los exámenes con sus preguntas.`
        : "Se copió solo la configuración: el curso está vacío, listo para llenarlo."
    );
    partes.push(
      "No se copiaron los alumnos, sus matrículas, entregas, intentos ni certificados, ni las reglas de aprobación (apuntan a las lecciones del original)."
    );
    if (portada) partes.push("La portada sí se copió: la copia estrena su propio archivo.");
    if (sinArchivo > 0) partes.push(`${sinArchivo} archivo(s) del original ya no estaban y su lección quedó sin ellos.`);
    if (items.length > CURSO_GRANDE) partes.push(`Es un curso grande (${items.length} elementos): por eso tardó un poco.`);
    const text = partes.join(" ");

    return {
      forModel: text,
      blocks: [{ type: "result", text, undoable: true }, enlaces(copia.id)],
      undo: {
        tool: "duplicar_curso",
        params: {
          curso_id: copia.id,
          origen_id: source.id,
          // Marca de tiempo de la copia recién hecha: si cambia, ya la tocaron
          sello: String(getOwnedCourse(copia.id, ctx.user)?.updatedAt.getTime() ?? 0),
        },
      },
    };
  },
  /**
   * Deshacer: borra la copia, pero solo si sigue siendo la que se acaba de
   * hacer. Con alumnos (aunque estén dados de baja) o con cambios propios no
   * se borra: se perdería trabajo de alguien. Si no se puede, lanza, y así el
   * mensaje no se marca como deshecho.
   */
  undo(params, ctx) {
    const copia: Course | null = getOwnedCourse(param(params, "curso_id"), ctx.user);
    if (!copia) throw new Error("No se pudo deshacer: el curso copiado ya no está disponible.");
    if (matriculas(copia.id) > 0) throw new Error("No se pudo deshacer: el curso copiado ya tiene alumnos.");
    const sello = param(params, "sello");
    if (copia.status !== "draft" || (sello && String(copia.updatedAt.getTime()) !== sello)) {
      throw new Error("No se pudo deshacer: el curso copiado ya tiene cambios; bórralo desde sus ajustes si no lo quieres.");
    }

    deleteCourse(copia.id);
    registrar(ctx, "assistant_duplicar_curso_undo", param(params, "origen_id"), copia.id);
    // Sin negritas: esto sale en un aviso emergente, que enseña el texto tal cual
    const text = `Se borró la copia «${copia.title}»; el curso original quedó como estaba.`;
    return { forModel: text, blocks: [{ type: "result", text }] };
  },
};
