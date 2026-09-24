import "server-only";
import { getOwnedCourse, type Course } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import { getExam } from "@/server/services/exams";
import { CSV_TEMPLATE } from "@/server/services/csv-import";
import { exportRosterCsv } from "@/server/services/bulk-roster";
import { exportLessonsCsv } from "@/server/services/bulk-lessons";
import { EXAM_CSV_TEMPLATE, exportExamCsv, countImageQuestions } from "@/server/services/exam-csv";
import { BOM, csvLine, parseCsv } from "@/server/services/csv-core";
import { buildXlsx, type Cell, type SheetSpec } from "@/server/services/xlsx";
import type { AssistantBlock } from "@/lib/assistant-blocks";
import { FORMAT_LABELS, type ExcelFormat } from "@/lib/excel-formats";
import { plural } from "@/lib/plural";
import { XLSX_MIME, createExport, createFileExport, exportFileName } from "../exports";
import { schema, str, strEnum, param, type AssistantTool } from "../tool-types";

/**
 * El formato de Excel que la plataforma ya sabe leer, listo para llenar.
 *
 * Nada se inventa aquí: las columnas salen de los mismos módulos que después
 * leerán el archivo (`csv-import`, `bulk-roster`, `bulk-lessons`, `exam-csv`),
 * así que si allá cambia una columna, el formato la trae sola. Alumnos y
 * cursos salen en blanco con una fila de ejemplo; matrícula, lecciones y
 * examen salen CON los datos actuales, porque son para editar y devolver.
 *
 * La vuelta la da `aplicar_excel` (o `alta_alumnos` / `crear_cursos`).
 */

const TIPOS = ["alumnos", "cursos", "matricula", "lecciones", "examen"] as const;

/** Máximo de filas que se vuelcan a la hoja (lo mismo que admiten los validadores). */
const MAX_ROWS = 5000;

/** Ancho en centímetros de cada columna conocida; lo demás va con el de por defecto. */
const WIDTHS: Record<string, number> = {
  nombre: 7,
  correo: 8,
  contrasena: 5,
  grupo: 5,
  titulo: 9,
  descripcion: 14,
  vigencia: 5,
  progreso: 4,
  estado: 4,
  accion: 5,
  id: 5,
  carpeta: 6,
  tipo: 5,
  requerido: 4,
  secuencia: 5,
  visible: 4,
  segundos_minimos: 5,
  pregunta: 14,
  puntos: 3,
  correctas: 5,
  respuestas_aceptadas: 9,
  pares: 11,
  pasos: 12,
};

type Plantilla = {
  /** Nombre de la hoja */
  hoja: string;
  csv: string;
  /** Columnas informativas: se ven en gris para que nadie las toque */
  grises?: string[];
  /** Columnas que se entregan vacías porque son las que hay que llenar */
  vacias?: string[];
  /** Todas las filas son de ejemplo (formato en blanco): van en gris */
  ejemplo?: boolean;
  notas: string[];
  /** Qué tiene que hacer el usuario con el archivo */
  pista: string;
  /** Preguntas sobre imagen del examen que no caben aquí (solo tipo «examen»). */
  omitidas?: number;
};

/** CSV ya generado → hoja con formato, respetando qué columnas son informativas. */
function sheetOf(plantilla: Plantilla): SheetSpec {
  const parsed = parseCsv(plantilla.csv, { maxRows: MAX_ROWS });
  const columns = parsed.headers.map((h) => ({ title: h, width: WIDTHS[h] ?? 6 }));
  const rows = parsed.rows.map(({ cells }) =>
    parsed.headers.map((h, i): Cell => {
      if (plantilla.vacias?.includes(h)) return { text: "" };
      const gris = plantilla.ejemplo || plantilla.grises?.includes(h);
      return { text: cells[i] ?? "", ...(gris ? { style: "muted" as const } : {}) };
    })
  );
  return { name: plantilla.hoja, columns, rows, notes: plantilla.notas };
}

