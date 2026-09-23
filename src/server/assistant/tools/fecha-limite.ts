import "server-only";
import { audit } from "@/server/services/audit";
import { getAssignmentDetail, updateAssignmentSettings } from "@/server/services/assignments";
import { getOwnedCourse, type Course } from "@/server/services/courses";
import { getItem, getItems, type CourseItem } from "@/server/services/tree";
import { dateRange } from "@/lib/assistant-dates";
import type { AssistantBlock, ProposalRow } from "@/lib/assistant-blocks";
import { fmtDate } from "../queries";
import { createProposal } from "../proposal-store";
import {
  schema,
  str,
  param,
  type AssistantTool,
  type ToolCtx,
  type ToolResult,
} from "../tool-types";

/**
 * Fecha límite de las tareas (`item_assignments.due_at`, lo mismo que el campo
 * «Fecha límite» de la pantalla de la tarea): se guarda con la MISMA función
 * que esa pantalla, `updateAssignmentSettings`.
 *
 * La fecha se dice en palabras («el viernes», «en dos semanas», «2026-10-15»)
 * y siempre queda al final de ese día, para que la tarea se pueda entregar
 * hasta la medianoche. Si no se entiende lo que dijeron, no se inventa nada:
 * se pide una fecha concreta.
 *
 * Con una tarea se hace al momento y se deshace (vuelve la fecha anterior);
 * con varias se propone una tabla para revisar.
 */

// Todo viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "tarea", label: "Tarea", editable: false },
  { key: "actual", label: "Fecha actual", editable: false },
  { key: "nueva", label: "Fecha nueva", editable: false },
];

const SIN_FECHA = "Sin fecha";

/** Palabras con las que se pide quitar la fecha límite. */
const QUITAR = ["quitar", "quitarla", "quitala", "sin fecha", "sin fecha limite", "sin limite", "ninguna", "ninguno", "nada", "-"];

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

function enlaces(course: Course, item?: CourseItem): AssistantBlock {
  return {
    type: "links",
    links: [
      item
        ? { label: "Abrir la tarea", href: `/teach/courses/${course.id}/items/${item.id}/edit`, icon: "page" }
        : { label: "Ver el contenido del curso", href: `/teach/courses/${course.id}/content`, icon: "page" },
    ],
  };
}

/** Minúsculas, sin acentos y sin espacios de sobra. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const sumarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Suma meses sin desbordar: 31 de enero + 1 mes = 28 (o 29) de febrero. */
function sumarMeses(d: Date, n: number): Date {
  const ultimo = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), ultimo));
}

/** La fecha límite es el último instante del día: se entrega hasta la medianoche. */
const finDelDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

type Pedida = { quitar: true } | { fecha: Date };

/**
 * Lo que dijo el usuario, en fecha. `null` = no se entendió (y entonces se
 * pregunta, nunca se supone). Las fechas exactas y «hoy» las lee `dateRange`;
 * lo demás («el viernes», «en 2 semanas») se resuelve aquí.
 */
export function parseFechaLimite(texto: string, now: Date = new Date()): Pedida | null {
  const t = normalizar(texto);
  if (!t) return null;
  if (QUITAR.includes(t)) return { quitar: true };

  if (t === "hoy") return { fecha: dateRange("hoy", "hoy", now).to };
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    // Mismo día en los dos extremos: así el tramo es ese día, esté en el futuro o no
    const rango = dateRange(t, t, now);
    // `dateRange` nunca falla: una fecha imposible (31 de febrero) le sale «hoy»
    return rango.label === "hoy" ? null : { fecha: rango.to };
  }
  if (t === "manana") return { fecha: finDelDia(sumarDias(now, 1)) };
  if (t === "pasado manana") return { fecha: finDelDia(sumarDias(now, 2)) };

  const en = /^(?:en|dentro de) (un|una|\d{1,3}) (dia|dias|semana|semanas|mes|meses)$/.exec(t);
  if (en) {
    const n = en[1] === "un" || en[1] === "una" ? 1 : Number(en[1]);
    if (n < 1) return null;
    if (en[2].startsWith("dia")) return { fecha: finDelDia(sumarDias(now, n)) };
    if (en[2].startsWith("semana")) return { fecha: finDelDia(sumarDias(now, n * 7)) };
    return { fecha: finDelDia(sumarMeses(now, n)) };
  }

  // «el viernes», «el próximo viernes»: el siguiente que venga, nunca hoy mismo
  const dia = DIAS_SEMANA.indexOf(t.replace(/^(?:(?:el|la|este|esta|proximo|proxima|siguiente|para) )+/, ""));
  if (dia >= 0) return { fecha: finDelDia(sumarDias(now, ((dia - now.getDay() + 7) % 7) || 7)) };

  return null;
}

