import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { certificates, courses } from "@/server/db/schema";
import { fullScope } from "@/server/auth/view-scope";
import { audit } from "@/server/services/audit";
import { getOwnedCourse } from "@/server/services/courses";
import { listRenewals, renewCertificates, type RenewalRow } from "@/server/services/renewals";
import { isStudentVisible } from "@/server/services/student-scope";
import { EXPIRING_WINDOW_DAYS } from "@/lib/validity";
import type { AssistantBlock, ProposalRow } from "@/lib/assistant-blocks";
import { DAY_MS, fmtDate } from "../queries";
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
} from "../tool-types";

/**
 * Recertificar: lo mismo que el botón «Reinscribir» del panel de
 * Vencimientos. NO renueva el certificado viejo ni le cambia la fecha: le
 * abre al alumno un CICLO NUEVO del curso (progreso, intentos y entregas en
 * cero, mismo grupo que tenía), así que tendrá que volver a completarlo para
 * obtener un certificado nuevo. El anterior se queda tal cual, como registro
 * histórico, y sale del panel (`renewal_state` = «renewed»).
 *
 * Por eso siempre pasa por la tabla de revisión: son personas que van a tener
 * que repetir el curso y el maestro decide caso por caso (quizá una ya no
 * labora ahí, o la cubre otro curso).
 *
 * La lista sale de `listRenewals`, el MISMO criterio del panel: certificado
 * vigente del ciclo más reciente, sin revocar y sin atender.
 */

/** Ventana por defecto de «por vencer»; es la del panel. */
const DIAS_POR_DEFECTO = EXPIRING_WINDOW_DAYS;

/** Lo que pasará con cada fila: se dice igual en todas para que no haya dudas. */
const QUE_PASARA = "abre un ciclo nuevo para que repita el curso";

// Todo viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "alumno", label: "Alumno", editable: false },
  { key: "curso", label: "Curso", editable: false },
  { key: "folio", label: "Folio", editable: false },
  { key: "vence", label: "Vence", editable: false },
  { key: "que_pasara", label: "Qué pasará", editable: false },
];

function enlaces(): AssistantBlock {
  return { type: "links", links: [{ label: "Ver vencimientos", href: "/teach/renewals", icon: "page" }] };
}

type Certificado = {
  id: string;
  folio: string;
  revoked: boolean;
  renewalState: string;
  studentId: string;
  ownerId: string;
};