/** Alumnos: las columnas de `CSV_TEMPLATE` más «grupo», que el alta con IA ya entiende. */
function plantillaAlumnos(): Plantilla {
  const base = parseCsv(CSV_TEMPLATE, { maxRows: 10 });
  const headers = [...base.headers, "grupo"];
  const ejemplo = base.headers.map((_, i) => base.rows[0]?.cells[i] ?? "");
  return {
    hoja: "Alumnos",
    csv: BOM + [csvLine(headers), csvLine([...ejemplo, "Matutino"])].join("\r\n"),
    ejemplo: true,
    notas: [
      "Una fila por alumno. La fila gris es solo un ejemplo: bórrala o escribe encima.",
      "nombre: obligatorio, nombre y apellidos completos (mínimo 3 letras).",
      "correo: obligatorio. Es con lo que entra a la plataforma, así que no puede repetirse ni existir ya.",
      "contrasena: opcional. Déjala vacía y se genera sola (te la doy al terminar, una sola vez); si la escribes, mínimo 8 caracteres.",
      "grupo: opcional. El grupo del curso al que entran («Matutino», «Turno A»); se crea si no existe. Solo cuenta si los das de alta dentro de un curso.",
    ],
    pista: "Llénalo con tus alumnos y suéltalo aquí otra vez: les creo la cuenta (y los matriculo si me dices en qué curso).",
  };
}

/** Cursos: lo que entiende `crear_cursos` (nacen en borrador). */
function plantillaCursos(): Plantilla {
  return {
    hoja: "Cursos",
    csv:
      BOM +
      [
        csvLine(["titulo", "descripcion", "vigencia"]),
        csvLine(["Manejo de extintores", "Curso básico de prevención y combate de incendios", 12]),
      ].join("\r\n"),
    ejemplo: true,
    notas: [
      "Una fila por curso. La fila gris es solo un ejemplo: bórrala o escribe encima.",
      "titulo: obligatorio y sin repetirse entre tus cursos.",
      "descripcion: opcional, un par de líneas de qué trata.",
      "vigencia: meses que vale el certificado, de 1 a 120. Vacío o 0 = sin vencimiento.",
      "Los cursos se crean en BORRADOR: el contenido y la publicación van después.",
    ],
    pista: "Llénalo con tus cursos y suéltalo aquí otra vez: los creo en borrador.",
  };
}

const NOTAS_MATRICULA = [
  "Lo único que se edita es la columna «accion»: escribe matricular o quitar. Déjala vacía para no tocar a ese alumno.",
  "correo: es quien identifica al alumno. No lo cambies.",
  "nombre, progreso y estado son informativos (en gris): lo que escribas ahí se ignora.",
  "Para matricular a alguien que no está en la lista, agrégalo abajo con su correo y «matricular». La cuenta tiene que existir ya; si no, primero dame la lista de alumnos para darlos de alta.",
  "Quitar a alguien lo da de baja del curso: su avance se guarda y se puede reactivar después.",
];

const NOTAS_LECCIONES = [
  "No toques la columna «id»: es la que dice qué lección se está editando. «carpeta» y «tipo» son informativas (en gris).",
  "titulo: el nombre con el que se ve la lección.",
  "requerido: SI o NO — si cuenta para terminar el curso. Las carpetas no lo usan.",
  "secuencia: heredar, obligatoria o libre — si hay que llevar el orden dentro de esa parte.",
  "visible: SI o NO — si el alumno la ve.",
  "segundos_minimos: tiempo mínimo de 0 a 3600 (en documentos, por página; en lecturas, el total). Solo aplica a documentos y lecturas.",
  "Una celda vacía deja el valor como está. Crear, mover o borrar lecciones se hace en el editor del curso, no aquí.",
];

const NOTAS_EXAMEN = [
  "tipo: opcion_unica, opcion_multiple, verdadero_falso, respuesta_corta, relacionar, ordenar o abierta.",
  "pregunta: el enunciado. puntos: cuánto vale (1 si lo dejas vacío).",
  "opcion_1 a opcion_6: las opciones de opcion_unica y opcion_multiple (mínimo dos; deja vacías las que sobren).",
  "correctas: el NÚMERO de la opción correcta; varias separadas por | (por ejemplo 1|3). En verdadero_falso escribe V o F.",
  "respuestas_aceptadas: solo en respuesta_corta, las variantes que se dan por buenas separadas por | (911|9 1 1).",
  "pares: solo en relacionar, con el formato izquierda=derecha | izquierda2=derecha2 (mínimo dos).",
  "pasos: solo en ordenar, los pasos en el orden correcto separados por | (mínimo tres).",
  "abierta no lleva opciones: la califica el maestro a mano.",
];

/** Matrícula del curso tal como está hoy; sin alumnos, una fila de ejemplo. */
function plantillaMatricula(titulo: string, courseId: string): Plantilla {
  const actual = exportRosterCsv(courseId);
  const vacio = parseCsv(actual, { maxRows: MAX_ROWS }).rows.length === 0;
  return {
    hoja: "Matrícula",
    csv: vacio
      ? actual + "\r\n" + csvLine(["laura.perez@empresa.com", "", "", "", "matricular"])
      : actual,
    grises: ["nombre", "progreso", "estado"],
    vacias: ["accion"],
    ejemplo: vacio,
    notas: vacio ? ["Este curso todavía no tiene a nadie: la fila gris es un ejemplo.", ...NOTAS_MATRICULA] : NOTAS_MATRICULA,
    pista: `Escribe matricular o quitar en la columna «accion» de ${titulo} y suéltalo aquí otra vez: te muestro los cambios antes de aplicarlos.`,
  };
}

