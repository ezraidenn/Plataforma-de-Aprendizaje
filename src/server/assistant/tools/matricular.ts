import "server-only";
import { schema, str, strList, type AssistantTool } from "../tool-types";

// Versión provisional: la lógica real (con deshacer y propuesta) llega en la tarea siguiente

export const matricular: AssistantTool = {
  name: "matricular",
  description: "Matricula alumnos en un curso.",
  parameters: schema({ alumno_ids: strList("Ids de alumnos"), curso_id: str("Id del curso") }),
  roles: ["admin", "teacher"],
  risk: "instant",
  run() {
    return { forModel: "Pendiente." };
  },
};

export const desmatricular: AssistantTool = {
  name: "desmatricular",
  description: "Da de baja alumnos de un curso (no de la plataforma).",
  parameters: schema({ alumno_ids: strList("Ids de alumnos"), curso_id: str("Id del curso") }),
  roles: ["admin", "teacher"],
  risk: "review",
  run() {
    return { forModel: "Pendiente." };
  },
};
