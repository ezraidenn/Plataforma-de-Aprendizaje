import "server-only";
import { getStudentProfile } from "@/server/services/student-profile";
import { fullScope } from "@/server/auth/view-scope";
import { schema, str, param, type AssistantTool } from "../tool-types";

const DATE = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });

function statusLabel(status: "active" | "completed" | "dropped", capital = false): string {
  const label = status === "completed" ? "completado" : status === "dropped" ? "baja" : "en curso";
  return capital ? label[0].toUpperCase() + label.slice(1) : label;
}

/** Resumen de un alumno: cursos, avance, certificados. */
export const fichaAlumno: AssistantTool = {
  name: "ficha_alumno",
  description: "Resumen de un alumno: cursos con avance, certificados y última actividad. Necesita el id (usa buscar_alumno).",
  parameters: schema({ alumno_id: str("Id del alumno") }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const id = param(params, "alumno_id");
    if (!id) return { forModel: "Falta alumno_id." };
    // Igual que la página del perfil: el maestro solo abre a los suyos
    const profile = getStudentProfile(id, ctx.scope, fullScope(ctx.user));
    if (!profile) return { forModel: "No encontramos a ese alumno o no está entre los tuyos." };
    const { student, courses, totals } = profile;
    const courseLines = courses.map((c) => `- ${c.courseTitle}: ${c.percent}% (${statusLabel(c.enrollmentStatus)})`);
    const forModel = [
      `${student.fullName} <${student.email}>${student.active ? "" : " (deshabilitado)"}. Último acceso: ${student.lastLoginAt ? DATE.format(student.lastLoginAt) : "nunca"}.`,
      `Cursos (${totals.courses}, ${totals.completed} completados):`,
      ...courseLines.slice(0, 5),
      ...(courseLines.length > 5 ? [`… y ${courseLines.length - 5} más`] : []),
      `Certificados: ${totals.certificates}.`,
    ].join("\n");
    return {
      forModel,
      blocks: [
        {
          type: "tiles",
          tiles: [
            { label: "Cursos", value: String(totals.courses) },
            { label: "Completados", value: String(totals.completed) },
            { label: "Certificados", value: String(totals.certificates) },
          ],
        },
        {
          type: "table",
          columns: ["Curso", "Avance", "Estado"],
          rows: courses.slice(0, 5).map((c) => [c.courseTitle, `${c.percent}%`, statusLabel(c.enrollmentStatus, true)]),
          more: Math.max(0, courses.length - 5),
        },
        { type: "links", links: [{ label: `Ir al perfil de ${student.fullName.split(" ")[0]}`, href: `/teach/students/${student.id}`, icon: "user" }] },
      ],
    };
  },
};