/** Lecciones del curso tal como están hoy. `null` = el curso está vacío. */
function plantillaLecciones(titulo: string, courseId: string): Plantilla | null {
  const actual = exportLessonsCsv(courseId);
  if (parseCsv(actual, { maxRows: MAX_ROWS }).rows.length === 0) return null;
  return {
    hoja: "Lecciones",
    csv: actual,
    grises: ["id", "carpeta", "tipo"],
    notas: NOTAS_LECCIONES,
    pista: `Cambia lo que quieras de ${titulo} menos la columna «id» y suéltalo aquí otra vez: te muestro los cambios antes de aplicarlos.`,
  };
}

/** Preguntas del examen; sin `item_id` (o sin preguntas), la plantilla con un ejemplo de cada tipo. */
function plantillaExamen(examen: { id: string; title: string } | null): Plantilla {
  const actual = examen ? exportExamCsv(examen.id) : "";
  const conPreguntas = !!actual && parseCsv(actual, { maxRows: MAX_ROWS }).rows.length > 0;
  // No caben en el Excel: el examen las conserva, pero hay que decirlo (nota
  // aparte, nunca mezclada con notas[0]: el número exacto llega tal cual)
  const imagenes = examen ? countImageQuestions(examen.id) : 0;
  const notaImagenes =
    imagenes > 0
      ? plural(
          imagenes,
          "1 pregunta sobre imagen no cabe en este Excel; al reemplazar se conserva tal como está.",
          `${imagenes} preguntas sobre imagen no caben en este Excel; al reemplazar se conservan tal como están.`
        )
      : "";
  if (!conPreguntas) {
    return {
      hoja: "Preguntas",
      csv: EXAM_CSV_TEMPLATE,
      ejemplo: true,
      notas: [
        examen
          ? imagenes > 0
            ? "Ese examen todavía no tiene preguntas que quepan en este Excel: las filas grises son un ejemplo de cada tipo."
            : "Ese examen todavía no tiene preguntas: las filas grises son un ejemplo de cada tipo."
          : "Las filas grises son un ejemplo de cada tipo: bórralas o escribe encima.",
        ...(notaImagenes ? [notaImagenes] : []),
        ...NOTAS_EXAMEN,
      ],
      pista: "Escribe tus preguntas y suéltalo aquí otra vez, diciéndome a qué examen van: te pregunto si reemplazo las que tenga o las agrego al final.",
      omitidas: imagenes,
    };
  }
  return {
    hoja: "Preguntas",
    csv: actual,
    notas: [
      "Al devolverme este archivo te pregunto qué hacer: REEMPLAZAR las preguntas que tiene el examen por las de aquí, o AGREGARLAS al final. Si solo corriges estas, lo tuyo es reemplazar: agregarlas las dejaría duplicadas.",
      ...(notaImagenes ? [notaImagenes] : []),
      ...NOTAS_EXAMEN,
    ],
    pista: `Edita o agrega preguntas de ${examen!.title} y suéltalo aquí otra vez: te pregunto si reemplazo las que tiene o las agrego al final.`,
    omitidas: imagenes,
  };
}

