import type { ValidityMode } from "@/lib/validity";
import type { CourseStatus } from "../scenes/course.story";
import type { NoValue, TopicsOf } from "./types";

export type CourseValues = {
  "course.status": { status: CourseStatus };
  "course.sequential": { enabled: boolean };
  "course.cover": NoValue;
  "course.certificate": NoValue;
  "course.validity": { mode: ValidityMode; months: number | null };
};

function monthsText(months: number | null): string {
  const n = months ?? 12;
  return n === 1 ? "1 mes" : `${n} meses`;
}

export const COURSE_TOPICS: TopicsOf<CourseValues> = {
  "course.sequential": {
    label: "Progresión secuencial estricta",
    where: "Curso › Ajustes",
    kicker: "Así lo ve el alumno",
    caption: ({ enabled }) =>
      enabled
        ? "El alumno termina una lección → **se abre la siguiente**. Las demás siguen con candado."
        : "Sin candados: el alumno **abre cualquier lección** en el orden que quiera.",
    example: { enabled: true },
  },
  "course.validity": {
    label: "Vigencia del certificado",
    where: "Curso › Ajustes",
    kicker: "El certificado con el tiempo",
    caption: ({ mode, months }) =>
      mode === "lifetime"
        ? "El certificado **nunca vence**: no aparecerá en Vencimientos."
        : mode === "calendar_year"
          ? "Vence el **31 de diciembre** del año en que aprobó. Al vencer aparece en **Vencimientos** y tú decides si lo reinscribes."
          : `Vence **${monthsText(months)} después** de aprobar. Al vencer aparece en **Vencimientos** y tú decides si lo reinscribes.`,
    example: { mode: "calendar_year", months: null },
  },
  "course.status": {
    label: "Estado del curso",
    where: "Curso › Encabezado",
    kicker: "Así lo ve el alumno",
    caption: ({ status }) =>
      status === "draft"
        ? "**Borrador**: solo tú lo ves. Al **publicarlo**, aparece en el panel de los alumnos matriculados."
        : status === "published"
          ? "**Publicado**: está en el panel de los alumnos matriculados. Si lo **archivas**, sale del panel sin borrar nada."
          : "**Archivado**: ya no aparece en el panel, pero **el avance y los certificados se conservan**. Sin certificados, en Ajustes puedes eliminarlo para siempre.",
    example: { status: "published" },
  },
  "course.cover": {
    label: "Imagen del curso",
    where: "Curso › Ajustes",
    kicker: "Dónde aparece",
    caption: () =>
      "La imagen se ve en la **tarjeta del curso** del alumno y en el **carrusel del inicio de sesión**. Sin imagen, el curso usa su color propio.",
    example: {},
  },
  "course.certificate": {
    label: "Plantilla de certificado",
    where: "Curso › Ajustes",
    kicker: "Al aprobar el curso",
    caption: () =>
      "Cuando el alumno **aprueba el curso**, su certificado se genera solo, con **nombre, folio y código QR**, listo para descargar.",
    example: {},
  },
};
