import "server-only";
import { schema, strEnum, str, param, type AssistantTool } from "../tool-types";

const DESTINOS = ["alumno", "curso", "contenido", "calificar", "reportes", "certificados", "ajustes", "estudiantes", "cursos", "inicio"] as const;

const FIXED: Record<string, string> = {
  calificar: "/teach/grading",
  reportes: "/teach/reports",
  certificados: "/teach/templates",
  ajustes: "/ajustes",
  estudiantes: "/teach/students",
  cursos: "/teach/courses",
  inicio: "/teach/dashboard",
};

/** Lleva al usuario a una pantalla. La IA obtiene los ids con buscar_*. */
export const irA: AssistantTool = {
  name: "ir_a",
  description: "Abre una pantalla de la plataforma (perfil de alumno, curso, contenido del curso, calificar, reportes, certificados, ajustes, listas).",
  parameters: schema({
    destino: strEnum("Pantalla a abrir", [...DESTINOS]),
    id: str("Id del alumno o del curso cuando el destino lo necesita; vacío si no aplica"),
  }),
  roles: ["admin", "teacher"],
  risk: "navigate",
  run(params) {
    const destino = param(params, "destino");
    const id = param(params, "id");
    if (destino in FIXED) return { forModel: `Abriendo ${destino}.`, navigate: FIXED[destino] };
    if (!id) return { forModel: `Para ir a «${destino}» necesito el id; búscalo con buscar_alumno o buscar_curso.` };
    if (destino === "alumno") return { forModel: "Abriendo el perfil del alumno.", navigate: `/teach/students/${id}` };
    if (destino === "curso") return { forModel: "Abriendo el curso.", navigate: `/teach/courses/${id}` };
    if (destino === "contenido") return { forModel: "Abriendo el contenido del curso.", navigate: `/teach/courses/${id}/content` };
    return { forModel: `Destino desconocido: ${destino}.` };
  },
};