type Fila = { row: ProposalRow; item: CourseItem };

/** Una fila por tarea, con la fecha que tiene y la que tendría. */
function filasDe(items: CourseItem[], nueva: Date | null, courseId: string): Fila[] {
  const etiqueta = nueva ? fmtDate(nueva) : SIN_FECHA;
  return items.map((item) => {
    const detalle = getAssignmentDetail(item.id);
    const actual = detalle?.dueAt ? fmtDate(detalle.dueAt) : SIN_FECHA;
    const cells = { tarea: item.title, actual, nueva: etiqueta };
    if (item.courseId !== courseId || item.kind !== "assignment" || !detalle) {
      return { item, row: { id: item.id, cells, warning: "No encontramos esa tarea", blocked: true } };
    }
    if ((detalle.dueAt?.getTime() ?? null) === (nueva?.getTime() ?? null)) {
      return { item, row: { id: item.id, cells, warning: nueva ? "Ya tiene esa fecha" : "Ya estaba sin fecha", blocked: true } };
    }
    return { item, row: { id: item.id, cells } };
  });
}

/** Guarda la fecha con la función de la pantalla de la tarea y deja constancia. */
function guardar(item: CourseItem, fecha: Date | null, ctx: ToolCtx, accion: string) {
  const anterior = getAssignmentDetail(item.id)?.dueAt ?? null;
  updateAssignmentSettings(item.id, { dueAt: fecha });
  audit(ctx.user.id, accion, "course_items", item.id, {
    via: "assistant",
    conversationId: ctx.conversationId,
    courseId: item.courseId,
    fecha: fecha ? fecha.getTime() : null,
    anterior: anterior ? anterior.getTime() : null,
  });
}

/** Aviso para el usuario cuando la fecha que pidió ya pasó. */
function avisoPasada(fecha: Date | null): string {
  return fecha && fecha.getTime() < Date.now() ? " Ojo: esa fecha ya pasó, así que las entregas cuentan como tardías desde ya." : "";
}

