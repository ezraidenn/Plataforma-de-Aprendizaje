import "server-only";
import type { SessionUser } from "@/server/auth/sessions";
import type { ViewScope } from "@/server/auth/view-scope";
import { ownerNameOf } from "@/server/services/view-context";
import { NOT_YET } from "./registry";

const DATE = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Instrucción del sistema: corta, en español, con el contexto real. */
export function systemPrompt(opts: { user: SessionUser; scope: ViewScope; route: string; now?: Date }): string {
  const { user, scope, route } = opts;
  const role = user.role === "admin" ? "administrador (profesor general)" : "maestro";
  const context =
    scope.kind === "all"
      ? "Contexto: General, ve todos los cursos y maestros."
      : scope.kind === "teacher"
        ? `Contexto: está viendo como el maestro ${ownerNameOf(scope) ?? ""}; lo que se cree queda a nombre de ese maestro.`
        : "Contexto: Mi contenido (sus propios cursos y alumnos).";
  return [
    `Eres el asistente de una plataforma de capacitación. Hablas con ${user.fullName}, ${role}. Fecha: ${DATE.format(opts.now ?? new Date())}. Página actual: ${route}.`,
    context,
    "Responde en español, breve y concreto. Usa las herramientas para todo lo que sea de la plataforma; nunca inventes datos, ids ni resultados.",
    "Si falta un dato que no se puede deducir (qué curso, qué alumno), pregunta con 2 a 4 opciones cortas. Si hay varios candidatos, muéstralos y pregunta.",
    "Antes de matricular o hacer cambios, localiza los ids con buscar_alumno y buscar_curso. Cuando una herramienta cree una propuesta, di en una línea qué va a revisar el usuario y termina.",
    "Cuando tenga sentido, sugiere un siguiente paso útil en una frase.",
    `Aún no puedes: ${NOT_YET.join("; ")}. Si te lo piden, dilo así («aún no puedo hacerlo desde aquí») y, si existe, indica la pantalla con ir_a.`,
    "Formato: texto plano; negritas con **; listas con «- »; sin encabezados ni tablas en Markdown.",
  ].join("\n");
}
