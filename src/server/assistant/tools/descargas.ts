import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { fullScope } from "@/server/auth/view-scope";
import { isStudentVisible } from "@/server/services/student-scope";
import { getOwnedCourse } from "@/server/services/courses";
import { XLSX_MIME, readExport } from "../exports";
import { schema, str, param, type AssistantTool } from "../tool-types";

/**
 * Descargas que el asistente pone a mano: el ZIP de certificados (lo arma la
 * ruta de siempre, con sus permisos) y el CSV que dejó una consulta anterior.
 *
 * Aquí no se genera nada: solo se comprueba que el alumno o el curso sean del
 * usuario y se ofrece el enlace. Quien lo abra vuelve a pasar por el permiso
 * de la ruta.
 */

export const descargarCertificados: AssistantTool = {
  name: "descargar_certificados",
  description:
    "Prepara la descarga de los certificados en PDF (un ZIP) de un alumno o de un curso. Necesita el id de uno de los dos (usa buscar_alumno o buscar_curso).",
  parameters: schema({
    alumno_id: str('Id del alumno cuyos certificados se descargan, de buscar_alumno («» si es por curso)'),
    curso_id: str('Id del curso cuyos certificados se descargan, de buscar_curso («» si es por alumno)'),
  }),
  roles: ["admin", "teacher"],
  risk: "navigate",
  run(params, ctx) {
    const alumnoId = param(params, "alumno_id");
    const cursoId = param(params, "curso_id");
    if (!alumnoId && !cursoId) {
      return { forModel: "Dime de qué alumno o de qué curso; busca el id con buscar_alumno o buscar_curso." };
    }

    if (alumnoId) {
      // Igual que el perfil: el maestro solo descarga lo de sus alumnos
      if (!isStudentVisible(fullScope(ctx.user), alumnoId)) {
        return { forModel: "Ese alumno no está entre los tuyos; no preparé ninguna descarga." };
      }
      const student = db.select({ name: users.fullName }).from(users).where(eq(users.id, alumnoId)).get();
      const nombre = student?.name ?? "el alumno";
      return {
        forModel: `Dejé lista la descarga de los certificados de ${nombre}.`,
        blocks: [
          {
            type: "download",
            label: "Descargar certificados",
            href: `/api/certificates/zip?studentId=${encodeURIComponent(alumnoId)}`,
            detail: `Certificados de ${nombre} en PDF (ZIP)`,
          },
        ],
      };
    }

    const course = getOwnedCourse(cursoId, ctx.user);
    if (!course) return { forModel: "No encontramos ese curso o no te pertenece; no preparé ninguna descarga." };
    return {
      forModel: `Dejé lista la descarga de los certificados de ${course.title}.`,
      blocks: [
        {
          type: "download",
          label: "Descargar certificados",
          href: `/api/certificates/zip?courseId=${encodeURIComponent(course.id)}`,
          detail: `Certificados de ${course.title} en PDF (ZIP)`,
        },
      ],
    };
  },
};

export const descargarCsv: AssistantTool = {
  name: "descargar_csv",
  description:
    "Vuelve a ofrecer una descarga que preparaste antes en esta conversación (el id sale en el resultado de la consulta que la creó).",
  parameters: schema({ descarga_id: str("Id de la descarga que dejó una consulta anterior de esta conversación") }),
  roles: ["admin", "teacher"],
  risk: "navigate",
  run(params, ctx) {
    const id = param(params, "descarga_id");
    // `readExport` ya comprueba dueño y caducidad: aquí no hace falta nada más
    const file = id ? readExport(ctx.user.id, id) : null;
    if (!file) return { forModel: "Esa descarga ya no está disponible; vuelve a hacer la consulta." };
    // El botón dice lo que de verdad se baja: un listado deja Excel y CSV
    return {
      forModel: `Dejé lista la descarga ${file.fileName}.`,
      blocks: [
        {
          type: "download",
          label: file.mime === XLSX_MIME ? "Descargar Excel" : "Descargar CSV",
          href: `/api/assistant/export/${id}`,
          detail: `${file.fileName} · caduca en 24 horas`,
        },
      ],
    };
  },
};