export const fechaLimite: AssistantTool = {
  name: "fecha_limite",
  description:
    "Pone, cambia o quita la fecha límite de las tareas de un curso. La fecha se puede decir en palabras («el viernes», «en dos semanas», «2026-10-15») o «quitar» para dejarla sin fecha. Con una tarea se aplica al momento; con varias se muestra una tabla para revisar.",
  parameters: schema({
    curso_id: str("Id del curso, de buscar_curso"),
    item_id: str("Id de la tarea cuando se habla de una sola («» = todas las tareas del curso)"),
    fecha: str('La fecha tal como la dijo el usuario («el viernes», «en 2 semanas», «2026-10-15») o «quitar» para dejarla sin fecha límite'),
  }),
  roles: ["admin", "teacher"],
  // Como matricular: una tarea al momento con deshacer; varias, tabla de revisión
  risk: "instant",
  run(params, ctx): ToolResult {
    const courseId = param(params, "curso_id");
    if (!courseId) return { forModel: "Falta curso_id: las tareas son de un curso. Búscalo con buscar_curso." };
    const course = getOwnedCourse(courseId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };

    const texto = param(params, "fecha");
    if (!texto) return { forModel: "Falta la fecha: pregúntale al usuario para cuándo la quiere (o si prefiere quitarla)." };
    const pedida = parseFechaLimite(texto);
    if (!pedida) {
      return {
        forModel: `No entendí «${texto}» como fecha. Pregúntale al usuario una fecha concreta (por ejemplo 2026-10-15, «el viernes» o «en 2 semanas»); no la supongas.`,
      };
    }
    const fecha = "quitar" in pedida ? null : pedida.fecha;

    const tareas = getItems(course.id).filter((item) => item.kind === "assignment");
    const itemId = param(params, "item_id");
    const elegidas = itemId ? tareas.filter((item) => item.id === itemId) : tareas;
    if (elegidas.length === 0) {
      return {
        forModel: itemId
          ? `No encontré esa tarea en ${course.title}, o no es una tarea; no cambié ninguna fecha.`
          : `${course.title} no tiene ninguna tarea, así que no hay fecha límite que poner.`,
      };
    }

    const filas = filasDe(elegidas, fecha, course.id);
    const comoQueda = fecha ? `para el ${fmtDate(fecha)}` : "sin fecha límite";

    // Una sola: no hay nada que revisar y volver atrás es un clic
    if (filas.length === 1) {
      const [fila] = filas;
      if (fila.row.blocked) return { forModel: `No se pudo cambiar la fecha: ${fila.row.warning}.` };
      const anterior = getAssignmentDetail(fila.item.id)?.dueAt ?? null;
      guardar(fila.item, fecha, ctx, "assistant_fecha_limite");
      const text = fecha
        ? `«${fila.item.title}» se entrega ${comoQueda} (antes ${fila.row.cells.actual.toLowerCase()}).${avisoPasada(fecha)}`
        : `«${fila.item.title}» se quedó sin fecha límite (antes ${fila.row.cells.actual.toLowerCase()}).`;
      return {
        forModel: text,
        blocks: [{ type: "result", text, undoable: true }, enlaces(course, fila.item)],
        undo: {
          tool: "fecha_limite",
          params: { curso_id: course.id, item_id: fila.item.id, fecha_anterior: anterior ? String(anterior.getTime()) : "" },
        },
      };
    }

    const rows = filas.map((f) => f.row);
    const proposalId = createProposal("fecha_limite", ctx, ctx.messageId, {
      title: fecha ? `Fecha límite ${comoQueda} en ${rows.length} tareas de ${course.title}` : `Quitar la fecha límite de ${rows.length} tareas de ${course.title}`,
      applyLabel: fecha ? "Poner la fecha" : "Quitar la fecha",
      columns: COLUMNS,
      rows,
      payload: { courseId: course.id, courseTitle: course.title, fechaMs: fecha ? fecha.getTime() : null },
    });
    const ok = rows.filter((r) => !r.blocked).length;
    const bloqueadas = rows.length - ok;
    const partes = [`Se creó una propuesta con ${rows.length} tarea(s) de ${course.title}: ${ok} quedarían ${comoQueda}`];
    if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (ya la tenían así o ya no están)`);
    const aviso = avisoPasada(fecha).trim();
    if (aviso) partes.push(aviso.toLowerCase().replace(/^ojo: /, "ojo, "));
    return { forModel: `${partes.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Aplica las filas ya revisadas. Revalida: el curso sigue siendo del usuario
   * y cada tarea se vuelve a leer (pudieron borrarla o ya tenerla así).
   */
  apply(rows, payload, ctx) {
    const course = getOwnedCourse(String(payload.courseId ?? ""), ctx.user);
    if (!course) return { text: "El curso ya no está disponible; no cambié ninguna fecha." };
    const ms = payload.fechaMs;
    const fecha = typeof ms === "number" ? new Date(ms) : null;

    const items = rows.map((r) => getItem(r.id)).filter((item): item is CourseItem => item !== null);
    const filas = filasDe(items, fecha, course.id);
    const motivos: string[] = [];
    if (items.length < rows.length) motivos.push("esa tarea ya no existe");
    let hechas = 0;
    for (const fila of filas) {
      if (fila.row.blocked) {
        motivos.push(fila.row.warning ?? "ya no se puede");
        continue;
      }
      guardar(fila.item, fecha, ctx, "assistant_fecha_limite");
      hechas++;
    }

    let text = fecha
      ? `${hechas} tarea(s) de ${course.title} se entregan para el ${fmtDate(fecha)}.${avisoPasada(fecha)}`
      : `${hechas} tarea(s) de ${course.title} se quedaron sin fecha límite.`;
    if (motivos.length > 0) text += ` ${rows.length - hechas} no se pudieron: ${[...new Set(motivos)].join("; ")}.`;
    return { text, blocks: [enlaces(course)] };
  },
  /**
   * Deshacer: vuelve la fecha que tenía la tarea (o ninguna). Si no se puede,
   * lanza: así el mensaje no se marca como deshecho.
   */
  undo(params, ctx) {
    const course = getOwnedCourse(param(params, "curso_id"), ctx.user);
    if (!course) throw new Error("No se pudo deshacer: el curso ya no está disponible.");
    const item = getItem(param(params, "item_id"));
    if (!item || item.courseId !== course.id || item.kind !== "assignment" || !getAssignmentDetail(item.id)) {
      throw new Error("No se pudo deshacer: esa tarea ya no existe.");
    }
    const anteriorMs = Number(param(params, "fecha_anterior"));
    const anterior = Number.isFinite(anteriorMs) && anteriorMs > 0 ? new Date(anteriorMs) : null;
    guardar(item, anterior, ctx, "assistant_fecha_limite_undo");
    const text = anterior
      ? `«${item.title}» vuelve a entregarse para el ${fmtDate(anterior)}.`
      : `«${item.title}» se quedó otra vez sin fecha límite.`;
    return { forModel: text, blocks: [{ type: "result", text }, enlaces(course, item)] };
  },
};
