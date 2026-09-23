import "server-only";
import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { dateRange } from "@/lib/assistant-dates";
import { matchesSearch } from "@/server/db/search";
import { auditActionLabel } from "@/components/admin/format";
import {
  auditLog,
  certificateTemplates,
  certificates,
  cohorts,
  courseItems,
  courses,
  enrollments,
  users,
} from "@/server/db/schema";
import { MAX_CSV_ROWS, tile, toResult } from "../queries";
import { param, schema, str, strEnum, type AssistantTool } from "../tool-types";
import { resultBlocks } from "./consulta-comun";

/**
 * El historial de cambios (`audit_log`) contado en español: quién hizo qué,
 * sobre qué y cuándo.
 *
 * Reglas fijas de aquí:
 * - El admin ve todo el registro; el maestro, lo que hizo él más lo que
 *   hicieron otros sobre SUS cursos o SUS alumnos (ver `delMaestro`).
 * - Nada de jerga: cada acción se traduce a una frase, y las del asistente
 *   se marcan como tales. Lo que no conocemos cae en la etiqueta que ya usa
 *   Administración → Auditoría (`auditActionLabel`), nunca en `snake_case`.
 * - La IA recibe una línea: cuántos cambios y los tres últimos. Sin correos.
 */

// Igual que las consultas: fecha corta con hora, y el año solo si es de otro año.
const MOMENT_FMT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const MOMENT_YEAR_FMT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function fmtMoment(value: Date): string {
  return (value.getFullYear() === new Date().getFullYear() ? MOMENT_FMT : MOMENT_YEAR_FMT).format(value);
}

// ─── Qué pasó ────────────────────────────────────────────────────────────────

/**
 * Acciones de la plataforma, en pasado y sin tecnicismos. Están todas las que
 * alguien registra hoy (`audit(...)` en servicios y acciones de servidor); lo
 * que se agregue mañana cae en `auditActionLabel`.
 */
const ACCION: Record<string, string> = {
  activate_student: "activó a un alumno",
  activate_user: "activó una cuenta",
  ai_import_exam: "importó preguntas con IA",
  ai_import_students: "importó alumnos con IA",
  archive_course: "archivó el curso",
  change_own_password: "cambió su contraseña",
  change_role: "cambió el rol de una cuenta",
  clear_ai_settings: "quitó la clave de la IA",
  close_cohort: "cerró el grupo",
  create_cohort: "creó el grupo",
  create_course: "creó el curso",
  create_student: "dio de alta a un alumno",
  create_template: "creó una plantilla de diploma",
  create_user: "creó una cuenta",
  deactivate_student: "deshabilitó a un alumno",
  deactivate_user: "deshabilitó una cuenta",
  delete_cohort: "eliminó el grupo",
  delete_course: "eliminó el curso",
  delete_user: "eliminó una cuenta",
  dismiss_renewal: "descartó una renovación",
  download_certificates_zip: "descargó certificados",
  duplicate_item: "duplicó una lección",
  enroll_students: "matriculó alumnos",
  grant_branding: "dio permiso para cambiar la marca",
  hide_exam_results: "ocultó los resultados del examen",
  import_cohort: "copió un grupo a otro curso",
  import_csv: "importó alumnos",
  import_exam_csv: "importó preguntas",
  import_lessons_csv: "importó lecciones",
  import_roster_csv: "importó la lista de alumnos",
  publish_exam_results: "publicó los resultados del examen",
  purge_enrollments: "vació la papelera del curso",
  reassign_course: "cambió el dueño del curso",
  renew_certificate: "recertificó",
  rename_cohort: "renombró el grupo",
  reopen_cohort: "reabrió el grupo",
  reset_password: "restableció una contraseña",
  reset_student_password: "restableció la contraseña de un alumno",
  restore_enrollments: "restauró matrículas de la papelera",
  retry_job: "reintentó un trabajo",
  revoke_branding: "quitó el permiso para cambiar la marca",
  transfer_template: "transfirió una plantilla de diploma",
  update_ai_settings: "configuró la IA",
  update_branding: "cambió la marca de la plataforma",
  update_own_email: "cambió su correo",
  update_own_name: "cambió su nombre",
  update_storage_root: "cambió la carpeta de archivos",
  update_user: "editó los datos de una cuenta",
};

