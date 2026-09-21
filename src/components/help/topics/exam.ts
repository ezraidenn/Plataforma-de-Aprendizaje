import { EXAMPLE_CLOSES, EXAMPLE_OPENS, type ResultsMode } from "../scenes/exam.story";
import type { NoValue, TopicsOf } from "./types";

export type ExamValues = {
  "exam.window": { opensAt: number | null; closesAt: number | null };
  "exam.attempts": { attempts: number | null; policy: "best" | "last" | "average" };
  "exam.timeLimit": { minutes: number | null };
  "exam.passing": { passScore: number | null };
  "exam.shuffle": { shuffle: boolean };
  "exam.pool": { draw: number | null; bank: number };
  "exam.results": { mode: ResultsMode };
  "exam.openQuestion": NoValue;
  "exam.ordering": NoValue;
};

const POLICY_PHRASE = {
  best: "cuenta **la mejor** calificación",
  last: "cuenta **la última** calificación",
  average: "cuenta **el promedio** de sus intentos",
} as const;

const WHERE = "Examen › Configuración";

export const EXAM_TOPICS: TopicsOf<ExamValues> = {
  "exam.window": {
    label: "Abre y cierra",
    where: WHERE,
    kicker: "Así lo ve el alumno",
    caption: ({ opensAt, closesAt }) =>
      opensAt !== null && closesAt !== null
        ? "Antes de la **apertura** el examen no se puede empezar; entre las fechas aparece **«Comenzar intento»**; al **cerrar** ya no se puede presentar."
        : opensAt !== null
          ? "Antes de la **apertura** el examen no se puede empezar; después queda **abierto sin fecha de cierre**."
          : closesAt !== null
            ? "Está **abierto desde ya**; al llegar la fecha de **cierre** ya no se puede presentar."
            : "Sin fechas: el examen está **siempre abierto**.",
    example: { opensAt: EXAMPLE_OPENS, closesAt: EXAMPLE_CLOSES },
  },
  "exam.attempts": {
    label: "Intentos máximos y calificación que cuenta",
    where: WHERE,
    kicker: "Así lo vive el alumno",
    caption: ({ attempts, policy }) =>
      attempts === null
        ? `**Intentos ilimitados**; ${POLICY_PHRASE[policy]}.`
        : attempts === 1
          ? "**Un solo intento**: si no aprueba, el botón se bloquea."
          : `Tiene **${attempts} intentos** y ${POLICY_PHRASE[policy]}. Al agotarlos, el botón se bloquea.`,
    example: { attempts: 3, policy: "best" },
  },
  "exam.timeLimit": {
    label: "Tiempo límite",
    where: WHERE,
    kicker: "Así lo vive el alumno",
    caption: ({ minutes }) =>
      minutes === null
        ? "**Sin límite de tiempo**: el alumno envía cuando termina."
        : `El reloj corre desde que empieza (**${minutes} min**), aunque cierre la ventana; al llegar a **0:00 se envía solo** con lo contestado.`,
    example: { minutes: 30 },
  },
  "exam.passing": {
    label: "Calificación mínima",
    where: WHERE,
    kicker: "Lo que ve al terminar",
    caption: ({ passScore }) =>
      passScore === null
        ? "Sin mínimo: el alumno solo ve su calificación. **Aprobar el curso** lo deciden las reglas."
        : `Con **${passScore}%** o más ve **«¡Aprobado!»**; con menos, «No alcanzaste el mínimo». Es informativa: **aprobar el curso** lo deciden las reglas.`,
    example: { passScore: 80 },
  },
  "exam.shuffle": {
    label: "Barajar preguntas",
    where: WHERE,
    kicker: "Lo que ve cada alumno",
    caption: ({ shuffle }) =>
      shuffle
        ? "**Encendido**: cada alumno ve las mismas preguntas **en distinto orden**."
        : "**Apagado**: todos ven las preguntas **en el mismo orden**.",
    example: { shuffle: true },
  },
  "exam.pool": {
    label: "Preguntas por intento",
    where: WHERE,
    kicker: "Cómo se arma cada intento",
    caption: ({ draw, bank }) =>
      bank === 0
        ? "Agrega preguntas al banco; luego cada intento puede tomar **solo algunas al azar**."
        : draw !== null && draw < bank
          ? `Cada intento toma **${draw} preguntas al azar** del banco de ${bank}: dos intentos casi nunca son iguales.`
          : `Cada intento usa **todas las preguntas** del banco (${bank}).`,
    example: { draw: 5, bank: 20 },
  },
  "exam.results": {
    label: "Mostrar resultados",
    where: WHERE,
    kicker: "Al enviar el examen",
    caption: ({ mode }) =>
      mode === "immediately"
        ? "**Al enviar**: el alumno ve su calificación y el **desglose por pregunta** en ese momento."
        : mode === "after_close"
          ? "**Al cerrar el examen**: al enviar se le avisa que los resultados estarán **disponibles al cierre** (o antes, si los publicas)."
          : "**Cuando yo decida**: al enviar ve «Tu examen fue enviado»; su calificación **se le muestra cuando la publiques** con «Publicar resultados».",
    example: { mode: "immediately" },
  },
  "exam.openQuestion": {
    label: "Pregunta de texto abierto",
    where: "Examen › Preguntas",
    kicker: "Qué pasa al enviarla",
    caption: () =>
      "El alumno escribe su respuesta; al enviar, llega a **Por calificar** y su examen queda **en revisión** hasta que la califiques.",
    example: {},
  },
  "exam.ordering": {
    label: "Ordenar pasos",
    where: "Examen › Preguntas",
    kicker: "Cómo se califica",
    caption: () =>
      "El alumno acomoda los pasos revueltos. Se cuentan los **pares de pasos seguidos** que quedaron bien: si uno está fuera de lugar, solo pierde lo que ese paso rompe.",
    example: {},
  },
};
