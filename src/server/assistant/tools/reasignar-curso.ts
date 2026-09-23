import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { adminReassignCourse } from "@/server/services/admin";
import { getCourse, type Course } from "@/server/services/courses";
import type { ProposalRow } from "@/lib/assistant-blocks";
import { createProposal } from "../proposal-store";
import { schema, str, strList, param, paramList, type AssistantTool } from "../tool-types";

/**
 * Cambiar de dueño uno o varios cursos, como Administración → Cursos. Es cosa
 * seria: el curso se va con sus alumnos, su avance y sus certificados, y el
 * maestro anterior deja de verlo (sus listas filtran por dueño). Por eso va con
 * tabla de revisión y con la palabra REASIGNAR escrita a mano.
 *
 * Lo ya emitido no se toca: cada certificado guarda el nombre del maestro que
 * lo firmó en `certificates.template_snapshot`, y el PDF se dibuja desde ahí.
 */

// Todo viene de la base: se ve, no se edita
const COLUMNS = [
  { key: "curso", label: "Curso", editable: false },
  { key: "actual", label: "Dueño actual", editable: false },
  { key: "nuevo", label: "Dueño nuevo", editable: false },
];

/** Cuántos maestros se enumeran en el chat cuando hay que preguntar cuál. */
const MAX_SUGERIDOS = 8;

type Maestro = { id: string; fullName: string; email: string };

/** Minúsculas, sin acentos y sin espacios de sobra: así se compara un nombre dicho de viva voz. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Maestros activos: son los únicos a los que se le puede dejar un curso. */
function maestrosActivos(): Maestro[] {
  return db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(and(eq(users.role, "teacher"), eq(users.active, true)))
    .orderBy(users.fullName)
    .all();
}

function lista(maestros: Maestro[]): string {
  const nombres = maestros.slice(0, MAX_SUGERIDOS).map((m) => `${m.fullName} (${m.email})`);
  if (maestros.length > MAX_SUGERIDOS) nombres.push(`y ${maestros.length - MAX_SUGERIDOS} más`);
  return nombres.join(", ");
}

/**
 * El maestro que quiso decir el usuario: por id, por correo exacto o por un
 * nombre parecido. Si hay varios que encajan no se elige ninguno: se enumeran
 * y se pregunta.
 */
function resolverMaestro(texto: string): { maestro: Maestro } | { error: string } {
  const maestros = maestrosActivos();
  if (maestros.length === 0) {
    return { error: "No hay ningún maestro activo al que pasarle cursos. Se dan de alta en Administración → Usuarios." };
  }
  const porId = maestros.find((m) => m.id === texto);
  if (porId) return { maestro: porId };

  const buscado = normalizar(texto);
  const porCorreo = maestros.find((m) => m.email.toLowerCase() === buscado);
  if (porCorreo) return { maestro: porCorreo };

  const exactos = maestros.filter((m) => normalizar(m.fullName) === buscado);
  const candidatos =
    exactos.length > 0
      ? exactos
      : maestros.filter((m) => normalizar(m.fullName).includes(buscado) || m.email.toLowerCase().includes(buscado));
  if (candidatos.length === 1) return { maestro: candidatos[0] };
  if (candidatos.length > 1) {
    return { error: `Hay varios maestros que se parecen a «${texto}»: ${lista(candidatos)}. Pregúntale al usuario cuál y no elijas tú.` };
  }
  return { error: `No encontré ningún maestro activo que se llame «${texto}». Los que hay son: ${lista(maestros)}.` };
}

function nombreDe(ownerId: string): string {
  return db.select({ n: users.fullName }).from(users).where(eq(users.id, ownerId)).get()?.n ?? "(sin dueño)";
}

type Fila = { row: ProposalRow; course: Course | null };

/** Una fila por curso, con el dueño que tiene y el que tendría. */
function filasDe(courseIds: string[], maestro: Maestro): Fila[] {
  return courseIds.map((id) => {
    const course = getCourse(id);
    if (!course) {
      return { course: null, row: { id, cells: { curso: id, actual: "", nuevo: maestro.fullName }, warning: "No encontramos ese curso", blocked: true } };
    }
    const cells = { curso: course.title, actual: nombreDe(course.ownerId), nuevo: maestro.fullName };
    if (course.ownerId === maestro.id) return { course, row: { id, cells, warning: "Ya es de ese maestro", blocked: true } };
    return { course, row: { id, cells } };
  });
}