/**
 * Acciones del asistente. La clave es el nombre de la herramienta, porque se
 * registran de las dos formas: `assistant_<herramienta>` al aplicar una
 * propuesta (entidad `ai_proposal`) y otra vez por cada cosa que tocó.
 */
const ACCION_ASISTENTE: Record<string, string> = {
  alta_alumnos: "dio de alta alumnos",
  aplicar_excel: "aplicó un Excel",
  asignar_diploma: "cambió el diploma del curso",
  avisar: "mandó un aviso",
  baja_alumnos: "dio de baja alumnos",
  crear_cursos: "creó cursos",
  crear_maestro: "creó un maestro",
  duplicar_curso: "duplicó el curso",
  fecha_limite: "cambió la fecha límite",
  grupos: "cambió un grupo",
  matricular: "matriculó alumnos",
  publicar_curso: "cambió el estado del curso",
  reactivar_alumnos: "reactivó alumnos",
  reasignar_curso: "cambió el dueño del curso",
  recertificar: "recertificó",
  restaurar: "restauró matrículas de la papelera",
};

/**
 * Herramientas que hacen VARIAS cosas: la que se hizo va en el detalle del
 * registro (`accion`), no en el nombre de la herramienta. Sin esto, crear o
 * renombrar un grupo se leería como «movió alumnos de grupo», que no pasó.
 */
const ACCION_DETALLE: Record<string, Record<string, string>> = {
  grupos: {
    crear: "creó el grupo",
    mover: "movió alumnos de grupo",
    renombrar: "renombró el grupo",
    cerrar: "cerró el grupo",
    reabrir: "reabrió el grupo",
    borrar: "eliminó el grupo",
  },
};

const PREFIJO = "assistant_";

/** La acción guardada en el detalle del registro, si la hay. */
function accionDelDetalle(detail: unknown): string {
  if (typeof detail !== "object" || detail === null) return "";
  const valor = (detail as Record<string, unknown>).accion;
  return typeof valor === "string" ? valor : "";
}

/** «dio de baja alumnos (con el asistente)», «deshizo: matriculó alumnos (con el asistente)». */
export function queTexto(action: string, detail?: unknown): string {
  const deshacer = action.endsWith("_undo");
  const base = deshacer ? action.slice(0, -"_undo".length) : action;
  const asistente = base.startsWith(PREFIJO);
  const clave = asistente ? base.slice(PREFIJO.length) : base;
  const etiqueta =
    (asistente ? ACCION_DETALLE[clave]?.[accionDelDetalle(detail)] : undefined) ??
    (asistente
      ? (ACCION_ASISTENTE[clave] ?? ACCION[clave] ?? auditActionLabel(clave).toLowerCase())
      : (ACCION[clave] ?? auditActionLabel(clave).toLowerCase()));
  const texto = deshacer ? `deshizo: ${etiqueta}` : etiqueta;
  return asistente ? `${texto} (con el asistente)` : texto;
}

// ─── Permisos ────────────────────────────────────────────────────────────────

/**
 * `entity_id` no siempre es un id a secas: la matrícula del asistente se
 * guarda como «curso:alumno». Estas dos expresiones parten ese par; con un id
 * normal devuelven el id tal cual. Se parte con `instr`/`substr` y no con
 * LIKE porque los ids llevan «_», que en LIKE es un comodín.
 */
const CURSO_DEL_ID = sql`CASE WHEN instr(${auditLog.entityId}, ':') > 0
  THEN substr(${auditLog.entityId}, 1, instr(${auditLog.entityId}, ':') - 1)
  ELSE ${auditLog.entityId} END`;
