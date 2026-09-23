import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { certificates, users } from "@/server/db/schema";
import { validityState } from "@/lib/validity";
import { fullScope } from "@/server/auth/view-scope";
import { getTemplate } from "@/server/services/certificates";
import { getOwnedCourse } from "@/server/services/courses";
import { getExam } from "@/server/services/exams";
import { computeFinalScorePercent, listAttempts } from "@/server/services/exam-scoring";
import { courseProgress, getEnrollment, getProgressMap } from "@/server/services/progress";
import { evaluateForDisplay, getCourseRules, type ConditionResult } from "@/server/services/rules-engine";
import { isStudentVisible } from "@/server/services/student-scope";
import { linearOrder } from "@/server/services/tree";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { clampForModel } from "../queries";
import { param, schema, str, type AssistantTool, type ToolResult } from "../tool-types";

/**
 * «¿Cómo va?» y «¿por qué no le sale el certificado?» de un alumno en un
 * curso.
 *
 * Las condiciones salen del motor de reglas de verdad (`evaluateForDisplay`,
 * solo lectura): son las MISMAS que decidirían aprobarlo, no una regla
 * inventada aquí. Lo demás —lecciones requeridas, intentos de examen y
 * certificado— se lee de donde vive.
 */

const DATE = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });

/** Cuántas lecciones requeridas lleva, en la misma cuenta que usa el motor. */
function detalleDeCondicion(r: ConditionResult, completadas: number, requeridas: number): string {
  switch (r.condition.type) {
    case "all_items_completed":
      return `${completadas} de ${requeridas} lección(es) requeridas.`;
    case "viewing_completion":
      return `Lleva ${r.value ?? 0}% del contenido; el mínimo es ${r.condition.min_percent}%.`;
    case "exam_average":
      return r.value === null
        ? "Todavía falta calificar algún examen."
        : `Promedio ${r.value}%; el mínimo es ${r.condition.min_percent}%.`;
    case "exam_specific":
      return r.value === null
        ? "Todavía no tiene un intento calificado."
        : `Sacó ${r.value}%; el mínimo es ${r.condition.min_percent}%.`;
  }
}

type Examen = { titulo: string; texto: string };