export const reasignarCurso: AssistantTool = {
  name: "reasignar_curso",
  description:
    "Cambia de dueño uno o varios cursos: pasan a otro maestro con sus alumnos, su avance y sus certificados, y el maestro anterior deja de verlos. Solo el administrador. Muestra una tabla para revisar y hay que escribir REASIGNAR para aplicarla.",
  parameters: schema({
    curso_ids: strList("Ids de los cursos que cambian de dueño, de buscar_curso"),
    maestro: str("Nombre o correo del maestro que se queda con los cursos"),
  }),
  roles: ["admin"],
  // Se lleva alumnos y certificados y el maestro anterior deja de verlos
  risk: "review",
  run(params, ctx) {
    if (ctx.user.role !== "admin") return { forModel: "Reasignar cursos solo lo puede hacer el administrador." };

    const courseIds = [...new Set(paramList(params, "curso_ids"))];
    if (courseIds.length === 0) {
      return { forModel: "Falta qué cursos reasignar: pásame los curso_ids (de buscar_curso) o pregúntale al usuario cuáles." };
    }
    const texto = param(params, "maestro");
    if (!texto) {
      const maestros = maestrosActivos();
      return {
        forModel:
          maestros.length === 0
            ? "No hay ningún maestro activo al que pasarle cursos. Se dan de alta en Administración → Usuarios."
            : `Falta a qué maestro pasan los cursos. Los que hay son: ${lista(maestros)}. Pregúntale al usuario cuál.`,
      };
    }
    const resuelto = resolverMaestro(texto);
    if ("error" in resuelto) return { forModel: resuelto.error };
    const maestro = resuelto.maestro;

    const rows = filasDe(courseIds, maestro).map((f) => f.row);
    const proposalId = createProposal("reasignar_curso", ctx, ctx.messageId, {
      title: `Pasar ${rows.length} curso(s) a ${maestro.fullName}`,
      applyLabel: "Reasignar",
      columns: COLUMNS,
      rows,
      payload: { maestroId: maestro.id, maestroNombre: maestro.fullName },
      // Irreversible desde el chat: se escribe la palabra
      confirmWord: "REASIGNAR",
    });

    // La IA solo ve cuántos son: los títulos y los dueños se quedan en la tabla
    const ok = rows.filter((r) => !r.blocked).length;
    const bloqueadas = rows.length - ok;
    const partes = [`Se creó una propuesta con ${rows.length} curso(s): ${ok} pasarían a ${maestro.fullName}`];
    if (bloqueadas > 0) partes.push(`${bloqueadas} con aviso (no existe o ya es suyo)`);
    partes.push("para aplicarla habrá que escribir REASIGNAR");
    return { forModel: `${partes.join("; ")}. El usuario revisará la tabla.`, proposalId };
  },
  /**
   * Aplica las filas ya revisadas. Se vuelve a mirar cada curso (pudo cambiar
   * de dueño mientras tanto) y se usa la misma función que Administración, que
   * ya deja su propia auditoría (`reassign_course`).
   */
  apply(rows, payload, ctx, confirm) {
    if (ctx.user.role !== "admin") return { text: "Reasignar cursos solo lo puede hacer el administrador; no se cambió ninguno." };
    if (confirm.trim().toLowerCase() !== "reasignar") return { text: "No se reasignó ningún curso: falta escribir REASIGNAR." };

    const maestroId = String(payload.maestroId ?? "");
    const maestro = maestrosActivos().find((m) => m.id === maestroId);
    if (!maestro) return { text: "Ese maestro ya no está disponible; no se cambió ningún curso." };

    const motivos: string[] = [];
    let hechos = 0;
    for (const fila of filasDe(rows.map((r) => r.id), maestro)) {
      if (fila.row.blocked || !fila.course) {
        motivos.push(fila.row.warning ?? "ya no se puede");
        continue;
      }
      try {
        adminReassignCourse(ctx.user.id, fila.course.id, maestro.id);
        hechos++;
      } catch (err) {
        motivos.push(err instanceof Error ? err.message : "no se pudo reasignar");
      }
    }

    let text =
      `${hechos} curso(s) pasaron a ${maestro.fullName}, con sus alumnos, su avance y sus certificados; ` +
      "quien los tenía antes deja de verlos. Los certificados ya emitidos conservan el nombre del maestro que los firmó.";
    if (motivos.length > 0) text += ` ${motivos.length} no se pudieron: ${[...new Set(motivos)].join("; ")}.`;
    return {
      text,
      blocks: [
        {
          type: "links",
          links: [
            { label: "Ver cursos en Administración", href: "/admin/courses", icon: "course" },
            { label: "Ver usuarios", href: "/admin/users", icon: "user" },
          ],
        },
      ],
    };
  },
};