const ALUMNO_DEL_ID = sql`CASE WHEN instr(${auditLog.entityId}, ':') > 0
  THEN substr(${auditLog.entityId}, instr(${auditLog.entityId}, ':') + 1)
  ELSE ${auditLog.entityId} END`;

const esSuCurso = (ownerId: string, id: SQL) =>
  sql`EXISTS (SELECT 1 FROM courses c WHERE c.id = ${id} AND c.owner_id = ${ownerId})`;

/** Misma regla que `studentVisibleCondition`: alta propia o matrícula en un curso suyo. */
const esSuAlumno = (ownerId: string, id: SQL) =>
  sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${id} AND u.role = 'student' AND (
    u.created_by = ${ownerId}
    OR EXISTS (SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
                WHERE e.student_id = u.id AND c.owner_id = ${ownerId})))`;

/**
 * Lo que puede ver un maestro: lo que hizo él, y de lo que hicieron otros solo
 * lo que cae sobre sus cursos o sus alumnos. Se acotan únicamente las
 * entidades cuyo `entity_id` se puede resolver sin ambigüedad:
 *
 * - `course` / `courses` → el id es el del curso.
 * - `user` / `users` → el id es el de la cuenta (solo si es alumno suyo).
 * - `enrollment` / `enrollments` → «curso:alumno», el id de la matrícula, el
 *   del curso o el del alumno, según quién lo escribiera.
 * - `cohorts`, `course_items`, `exams`, `certificates` → el id lleva a un
 *   curso (grupo, lección o certificado), y manda el dueño de ese curso.
 *
 * `app_settings`, `jobs`, `certificate_templates` y `ai_proposal` se quedan
 * FUERA para el maestro salvo que las registrara él: su `entity_id` no dice de
 * quién es la cosa (o no hay id), y es preferible enseñar de menos que
 * enseñarle lo de otro maestro.
 */
function delMaestro(ownerId: string): SQL {
  const id = sql`${auditLog.entityId}`;
  return or(
    eq(auditLog.userId, ownerId),
    and(inArray(auditLog.entity, ["course", "courses"]), esSuCurso(ownerId, id)),
    and(inArray(auditLog.entity, ["user", "users"]), esSuAlumno(ownerId, id)),
    and(
      inArray(auditLog.entity, ["enrollment", "enrollments"]),
      or(
        esSuCurso(ownerId, CURSO_DEL_ID),
        esSuAlumno(ownerId, ALUMNO_DEL_ID),
        sql`EXISTS (SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
                     WHERE e.id = ${id} AND c.owner_id = ${ownerId})`
      )
    ),
    and(
      eq(auditLog.entity, "cohorts"),
      sql`EXISTS (SELECT 1 FROM cohorts g JOIN courses c ON c.id = g.course_id
                   WHERE g.id = ${id} AND c.owner_id = ${ownerId})`
    ),
    and(
      inArray(auditLog.entity, ["course_items", "exams"]),
      or(
        esSuCurso(ownerId, id),
        sql`EXISTS (SELECT 1 FROM course_items i JOIN courses c ON c.id = i.course_id
                     WHERE i.id = ${id} AND c.owner_id = ${ownerId})`
      )
    ),
    and(
      eq(auditLog.entity, "certificates"),
      sql`EXISTS (SELECT 1 FROM certificates ce JOIN courses c ON c.id = ce.course_id
                   WHERE ce.id = ${id} AND c.owner_id = ${ownerId})`
    )
  )!;
}

// ─── Filtro «sobre qué» ──────────────────────────────────────────────────────

const SOBRE = ["", "alumno", "curso", "certificado", "usuario"] as const;
type Sobre = (typeof SOBRE)[number];

/** Todo lo registrado sobre un alumno, un curso, un certificado o una cuenta. */
function sujetoCondicion(sobre: Sobre, valor: string): SQL | null {
  const id = sql`${auditLog.entityId}`;
  switch (sobre) {
    case "alumno":
      return or(
        and(inArray(auditLog.entity, ["user", "users"]), eq(auditLog.entityId, valor)),
        and(
          inArray(auditLog.entity, ["enrollment", "enrollments"]),
          or(
            sql`${ALUMNO_DEL_ID} = ${valor}`,
            sql`EXISTS (SELECT 1 FROM enrollments e WHERE e.id = ${id} AND e.student_id = ${valor})`
          )
        ),
        and(
          eq(auditLog.entity, "certificates"),
          sql`EXISTS (SELECT 1 FROM certificates ce WHERE ce.id = ${id} AND ce.student_id = ${valor})`
        )
      )!;
    case "usuario":
      return and(inArray(auditLog.entity, ["user", "users"]), eq(auditLog.entityId, valor))!;
    case "curso":
      return or(
        and(inArray(auditLog.entity, ["course", "courses"]), eq(auditLog.entityId, valor)),
        and(
          inArray(auditLog.entity, ["enrollment", "enrollments"]),
          or(
            sql`${CURSO_DEL_ID} = ${valor}`,
            sql`EXISTS (SELECT 1 FROM enrollments e WHERE e.id = ${id} AND e.course_id = ${valor})`
          )
        ),
        and(
          inArray(auditLog.entity, ["course_items", "exams"]),
          or(
            eq(auditLog.entityId, valor),
            sql`EXISTS (SELECT 1 FROM course_items i WHERE i.id = ${id} AND i.course_id = ${valor})`
          )
        ),
        and(
          eq(auditLog.entity, "cohorts"),
          sql`EXISTS (SELECT 1 FROM cohorts g WHERE g.id = ${id} AND g.course_id = ${valor})`
        ),
        and(
          eq(auditLog.entity, "certificates"),
          sql`EXISTS (SELECT 1 FROM certificates ce WHERE ce.id = ${id} AND ce.course_id = ${valor})`
        )
      )!;
    case "certificado":
      return and(
        eq(auditLog.entity, "certificates"),
        sql`EXISTS (SELECT 1 FROM certificates ce WHERE ce.id = ${id} AND (ce.id = ${valor} OR ce.folio = ${valor}))`
      )!;
    default:
      return null;
  }
}

// ─── Sobre qué fue ───────────────────────────────────────────────────────────

type Fila = {
  action: string;
  entity: string;
  entityId: string | null;
  /** Lo que guardó `audit(...)`: de ahí sale qué se hizo cuando la herramienta hace varias cosas */
  detail: unknown;
  createdAt: Date;
  quien: string | null;
};

/**
 * El texto de la columna «Sobre» para todas las filas de golpe: se juntan los
 * ids por tipo y se leen en una consulta por tabla, en vez de una por fila.
 */
function sobreQueTextos(filas: Fila[]): Map<string, string> {
  const ids = new Set(filas.map((f) => f.entityId).filter((v): v is string => !!v));
  // De «curso:alumno» salen dos ids más que también hay que buscar
  for (const id of [...ids]) {
    const corte = id.indexOf(":");
    if (corte > 0) {
      ids.add(id.slice(0, corte));
      ids.add(id.slice(corte + 1));
    }
  }
  const lista = [...ids];
  const vacio = new Map<string, string>();
  if (lista.length === 0) return vacio;

  const porId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const cursos = porId(db.select({ id: courses.id, title: courses.title }).from(courses).where(inArray(courses.id, lista)).all());
  const personas = porId(db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, lista)).all());
  const lecciones = porId(db.select({ id: courseItems.id, title: courseItems.title, courseId: courseItems.courseId }).from(courseItems).where(inArray(courseItems.id, lista)).all());
  const grupos = porId(db.select({ id: cohorts.id, name: cohorts.name, courseId: cohorts.courseId }).from(cohorts).where(inArray(cohorts.id, lista)).all());
  const diplomas = porId(db.select({ id: certificates.id, folio: certificates.folio, studentId: certificates.studentId }).from(certificates).where(inArray(certificates.id, lista)).all());
  const matriculas = porId(db.select({ id: enrollments.id, courseId: enrollments.courseId, studentId: enrollments.studentId }).from(enrollments).where(inArray(enrollments.id, lista)).all());
  const plantillas = porId(db.select({ id: certificateTemplates.id, name: certificateTemplates.name }).from(certificateTemplates).where(inArray(certificateTemplates.id, lista)).all());

  const curso = (id: string | null | undefined) => (id ? cursos.get(id)?.title : undefined);
  const persona = (id: string | null | undefined) => (id ? personas.get(id)?.name : undefined);
  const enCurso = (alumnoId: string | null, cursoId: string | null): string | undefined => {
    const quien = persona(alumnoId);
    const donde = curso(cursoId);
    if (quien && donde) return `${quien} en «${donde}»`;
    return quien ?? (donde ? `«${donde}»` : undefined);
  };

  const salida = new Map<string, string>();
  for (const fila of filas) {
    const clave = `${fila.entity}|${fila.entityId ?? ""}`;
    if (salida.has(clave)) continue;
    salida.set(clave, textoDe(fila));
  }
  return salida;

  function textoDe(fila: Fila): string {
    const id = fila.entityId;
    switch (fila.entity) {
      case "course":
      case "courses": {
        const titulo = curso(id);
        return titulo ? `«${titulo}»` : "Un curso que ya no está";
      }
      case "user":
      case "users": {
        const nombre = persona(id);
        return nombre ?? (id ? "Una cuenta que ya no está" : "Varias cuentas");
      }
      case "enrollment":
      case "enrollments": {
        if (!id) return "Una matrícula";
        const corte = id.indexOf(":");
        if (corte > 0) return enCurso(id.slice(corte + 1), id.slice(0, corte)) ?? "Una matrícula";
        const matricula = matriculas.get(id);
        if (matricula) return enCurso(matricula.studentId, matricula.courseId) ?? "Una matrícula";
        return enCurso(id, id) ?? "Una matrícula";
      }
      case "cohorts": {
        const grupo = id ? grupos.get(id) : undefined;
        if (!grupo) return "Un grupo que ya no está";
        const donde = curso(grupo.courseId);
        return donde ? `Grupo ${grupo.name} de «${donde}»` : `Grupo ${grupo.name}`;
      }
      case "course_items":
      case "exams": {
        const leccion = id ? lecciones.get(id) : undefined;
        if (leccion) {
          const donde = curso(leccion.courseId);
          return donde ? `${leccion.title} («${donde}»)` : leccion.title;
        }
        const titulo = curso(id);
        return titulo ? `«${titulo}»` : "Contenido que ya no está";
      }
      case "certificates": {
        const diploma = id ? diplomas.get(id) : undefined;
        if (diploma) {
          const quien = persona(diploma.studentId);
          return quien ? `${diploma.folio} · ${quien}` : diploma.folio;
        }
        return enCurso(id, id) ?? "Certificados";
      }
      case "certificate_templates": {
        const plantilla = id ? plantillas.get(id) : undefined;
        return plantilla ? `Plantilla ${plantilla.name}` : "Una plantilla de diploma";
      }
      case "app_settings":
        return "Configuración de la plataforma";
      case "jobs":
        return "Un trabajo del servidor";
      case "ai_proposal":
        return "Una propuesta del asistente";
      default:
        return id ?? "—";
    }
  }
}

// ─── Herramienta ─────────────────────────────────────────────────────────────

export const historial: AssistantTool = {
  name: "historial",
  description:
    "Historial de cambios: quién dio de baja, quién matriculó, quién importó, quién cambió el dueño de un curso… en un periodo, y si se quiere solo sobre un alumno, un curso, un certificado o una cuenta, o solo los de una persona.",
  parameters: schema({
    desde: str(
      'Inicio del periodo tal como lo dijo la persona: «hoy», «ayer», «esta semana», «semana pasada», «este mes», «últimos 7 días», «siempre» o una fecha «2026-09-01»'
    ),
    hasta: str('Fin del periodo, solo con fechas exactas («» = hoy o el final del periodo)'),
    sobre: strEnum(
      'Sobre qué mirar: «alumno», «curso», «certificado», «usuario» o «» para todo. Si lo usas, manda también `id`',
      [...SOBRE]
    ),
    id: str('Id del alumno, del curso o de la cuenta, o el folio del certificado, según `sobre` («» = todo)'),
    quien: str('Nombre o correo de quien hizo el cambio («» = cualquiera)'),
  }),
  roles: ["admin", "teacher"],
  risk: "read",
  run(params, ctx) {
    const range = dateRange(param(params, "desde"), param(params, "hasta"));
    const sobre = (SOBRE as readonly string[]).includes(param(params, "sobre"))
      ? (param(params, "sobre") as Sobre)
      : "";
    const id = param(params, "id");
    if (sobre && !id) {
      return { forModel: `Para mirar el historial de un ${sobre} necesito su id; búscalo con buscar_alumno o buscar_curso.` };
    }

    const conds: SQL[] = [gte(auditLog.createdAt, range.from), lte(auditLog.createdAt, range.to)];
    // El admin ve todo el registro; el maestro, lo suyo y lo que le toca
    if (ctx.user.role !== "admin") conds.push(delMaestro(ctx.user.id));
    const sujeto = sobre ? sujetoCondicion(sobre, id) : null;
    if (sujeto) conds.push(sujeto);

    const quien = param(params, "quien");
    let quienNombre = "";
    if (quien) {
      const coincide = matchesSearch(quien, [users.fullName, users.email]);
      const encontrados = coincide
        ? db.select({ id: users.id, name: users.fullName }).from(users).where(coincide).all()
        : [];
      if (encontrados.length === 0) {
        return { forModel: "No encontré a esa persona entre las cuentas de la plataforma; revisa el nombre o el correo." };
      }
      conds.push(inArray(auditLog.userId, encontrados.map((u) => u.id)));
      quienNombre = encontrados.length === 1 ? encontrados[0].name : `${encontrados.length} personas`;
    }

    const where = and(...conds)!;
    const total = db.select({ n: sql<number>`COUNT(*)` }).from(auditLog).where(where).get()?.n ?? 0;
    const filas: Fila[] = db
      .select({
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        detail: auditLog.detail,
        createdAt: auditLog.createdAt,
        quien: users.fullName,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(MAX_CSV_ROWS)
      .all();

    const sobres = sobreQueTextos(filas);
    const allRows = filas.map((f) => [
      fmtMoment(f.createdAt),
      f.quien ?? "La plataforma",
      queTexto(f.action, f.detail),
      sobres.get(`${f.entity}|${f.entityId ?? ""}`) ?? "—",
    ]);

    const donde = sobre ? ` sobre ese ${sobre}` : "";
    const deQuien = quienNombre ? ` de ${quienNombre}` : "";
    const ultimos = allRows
      .slice(0, 3)
      .map(([cuando, autor, que, sujetoTexto]) => `${autor} ${que} (${sujetoTexto}, ${cuando})`)
      .join("; ");
    const forModel =
      total === 0
        ? `Sin cambios registrados ${range.label}${donde}${deQuien}.`
        : `${total} cambio(s) ${range.label}${donde}${deQuien}. Lo último: ${ultimos}.`;

    const personas = new Set(filas.map((f) => f.quien ?? "La plataforma"));
    return resultBlocks(
      toResult({
        tiles: [tile("Cambios", total), tile("Personas", personas.size)],
        columns: ["Cuándo", "Quién", "Qué", "Sobre"],
        allRows,
        forModel,
      }),
      ctx,
      "historial"
    );
  },
};
