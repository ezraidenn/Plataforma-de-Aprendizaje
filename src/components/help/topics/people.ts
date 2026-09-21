import type { CohortStatus } from "../scenes/people.story";
import type { NoValue, TopicsOf } from "./types";

export type PeopleValues = {
  "groups.close": { status: CohortStatus };
  "groups.import": NoValue;
  "students.trash": NoValue;
  "renewals.actions": NoValue;
};

export const PEOPLE_TOPICS: TopicsOf<PeopleValues> = {
  "groups.close": {
    label: "Cerrar y reabrir grupo",
    where: "Grupos",
    kicker: "Qué pasa al cerrarlo",
    caption: ({ status }) =>
      status === "open"
        ? "Al **cerrar** el grupo, sus alumnos salen de las listas y reportes del día a día. **No se borra nada** y puedes reabrirlo."
        : "Está **cerrado**: sus alumnos no aparecen en las vistas diarias (sí con «Todos (incl. cerrados)»). **Reabrir** los devuelve.",
    example: { status: "open" },
  },
  "groups.import": {
    label: "Traer grupo de otro curso",
    where: "Curso › Estudiantes › Matricular",
    kicker: "Qué pasa al traerlo",
    caption: () =>
      "Sus alumnos se inscriben en este curso **en un grupo con el mismo nombre**. El grupo original **no cambia** y quien ya estaba inscrito se queda igual.",
    example: {},
  },
  "students.trash": {
    label: "Quitar del curso y Papelera",
    where: "Curso › Estudiantes",
    kicker: "Nada se pierde",
    caption: () =>
      "**Quitar del curso** manda al alumno a la **Papelera** con su avance, calificaciones y certificado; **Restaurar** lo devuelve tal como estaba.",
    example: {},
  },
  "renewals.actions": {
    label: "Reinscribir y descartar",
    where: "Vencimientos",
    kicker: "Qué hace cada botón",
    caption: () =>
      "**Reinscribir** abre un **ciclo nuevo en cero** y el certificado anterior queda en el historial; **Descartar** lo saca del panel con su **motivo**, sin revocar nada.",
    example: {},
  },
};
