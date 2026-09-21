import type { CoverPlacement } from "../scenes/admin.story";
import type { NoValue, TopicsOf } from "./types";

export type AdminValues = {
  "admin.storage": NoValue;
  "branding.cover": { placement: CoverPlacement };
};

export const ADMIN_TOPICS: TopicsOf<AdminValues> = {
  "admin.storage": {
    label: "Carpeta de almacenamiento",
    where: "Administración › Configuración",
    kicker: "Cómo se ve en el NAS",
    caption: () =>
      "Lo que se sube cae en **carpetas legibles**: Cursos › Curso › Módulo › Lección; las entregas en **Entregas › Curso › Tarea › Alumno**.",
    example: {},
  },
  "branding.cover": {
    label: "Portada",
    where: "Ajustes › Identidad",
    kicker: "Dónde se ve",
    caption: ({ placement }) =>
      placement === "login"
        ? "La portada se ve de fondo en el **inicio de sesión**."
        : placement === "dashboard"
          ? "La portada se ve en el **panel de inicio** de cada usuario."
          : "La portada se ve en el **inicio de sesión** y en el **panel de inicio**.",
    example: { placement: "both" },
  },
};