/** Los certificados de esas filas con lo justo para revalidarlas, en una consulta. */
function certificadosPorId(ids: string[]): Map<string, Certificado> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({
      id: certificates.id,
      folio: certificates.folio,
      revoked: certificates.revoked,
      renewalState: certificates.renewalState,
      studentId: certificates.studentId,
      ownerId: courses.ownerId,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(inArray(certificates.id, ids))
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Una fila por certificado. `listRenewals` ya deja fuera los revocados y los
 * atendidos, pero se comprueba igual: la misma función revalida al aplicar,
 * cuando sí pudo cambiar algo.
 */
function toRows(renovaciones: RenewalRow[], ctx: ToolCtx): ProposalRow[] {
  const scope = fullScope(ctx.user);
  const certs = certificadosPorId(renovaciones.map((r) => r.certificateId));
  return renovaciones.map((r) => {
    const cells = {
      alumno: r.studentName,
      curso: r.courseTitle,
      folio: r.folio,
      vence: fmtDate(r.expiresAt),
      que_pasara: QUE_PASARA,
    };
    const cert = certs.get(r.certificateId);
    if (cert?.revoked) return { id: r.certificateId, cells, warning: "El certificado está revocado", blocked: true };
    if (!isStudentVisible(scope, r.studentId)) {
      return { id: r.certificateId, cells, warning: "No es uno de tus alumnos", blocked: true };
    }
    return { id: r.certificateId, cells };
  });
}

/** Certificados que siguen en el panel, ya filtrados por curso, estado, días y alumnos. */
function candidatos(
  ctx: ToolCtx,
  opts: { courseId: string; estado: string; dias: number; studentIds: Set<string> }
): RenewalRow[] {
  const tabs = opts.estado === "vencidos" ? (["expired"] as const) : opts.estado === "ambos" ? (["expiring", "expired"] as const) : (["expiring"] as const);
  const tope = Date.now() + opts.dias * DAY_MS;
  const filas: RenewalRow[] = [];
  for (const tab of tabs) {
    const rows = listRenewals(ctx.scope, { tab, courseId: opts.courseId || undefined });
    // La ventana del panel es fija (30 días): una más corta se recorta aquí
    filas.push(...(tab === "expiring" ? rows.filter((r) => r.expiresAt.getTime() <= tope) : rows));
  }
  return opts.studentIds.size > 0 ? filas.filter((r) => opts.studentIds.has(r.studentId)) : filas;
}

export const recertificar: AssistantTool = {
  name: "recertificar",
  description:
    "Recertifica a los alumnos cuyo certificado está por vencer o ya venció: les abre un ciclo nuevo del curso para que lo repitan (el certificado anterior no se toca y sale del panel de vencimientos). Siempre se muestra una tabla para revisar antes de aplicar.",
  parameters: schema({
    curso_id: str("Id del curso para mirar solo ese curso, de buscar_curso («» = todos los de tu vista)"),
    alumno_ids: strList("Ids de los alumnos, de buscar_alumno (lista vacía = todos los que apliquen)"),
    estado: strEnum(
      "Qué certificados: «por_vencer» (vencen dentro de la ventana), «vencidos» (ya vencieron) o «ambos»",
      ["por_vencer", "vencidos", "ambos"]
    ),
    dias: str('Solo con «por_vencer» o «ambos»: días de la ventana, en número («» = 30, que es el máximo del panel)'),
  }),
  roles: ["admin", "teacher"],
  // El alumno tendrá que repetir el curso: nunca al momento, siempre tabla de revisión
  risk: "review",
  run(params, ctx) {
    const courseId = param(params, "curso_id");
    const course = courseId ? getOwnedCourse(courseId, ctx.user) : null;
    if (courseId && !course) return { forModel: "No encontramos ese curso o no te pertenece; no recertifiqué a nadie." };

    // La IA manda los números como texto: lo que no sea un número útil vale 30
    const n = Number(param(params, "dias"));
    const pedidos = Number.isFinite(n) && n > 0 ? Math.round(n) : DIAS_POR_DEFECTO;
    const dias = Math.min(pedidos, EXPIRING_WINDOW_DAYS);
    const estado = param(params, "estado") || "por_vencer";
    const studentIds = new Set(paramList(params, "alumno_ids"));

    const filas = candidatos(ctx, { courseId: course?.id ?? "", estado, dias, studentIds });
    const donde = course ? ` en ${course.title}` : "";
    const cuales =
      estado === "vencidos" ? "vencido" : estado === "ambos" ? `vencido ni por vencer en ${dias} día(s)` : `por vencer en ${dias} día(s)`;
    if (filas.length === 0) {
      return {
        forModel: `No hay ningún certificado ${cuales}${donde}${studentIds.size > 0 ? " entre esos alumnos" : ""}: no hay nada que recertificar y no propuse nada.`,
        blocks: [enlaces()],
      };
    }

    const rows = toRows(filas, ctx);
    const proposalId = createProposal("recertificar", ctx, ctx.messageId, {
      title: `Recertificar a ${rows.length} ${rows.length === 1 ? "alumno" : "alumnos"}${donde}`,
      applyLabel: "Recertificar",
      columns: COLUMNS,
      rows,
      payload: { courseId: course?.id ?? "", courseTitle: course?.title ?? "" },
    });

    // La IA solo ve cuántas son y de qué van: los nombres y folios se quedan en la tabla
    const ok = rows.filter((r) => !r.blocked).length;
    const bloqueadas = rows.length - ok;
    const partes = [`Se creó una propuesta con ${rows.length} certificado(s) ${cuales}${donde}: ${ok} listo(s) para recertificar`];
    if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (no es tu alumno o el certificado está revocado)`);
    if (pedidos > EXPIRING_WINDOW_DAYS) partes.push(`el panel de vencimientos solo mira ${EXPIRING_WINDOW_DAYS} días, así que usé esa ventana`);
    partes.push("al aplicar, cada uno empieza un ciclo nuevo del curso y tendrá que volver a completarlo; el certificado anterior se queda como está");
    return { forModel: `${partes.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Aplica las filas ya revisadas. Se revalida cada certificado (pudo
   * revocarse o atenderse desde el panel mientras tanto) y `renewCertificates`
   * vuelve a comprobar los permisos y se salta los que ya tienen un ciclo
   * posterior.
   */
  apply(rows, payload, ctx) {
    const courseId = String(payload.courseId ?? "");
    const course = courseId ? getOwnedCourse(courseId, ctx.user) : null;
    if (courseId && !course) return { text: "El curso ya no está disponible; no recertifiqué a nadie." };

    const scope = fullScope(ctx.user);
    const certs = certificadosPorId(rows.map((r) => r.id));
    const motivos: string[] = [];
    const ids: string[] = [];
    for (const row of rows) {
      const cert = certs.get(row.id);
      if (!cert) {
        motivos.push("ese certificado ya no existe");
        continue;
      }
      if (cert.revoked) {
        motivos.push("el certificado está revocado");
        continue;
      }
      if (cert.renewalState !== "pending") {
        motivos.push("ya se atendió en el panel de vencimientos");
        continue;
      }
      if (!isStudentVisible(scope, cert.studentId)) {
        motivos.push("no es uno de tus alumnos");
        continue;
      }
      if (ctx.user.role !== "admin" && cert.ownerId !== ctx.user.id) {
        motivos.push("ese curso ya no es tuyo");
        continue;
      }
      ids.push(row.id);
    }

    // Mismo grupo que tenían: la recertificación no mueve a nadie de oleada
    const { renewed, skipped } = ids.length > 0 ? renewCertificates(ctx.user, ids, { mode: "keep" }) : { renewed: 0, skipped: 0 };
    if (skipped > 0) motivos.push("ya tenían un ciclo más nuevo");

    // Quiénes quedaron recertificados de verdad: así la huella no promete de más
    const hechos = ids.length > 0 ? [...certificadosPorId(ids).values()].filter((c) => c.renewalState === "renewed") : [];
    for (const cert of hechos) {
      audit(ctx.user.id, "assistant_recertificar", "certificates", cert.id, {
        via: "assistant",
        conversationId: ctx.conversationId,
        folio: cert.folio,
        courseId: courseId || null,
      });
    }

    let text =
      renewed > 0
        ? `Recertifiqué a ${renewed} alumno(s)${course ? ` de ${course.title}` : ""}: a cada uno se le abrió un ciclo nuevo del curso (avance, intentos y entregas en cero), así que tendrá que volver a completarlo para obtener un certificado nuevo. El certificado anterior no se tocó y sale del panel de vencimientos.`
        : `No recertifiqué a nadie${course ? ` en ${course.title}` : ""}.`;
    if (motivos.length > 0) text += ` ${rows.length - renewed} no se pudieron: ${[...new Set(motivos)].join("; ")}.`;
    return { text, blocks: [enlaces()] };
  },
};
