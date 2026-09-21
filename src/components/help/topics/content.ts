import type { NoValue, TopicsOf } from "./types";

export type ContentValues = {
  "content.types": NoValue;
  "content.docSeconds": { seconds: number };
  "content.textSeconds": { seconds: number };
  "content.videoSpeed": { allowed: boolean };
  "content.required": { required: boolean };
  "content.resourceLink": { kind: "resource" | "link" };
};

/** 45 → «45 s»; 90 → «1 min 30 s»; 120 → «2 min». */
function secondsText(total: number): string {
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec ? `${min} min ${sec} s` : `${min} min`;
}

export const CONTENT_TOPICS: TopicsOf<ContentValues> = {
  "content.types": {
    label: "Tipos de contenido",
    where: "Curso › Contenido",
    kicker: "Así los vive el alumno",
    caption: () =>
      "Cada tipo se vive distinto: **documento** por páginas, **lectura** con tiempo, **video**, **examen**, **tarea**, **recurso** y **enlace**.",
    example: {},
  },
  "content.docSeconds": {
    label: "Segundos mínimos por página",
    where: "Contenido › Documento",
    kicker: "Así lo vive el alumno",
    caption: ({ seconds }) =>
      seconds > 0
        ? `No puede pasar de hoja hasta estar **${seconds} s en pantalla**. La barra de arriba solo avanza con páginas acreditadas.`
        : "Sin tiempo mínimo: **cada página cuenta al abrirla** y puede avanzar de inmediato.",
    example: { seconds: 30 },
  },
  "content.textSeconds": {
    label: "Segundos mínimos de lectura",
    where: "Contenido › Lectura",
    kicker: "Así lo vive el alumno",
    caption: ({ seconds }) =>
      seconds > 0
        ? `La lectura se completa tras **${secondsText(seconds)} en pantalla**; el contador baja y al terminar aparece **«Continuar»**.`
        : "Sin tiempo mínimo: la lectura **se completa al abrirla**.",
    example: { seconds: 60 },
  },
  "content.videoSpeed": {
    label: "Permitir velocidad hasta 2x",
    where: "Contenido › Video",
    kicker: "Así lo vive el alumno",
    caption: ({ allowed }) =>
      allowed
        ? "**Encendido**: el alumno puede verlo **al doble de velocidad** y se acredita igual."
        : "**Apagado**: si el alumno elige 2x, **el video regresa a 1x** solo.",
    example: { allowed: false },
  },
  "content.required": {
    label: "Requerido para completar",
    where: "Contenido › Avance y secuencia",
    kicker: "El avance del alumno",
    caption: ({ required }) =>
      required
        ? "**Requerido**: cuenta para el avance del curso (**3 de 4**) y para aprobarlo."
        : "**Opcional**: ya no cuenta para el avance (**3 de 3**); el alumno puede dejarlo pendiente.",
    example: { required: true },
  },
  "content.resourceLink": {
    label: "Recurso descargable y enlace externo",
    where: "Contenido › Recurso o enlace",
    kicker: "Así lo vive el alumno",
    caption: ({ kind }) =>
      kind === "resource"
        ? "El alumno **descarga cualquier archivo** y el recurso se marca como **visto** solo."
        : "El alumno **abre el enlace** en otra pestaña y queda marcado como **visto**.",
    example: { kind: "resource" },
  },
};