export const formatoExcel: AssistantTool = {
  name: "formato_excel",
  description:
    "Deja para descargar el formato de Excel que la plataforma sabe leer, con sus columnas y una hoja de notas: alumnos y cursos en blanco; matrícula, lecciones y examen con los datos actuales para editarlos. El usuario lo llena y lo vuelve a subir: entonces se usa aplicar_excel (matrícula, lecciones, examen), alta_alumnos o crear_cursos.",
  parameters: schema({
    tipo: strEnum(
      "Qué formato: «alumnos» (altas en blanco), «cursos» (en blanco), «matricula» (los alumnos del curso para matricular o quitar), «lecciones» (las lecciones del curso para editar sus propiedades) o «examen» (las preguntas)",
      [...TIPOS]
    ),
    curso_id: str("Id del curso, de buscar_curso. Obligatorio en «matricula» y «lecciones» («» en los demás)"),
    item_id: str("Solo en «examen»: id del examen para exportar sus preguntas actuales («» = formato en blanco)"),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  async run(params, ctx) {
    const tipo = param(params, "tipo") as ExcelFormat;
    if (!(TIPOS as readonly string[]).includes(tipo)) {
      return { forModel: `No sé qué formato quieres. Los que tengo son: ${TIPOS.join(", ")}.` };
    }

    /** El curso del parámetro, comprobando que sea suyo. */
    const curso = (): { error: string } | { course: Course } => {
      const id = param(params, "curso_id");
      if (!id) return { error: `Para el formato de ${FORMAT_LABELS[tipo]} necesito el id del curso; búscalo con buscar_curso.` };
      const course = getOwnedCourse(id, ctx.user);
      if (!course) return { error: "No encontramos ese curso o no te pertenece; no generé ningún formato." };
      return { course };
    };

    let plantilla: Plantilla;
    const nombre = `formato-${tipo}`;
    let de = "";

    if (tipo === "alumnos") {
      plantilla = plantillaAlumnos();
    } else if (tipo === "cursos") {
      plantilla = plantillaCursos();
    } else if (tipo === "matricula" || tipo === "lecciones") {
      const found = curso();
      if ("error" in found) return { forModel: found.error };
      de = ` de ${found.course.title}`;
      const hecha =
        tipo === "matricula"
          ? plantillaMatricula(found.course.title, found.course.id)
          : plantillaLecciones(found.course.title, found.course.id);
      if (!hecha) {
        return { forModel: `${found.course.title} todavía no tiene lecciones, así que no hay nada que exportar. El contenido se agrega en el editor del curso.` };
      }
      plantilla = hecha;
    } else {
      // Examen: el mismo camino que «Exportar CSV» del examen (ítem → curso → dueño)
      const itemId = param(params, "item_id");
      let examen: { id: string; title: string } | null = null;
      if (itemId) {
        const item = getItem(itemId);
        if (!item || item.kind !== "exam" || !getExam(itemId)) return { forModel: "No encontramos ese examen; busca el curso con buscar_curso y el examen en su contenido." };
        if (!getOwnedCourse(item.courseId, ctx.user)) return { forModel: "Ese examen es de un curso que no te pertenece; no generé ningún formato." };
        examen = { id: item.id, title: item.title };
        de = ` de ${item.title}`;
      }
      plantilla = plantillaExamen(examen);
    }

    const filas = parseCsv(plantilla.csv, { maxRows: MAX_ROWS }).rows.length;
    const cuantas = `${filas} ${filas === 1 ? "fila" : "filas"}`;
    const blocks: AssistantBlock[] = [];
    // El número exacto viene de `plantilla.omitidas`; al modelo se le pide
    // que se lo diga al usuario, no solo que lo sepa
    const avisoImagenes = plantilla.omitidas
      ? plural(
          plantilla.omitidas,
          "1 pregunta sobre imagen no cabe en el Excel; en el examen se queda como está.",
          `${plantilla.omitidas} preguntas sobre imagen no caben en el Excel; en el examen se quedan como están.`
        )
      : "";

    try {
      const bytes = await buildXlsx([sheetOf(plantilla)]);
      const exportId = await createFileExport(ctx.conversationId, exportFileName(nombre, "xlsx"), bytes, XLSX_MIME, ctx.user.id);
      blocks.push({
        type: "download",
        label: "Descargar el formato",
        href: `/api/assistant/export/${exportId}`,
        detail: `${Math.max(1, Math.round(bytes.length / 1024))} KB · ${cuantas} · caduca en 24 horas`,
      });
      blocks.push({ type: "text", text: plantilla.pista });
      return {
        forModel: `Le dejé el formato de ${FORMAT_LABELS[tipo]}${de} (${cuantas}) para descargar, con sus notas.${avisoImagenes ? ` ${avisoImagenes} Coméntaselo al usuario.` : ""} Descarga: ${exportId}.`,
        blocks,
      };
    } catch {
      // Sin LibreOffice no hay Excel; el CSV lleva exactamente las mismas columnas
      const exportId = createExport(ctx.conversationId, exportFileName(nombre), plantilla.csv);
      blocks.push({
        type: "download",
        label: "Descargar el formato (CSV)",
        href: `/api/assistant/export/${exportId}`,
        detail: `${cuantas} · caduca en 24 horas`,
      });
      blocks.push({ type: "text", text: `${plantilla.pista} ${plantilla.notas[0]}${avisoImagenes ? ` ${avisoImagenes}` : ""}` });
      return {
        forModel: `No se pudo generar el Excel, así que le dejé el mismo formato en CSV (${cuantas}).${avisoImagenes ? ` ${avisoImagenes} Coméntaselo al usuario.` : ""} Descarga: ${exportId}.`,
        blocks,
      };
    }
  },
};
