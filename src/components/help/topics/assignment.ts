import { parseAllowedTypes, typesLabel } from "@/lib/file-types";
import type { TopicsOf } from "./types";

export type AssignmentValues = {
  "assignment.late": { hasDue: boolean; allowLate: boolean };
  "assignment.replace": { allowed: boolean };
  "assignment.fileTypes": { types: string };
};

const WHERE = "Contenido › Tarea";

export const ASSIGNMENT_TOPICS: TopicsOf<AssignmentValues> = {
  "assignment.late": {
    label: "Fecha límite y entregas tardías",
    where: WHERE,
    kicker: "Así lo vive el alumno",
    caption: ({ hasDue, allowLate }) =>
      !hasDue
        ? "**Sin fecha límite**: el alumno puede entregar cuando quiera."
        : allowLate
          ? "Después de la fecha límite **aún puede entregar**, pero queda marcada **«Entregada con retraso»**."
          : "Al pasar la fecha límite **la entrega se cierra**: ya no puede entregar.",
    example: { hasDue: true, allowLate: true },
  },
  "assignment.replace": {
    label: "Permitir reemplazar entrega",
    where: WHERE,
    kicker: "Después de entregar",
    caption: ({ allowed }) =>
      allowed
        ? "El alumno puede **reemplazar su entrega** mientras no la califiques; cuenta **la más reciente**."
        : "La entrega **queda fija**: el alumno no puede cambiarla.",
    example: { allowed: true },
  },
  "assignment.fileTypes": {
    label: "Tipos de archivo permitidos",
    where: WHERE,
    kicker: "Al subir su archivo",
    caption: ({ types }) => {
      const list = parseAllowedTypes(types);
      return list.length === 0
        ? "Lista vacía: se acepta **cualquier archivo** (máx. 25 MB c/u)."
        : `Solo se aceptan archivos **${typesLabel(list)}**; si sube otro tipo, **se rechaza** con un aviso.`;
    },
    example: { types: ".pdf,.docx" },
  },
};