export const revisarAlumno: AssistantTool = {
  name: "revisar_alumno",
  description:
    "Revisa a un alumno dentro de un curso: qué condiciones de aprobación cumple y cuáles no, qué lecciones requeridas le faltan, cómo va en los exámenes y si ya tiene certificado. Sirve para «¿cómo va?» y «¿por qué no le sale el certificado?».",
  parameters: schema({
    alumno_id: str("Id del alumno, de buscar_alumno"),
    curso_id: str("Id del curso, de buscar_curso"),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx): ToolResult {
    const alumnoId = param(params, "alumno_id");
    const cursoId = param(params, "curso_id");
    if (!alumnoId || !cursoId) return { forModel: "Necesito el id del alumno y el del curso (buscar_alumno y buscar_curso)." };

    const course = getOwnedCourse(cursoId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece." };
    // Igual que el perfil: el maestro solo abre a los suyos, el admin a cualquiera
    if (!isStudentVisible(fullScope(ctx.user), alumnoId)) {
      return { forModel: "No encontramos a ese alumno o no está entre los tuyos." };
    }
    const alumno = db.select({ id: users.id, name: users.fullName }).from(users).where(eq(users.id, alumnoId)).get();
    if (!alumno) return { forModel: "No encontramos a ese alumno." };

    const enlaces: AssistantBlock = {
      type: "links",
      links: [
        { label: `Ir al perfil de ${alumno.name.split(" ")[0]}`, href: `/teach/students/${alumno.id}`, icon: "user" },
        { label: `Ver alumnos de ${course.title}`, href: `/teach/courses/${course.id}/students`, icon: "course" },
      ],
    };

    const enrollment = getEnrollment(course.id, alumno.id);
    if (!enrollment) {
      return {
        forModel: `${alumno.name} no está matriculado en «${course.title}»: por eso no hay avance ni certificado.`,
        blocks: [{ type: "text", text: `${alumno.name} no está matriculado en **${course.title}**.` }, enlaces],
      };
    }

    // ── Avance y lecciones requeridas ──
    const avance = courseProgress(course.id, alumno.id);
    const progreso = getProgressMap(enrollment.id);
    const visibles = linearOrder(course.id).filter((i) => i.visible);
    const requeridas = visibles.filter((i) => i.requiredForCompletion);
    const faltantes = requeridas.filter((i) => progreso.get(i.id)?.status !== "completed");

    // ── Exámenes ──
    const examenes: Examen[] = [];
    let intentosUsados = 0;
    for (const item of visibles.filter((i) => i.kind === "exam")) {
      const exam = getExam(item.id);
      if (!exam) continue;
      const intentos = listAttempts(item.id, alumno.id, enrollment.id);
      intentosUsados += intentos.length;
      const porcentaje = computeFinalScorePercent(exam, intentos);
      const restantes = exam.maxAttempts === null ? null : Math.max(0, exam.maxAttempts - intentos.length);
      const quedan =
        restantes === null
          ? "intentos sin límite"
          : restantes === 0
            ? "ya no le quedan intentos"
            : `le quedan ${restantes} de ${exam.maxAttempts}`;
      const minimo = exam.passScore === null ? "sin mínimo" : `mínimo ${exam.passScore}%`;
      examenes.push({
        titulo: item.title,
        texto:
          intentos.length === 0
            ? `sin intentos todavía (${minimo}, ${quedan})`
            : porcentaje === null
              ? `${intentos.length} intento(s), ninguno calificado todavía (${minimo}, ${quedan})`
              : `${Math.round(porcentaje * 10) / 10}% en ${intentos.length} intento(s) (${minimo}, ${quedan})`,
      });
    }

    // ── Reglas del curso ──
    const evaluacion = evaluateForDisplay(enrollment.id);
    const reglas = getCourseRules(course.id);
    const condiciones = evaluacion?.results ?? [];
    const cumpleReglas = evaluacion?.passed ?? false;

    // ── Certificado ──
    const cert = db
      .select()
      .from(certificates)
      .where(and(eq(certificates.enrollmentId, enrollment.id), eq(certificates.revoked, false)))
      .orderBy(desc(certificates.issuedAt))
      .get();
    const revocado = cert
      ? null
      : db
          .select()
          .from(certificates)
          .where(eq(certificates.enrollmentId, enrollment.id))
          .orderBy(desc(certificates.issuedAt))
          .get();

    const lineas: string[] = [];
    if (enrollment.status === "dropped") {
      lineas.push(`${alumno.name} está dado de baja de **${course.title}**: lo de abajo es como quedó su ciclo ${enrollment.cycle}.`);
    }
    let veredicto: string;
    if (cert) {
      const vigencia =
        cert.expiresAt === null
          ? "no vence"
          : validityState(cert.expiresAt) === "expired"
            ? `venció el ${DATE.format(cert.expiresAt)}`
            : `vigente hasta el ${DATE.format(cert.expiresAt)}`;
      veredicto = `Ya tiene su certificado: folio ${cert.folio}, emitido el ${DATE.format(cert.issuedAt)} y ${vigencia}.`;
    } else if (revocado) {
      veredicto = `Su certificado (folio ${revocado.folio}) está revocado${revocado.revokedReason ? `: ${revocado.revokedReason}.` : "."}`;
    } else if (!cumpleReglas) {
      veredicto = `Todavía no le toca certificado: no cumple ${condiciones.filter((c) => !c.passed).length} de las condiciones del curso.`;
    } else if (!course.certificateTemplateId) {
      veredicto = `Cumple las condiciones del curso, pero **${course.title}** no tiene plantilla de diploma asignada: por eso no se emite el certificado. Asígnale una en los ajustes del curso.`;
    } else if (!getTemplate(course.certificateTemplateId)) {
      veredicto = `Cumple las condiciones del curso, pero la plantilla de diploma que tiene asignada ya no existe: hay que asignarle otra en los ajustes del curso.`;
    } else if (enrollment.status !== "completed") {
      veredicto = "Cumple las condiciones, pero su matrícula todavía no está marcada como completada: se marca (y sale el certificado) en cuanto registre actividad en el curso.";
    } else {
      veredicto = "Cumple todo y su matrícula está completada: el certificado se genera en segundo plano, debería aparecer en un momento.";
    }
    lineas.push(veredicto);

    if (faltantes.length > 0) {
      const muestra = faltantes.slice(0, 5).map((i) => `- ${i.title}`);
      lineas.push(
        `Lecciones requeridas que le faltan (${faltantes.length}):`,
        ...muestra,
        ...(faltantes.length > 5 ? [`- … y ${faltantes.length - 5} más`] : [])
      );
    }
    if (examenes.length > 0) {
      lineas.push("Exámenes:", ...examenes.map((e) => `- ${e.titulo}: ${e.texto}`));
    }
    if (reglas.op === "OR" && condiciones.length > 1) {
      lineas.push("Las reglas de este curso se cumplen con una sola de las condiciones de abajo.");
    }

    const blocks: AssistantBlock[] = [
      {
        type: "tiles",
        tiles: [
          { label: "Avance", value: `${avance.percent}%` },
          { label: "Requeridas que faltan", value: String(faltantes.length) },
          { label: "Intentos de examen", value: examenes.length === 0 ? "—" : String(intentosUsados) },
        ],
      },
      {
        type: "table",
        columns: ["Condición", "Estado", "Detalle"],
        rows: condiciones.map((r) => [
          r.label,
          r.passed ? "cumple" : "falta",
          detalleDeCondicion(r, requeridas.length - faltantes.length, requeridas.length),
        ]),
      },
      { type: "text", text: lineas.join("\n") },
      enlaces,
    ];

    const pendientes = condiciones.filter((c) => !c.passed).map((c) => c.label);
    const forModel = clampForModel(
      [
        `${alumno.name} en «${course.title}»: ${avance.percent}% de avance, ${faltantes.length} lección(es) requeridas pendientes.`,
        cumpleReglas ? "Cumple las condiciones del curso." : `Le falta: ${pendientes.join("; ")}.`,
        cert ? `Certificado ${cert.folio}.` : veredicto.replace(/\*\*/g, ""),
      ].join(" ")
    );
    return { forModel, blocks };
  },
};
