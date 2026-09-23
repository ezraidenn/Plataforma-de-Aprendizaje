import "server-only";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import { and, desc, eq, getTableColumns, isNotNull, or, sql } from "drizzle-orm";
import { nanoid, customAlphabet } from "nanoid";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import QRCode from "qrcode";
import { getDecorPreset } from "@/lib/certificate-decor";
import { db } from "@/server/db";
import { ownerCondition, type ViewScope } from "@/server/auth/view-scope";
import {
  certificates,
  certificateTemplates,
  enrollments,
  courses,
  users,
} from "@/server/db/schema";
import { getFileRecord, absolutePathFor } from "./storage";
import { audit } from "./audit";
import { appUrl } from "./app-url";
import { computeExpiry } from "@/lib/validity";
import { notify } from "./notifications";

export type CertificateTemplate = typeof certificateTemplates.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;

// ─── Plantillas ──────────────────────────────────────────────────────────────

export type TemplateFieldKey =
  | "student_name"
  | "course_title"
  | "date"
  | "score"
  | "folio"
  | "qr"
  | "teacher_name"
  | "validity"
  | "custom_text";

export type TemplateField = {
  key: TemplateFieldKey;
  /** Coordenadas en puntos PDF desde la esquina superior izquierda */
  x: number;
  y: number;
  /** qr: lado en puntos; texto: tamaño de fuente */
  fontSize: number;
  font: "helvetica" | "helvetica_bold" | "times" | "times_bold";
  color: string; // hex #RRGGBB
  align: "left" | "center" | "right";
  /** Solo custom_text */
  text?: string;
  /** Ancho máximo del cuadro de texto (para detectar desborde en el editor) */
  maxWidth?: number;
  /** false = el campo queda en la plantilla pero NO se imprime (default true) */
  enabled?: boolean;
};

export const PAGE_SIZES = {
  letter: { landscape: [792, 612], portrait: [612, 792] },
  a4: { landscape: [842, 595], portrait: [595, 842] },
} as const;

export function listTemplates(scope: ViewScope): CertificateTemplate[] {
  const base = db.select().from(certificateTemplates).orderBy(desc(certificateTemplates.updatedAt));
  const owner = ownerCondition(scope, certificateTemplates.ownerId);
  return owner ? base.where(owner).all() : base.all();
}

export function getTemplate(templateId: string): CertificateTemplate | null {
  return (
    db.select().from(certificateTemplates).where(eq(certificateTemplates.id, templateId)).get() ??
    null
  );
}

// ─── Plantillas generales ────────────────────────────────────────────────────
// Las plantillas cuyo dueño es un administrador son GENERALES: cualquier
// maestro puede asignarlas a su curso. Las de un maestro siguen siendo solo
// suyas. Editar o borrar sigue siendo del dueño o del admin (ownedTemplate).

/** Plantillas generales (dueño administrador), las más recientes primero. */
export function listGeneralTemplates(): CertificateTemplate[] {
  return db
    .select(getTableColumns(certificateTemplates))
    .from(certificateTemplates)
    .innerJoin(users, eq(users.id, certificateTemplates.ownerId))
    .where(eq(users.role, "admin"))
    .orderBy(desc(certificateTemplates.updatedAt))
    .all();
}

export type AssignableTemplate = {
  id: string;
  name: string;
  /** El dueño es un administrador */
  general: boolean;
  ownerName: string;
};

const assignableColumns = {
  id: certificateTemplates.id,
  name: certificateTemplates.name,
  ownerRole: users.role,
  ownerName: users.fullName,
};

function toAssignable(r: { id: string; name: string; ownerRole: string; ownerName: string }): AssignableTemplate {
  return { id: r.id, name: r.name, general: r.ownerRole === "admin", ownerName: r.ownerName };
}

/**
 * Plantillas que el usuario puede asignar a un curso (selector de Ajustes).
 * Admin: todas. Maestro: las suyas y las generales. Generales primero, luego
 * por nombre.
 */
export function listAssignableTemplates(user: { id: string; role: string }): AssignableTemplate[] {
  const base = db
    .select(assignableColumns)
    .from(certificateTemplates)
    .innerJoin(users, eq(users.id, certificateTemplates.ownerId));
  const rows =
    user.role === "admin"
      ? base.all()
      : base.where(or(eq(certificateTemplates.ownerId, user.id), eq(users.role, "admin"))).all();
  return rows
    .map(toAssignable)
    .sort((x, y) => Number(y.general) - Number(x.general) || x.name.localeCompare(y.name, "es"));
}

/** Datos de una plantilla para el selector, sin revisar permisos (null = no existe). */
export function assignableTemplateInfo(templateId: string): AssignableTemplate | null {
  const row = db
    .select(assignableColumns)
    .from(certificateTemplates)
    .innerJoin(users, eq(users.id, certificateTemplates.ownerId))
    .where(eq(certificateTemplates.id, templateId))
    .get();
  return row ? toAssignable(row) : null;
}

/** ¿Puede el usuario asignar esta plantilla a un curso? Admin: cualquiera; maestro: suya o general. */
export function canAssignTemplate(user: { id: string; role: string }, templateId: string): boolean {
  const row = db
    .select({ ownerId: certificateTemplates.ownerId, ownerRole: users.role })
    .from(certificateTemplates)
    .innerJoin(users, eq(users.id, certificateTemplates.ownerId))
    .where(eq(certificateTemplates.id, templateId))
    .get();
  if (!row) return false;
  return user.role === "admin" || row.ownerId === user.id || row.ownerRole === "admin";
}

/** plantilla → cuántos cursos la usan (solo las que usa al menos uno). */
export function templateUsage(): Map<string, number> {
  return new Map(
    db
      .select({ templateId: courses.certificateTemplateId, n: sql<number>`COUNT(*)` })
      .from(courses)
      .where(isNotNull(courses.certificateTemplateId))
      .groupBy(courses.certificateTemplateId)
      .all()
      .map((r) => [r.templateId as string, r.n] as const)
  );
}

export function createTemplate(
  ownerId: string,
  name: string,
  decor: string | null = "academico"
): CertificateTemplate {
  const id = nanoid();
  // Defaults con la paleta de impresión azul noche y el layout de diploma completo; editar la
  // plantilla no afecta certificados emitidos. Todos los campos son
  // desactivables (enabled: false = no se imprime).
  const defaults: TemplateField[] = [
    { key: "custom_text", x: 396, y: 130, fontSize: 15, font: "helvetica", color: "#475569", align: "center", text: "Se otorga la presente constancia a", enabled: true },
    { key: "student_name", x: 396, y: 220, fontSize: 34, font: "times_bold", color: "#1e1b4b", align: "center", maxWidth: 580, enabled: true },
    { key: "custom_text", x: 396, y: 285, fontSize: 14, font: "helvetica", color: "#475569", align: "center", text: "por haber concluido satisfactoriamente el curso", enabled: true },
    { key: "course_title", x: 396, y: 320, fontSize: 22, font: "helvetica_bold", color: "#312e81", align: "center", maxWidth: 580, enabled: true },
    { key: "date", x: 396, y: 380, fontSize: 13, font: "helvetica", color: "#475569", align: "center", enabled: true },
    { key: "teacher_name", x: 396, y: 480, fontSize: 14, font: "times_bold", color: "#1e1b4b", align: "center", maxWidth: 400, enabled: true },
    { key: "custom_text", x: 396, y: 500, fontSize: 10, font: "helvetica", color: "#475569", align: "center", text: "Instructor del curso", enabled: true },
    { key: "folio", x: 396, y: 560, fontSize: 10, font: "helvetica", color: "#475569", align: "center", enabled: true },
    { key: "qr", x: 660, y: 460, fontSize: 84, font: "helvetica", color: "#000000", align: "left", enabled: true },
  ];
  db.insert(certificateTemplates).values({ id, ownerId, name, fields: defaults, decor }).run();
  return getTemplate(id)!;
}

export function updateTemplate(
  templateId: string,
  patch: Partial<
    Pick<
      CertificateTemplate,
      "name" | "backgroundFileId" | "fields" | "pageSize" | "orientation" | "decor"
    >
  >
) {
  db.update(certificateTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(certificateTemplates.id, templateId))
    .run();
}

export function deleteTemplate(templateId: string) {
  // Los cursos que la usaban quedan sin certificado (fila por fila, sin FK dura)
  db.update(courses)
    .set({ certificateTemplateId: null })
    .where(eq(courses.certificateTemplateId, templateId))
    .run();
  db.delete(certificateTemplates).where(eq(certificateTemplates.id, templateId)).run();
}

// ─── Folio y verificación ────────────────────────────────────────────────────

const folioSuffix = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 4);

function nextFolio(): string {
  const year = new Date().getFullYear();
  // El mayor consecutivo emitido + 1. No COUNT(*): al borrar un certificado
  // (p. ej. con su curso) el número se repetiría. «CERT-AAAA-» ocupa 10 caracteres.
  const last =
    db
      .select({
        n: sql<number | null>`MAX(CAST(substr(${certificates.folio}, 11, instr(substr(${certificates.folio}, 11), '-') - 1) AS INTEGER))`,
      })
      .from(certificates)
      .get()?.n ?? 0;
  const seq = String(last + 1).padStart(6, "0");
  return `CERT-${year}-${seq}-${folioSuffix()}`;
}

export function verificationHash(folio: string, studentId: string, courseId: string, issuedAtMs: number): string {
  const secret = process.env.APP_SECRET ?? "dev-secret";
  return createHmac("sha256", secret)
    .update(`${folio}|${studentId}|${courseId}|${issuedAtMs}`)
    .digest("hex");
}

/**
 * Resultado público de /verify/[folio] (destino del QR impreso).
 *
 * La validez depende del ESTADO del certificado en la base: que exista el
 * folio (si no, `not_found`), que no esté revocado (`revoked`) y, aparte, si ya
 * venció (`expired`/`expiresAt`: un vencido sigue siendo auténtico). NO depende
 * del secreto del servidor: `verification_hash` se guarda al emitir como campo
 * de integridad, pero ya no decide la validez. Antes, si el APP_SECRET del
 * .env cambiaba (reinstalación) o el certificado se firmó con otro (scripts
 * sin .env), el QR impreso decía «no encontrado» siendo auténtico.
 * Alumno, curso y maestro salen congelados de `template_snapshot`.
 */
export function verifyCertificate(folio: string) {
  const cert = db.select().from(certificates).where(eq(certificates.folio, folio.trim().toUpperCase())).get();
  if (!cert) return { status: "not_found" as const };

  const student = db.select().from(users).where(eq(users.id, cert.studentId)).get();
  const course = db.select().from(courses).where(eq(courses.id, cert.courseId)).get();
  const teacher = course
    ? db.select().from(users).where(eq(users.id, course.ownerId)).get()
    : null;

  const snap = cert.templateSnapshot as
    | { teacherName?: string; studentName?: string; courseTitle?: string }
    | null;

  return {
    status: cert.revoked ? ("revoked" as const) : ("valid" as const),
    folio: cert.folio,
    studentName: snap?.studentName || student?.fullName || "—",
    courseTitle: snap?.courseTitle || course?.title || "—",
    teacherName: snap?.teacherName || teacher?.fullName || "—",
    issuedAt: cert.issuedAt,
    revokedAt: cert.revokedAt,
    // Un certificado vencido es auténtico: acredita lo que acreditó en su periodo
    expiresAt: cert.expiresAt,
    expired: cert.expiresAt !== null && cert.expiresAt.getTime() < Date.now(),
  };
}

/**
 * Graba en los certificados emitidos antes de que se congelaran el maestro, el
 * alumno y el curso los valores que muestran hoy (dueño del curso, alumno y
 * título actuales). Idempotente: cada campo solo se toca si falta. Devuelve la
 * suma de campos actualizados.
 */
export function backfillCertificateSnapshots(): number {
  const teacher = db.run(sql`
    UPDATE certificates
    SET template_snapshot = json_set(
      template_snapshot,
      '$.teacherName',
      (SELECT u.full_name FROM courses c JOIN users u ON u.id = c.owner_id WHERE c.id = certificates.course_id)
    )
    WHERE template_snapshot IS NOT NULL
      AND json_type(template_snapshot) = 'object'
      AND json_extract(template_snapshot, '$.teacherName') IS NULL
      AND (SELECT u.full_name FROM courses c JOIN users u ON u.id = c.owner_id
            WHERE c.id = certificates.course_id) IS NOT NULL
  `);
  const student = db.run(sql`
    UPDATE certificates
    SET template_snapshot = json_set(
      template_snapshot,
      '$.studentName',
      (SELECT u.full_name FROM users u WHERE u.id = certificates.student_id)
    )
    WHERE template_snapshot IS NOT NULL
      AND json_type(template_snapshot) = 'object'
      AND json_extract(template_snapshot, '$.studentName') IS NULL
      AND (SELECT u.full_name FROM users u WHERE u.id = certificates.student_id) IS NOT NULL
  `);
  const course = db.run(sql`
    UPDATE certificates
    SET template_snapshot = json_set(
      template_snapshot,
      '$.courseTitle',
      (SELECT c.title FROM courses c WHERE c.id = certificates.course_id)
    )
    WHERE template_snapshot IS NOT NULL
      AND json_type(template_snapshot) = 'object'
      AND json_extract(template_snapshot, '$.courseTitle') IS NULL
      AND (SELECT c.title FROM courses c WHERE c.id = certificates.course_id) IS NOT NULL
  `);
  return teacher.changes + student.changes + course.changes;
}

export function revokeCertificate(certificateId: string, reason: string) {
  db.update(certificates)
    .set({ revoked: true, revokedReason: reason, revokedAt: new Date() })
    .where(eq(certificates.id, certificateId))
    .run();
}

export function listStudentCertificates(studentId: string) {
  return db
    .select({
      cert: certificates,
      courseTitle: courses.title,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(and(eq(certificates.studentId, studentId), eq(certificates.revoked, false)))
    .orderBy(desc(certificates.issuedAt))
    .all();
}

/** Cursos con certificados vigentes (para el selector del ZIP): sin tope. */
export function listCertificateCourses(scope: ViewScope): { courseId: string; courseTitle: string }[] {
  return db
    .selectDistinct({ courseId: certificates.courseId, courseTitle: courses.title })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(and(eq(certificates.revoked, false), ownerCondition(scope, courses.ownerId)))
    .orderBy(courses.title)
    .all();
}

export function listTeacherCertificates(scope: ViewScope, limit = 100) {
  const base = db
    .select({
      cert: certificates,
      courseTitle: courses.title,
      studentName: users.fullName,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .innerJoin(users, eq(certificates.studentId, users.id))
    .orderBy(desc(certificates.issuedAt))
    .limit(limit);
  const owner = ownerCondition(scope, courses.ownerId);
  return owner ? base.where(owner).all() : base.all();
}

// ─── Render del PDF ──────────────────────────────────────────────────────────

const FONT_MAP = {
  helvetica: StandardFonts.Helvetica,
  helvetica_bold: StandardFonts.HelveticaBold,
  times: StandardFonts.TimesRoman,
  times_bold: StandardFonts.TimesRomanBold,
} as const;

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export type CertificateData = {
  studentName: string;
  courseTitle: string;
  date: string;
  score: string;
  folio: string;
  teacherName: string;
  verifyUrl: string;
  /** «Vigente hasta 31 de diciembre de 2026»; vacío en certificados vitalicios */
  validity?: string;
};

/** Dibuja los adornos del preset (misma fuente de datos que el editor: fiel). */
function drawDecor(page: import("pdf-lib").PDFPage, decorId: string | null, pageW: number, pageH: number) {
  const preset = getDecorPreset(decorId);
  if (!preset) return;
  for (const el of preset.elements) {
    const opacity = el.opacity ?? 1;
    if (el.type === "rect") {
      page.drawRectangle({
        x: el.x * pageW,
        y: pageH - (el.y + el.h) * pageH,
        width: el.w * pageW,
        height: el.h * pageH,
        color: el.fill ? hexToRgb(el.fill) : undefined,
        borderColor: el.stroke ? hexToRgb(el.stroke) : undefined,
        borderWidth: el.strokeWidth,
        opacity: el.fill ? opacity : undefined,
        borderOpacity: el.stroke ? opacity : undefined,
      });
    } else if (el.type === "line") {
      page.drawLine({
        start: { x: el.x1 * pageW, y: pageH - el.y1 * pageH },
        end: { x: el.x2 * pageW, y: pageH - el.y2 * pageH },
        color: hexToRgb(el.color),
        thickness: el.width,
        opacity,
      });
    } else if (el.type === "circle") {
      page.drawCircle({
        x: el.cx * pageW,
        y: pageH - el.cy * pageH,
        size: el.r * pageW,
        color: el.fill ? hexToRgb(el.fill) : undefined,
        borderColor: el.stroke ? hexToRgb(el.stroke) : undefined,
        borderWidth: el.strokeWidth,
        opacity: el.fill ? opacity : undefined,
        borderOpacity: el.stroke ? opacity : undefined,
      });
    } else if (el.type === "path") {
      // drawSvgPath: origen en (x, y desde abajo), el path crece hacia abajo
      page.drawSvgPath(el.d, {
        x: el.x * pageW,
        y: pageH - el.y * pageH,
        scale: el.scale * pageW * 0.01, // path definido en caja de 100 unidades
        borderColor: hexToRgb(el.color),
        borderWidth: el.width,
        borderOpacity: opacity,
      });
    }
  }
}

/**
 * Renderiza el PDF del certificado: fondo (PDF/PNG/JPG) + adornos del preset
 * + campos estampados (solo los habilitados). Coordenadas de plantilla:
 * puntos desde la esquina SUPERIOR izquierda (como las ve el editor);
 * pdf-lib mide desde abajo → se convierten aquí.
 */
export async function renderCertificatePdf(
  template: Pick<
    CertificateTemplate,
    "backgroundFileId" | "fields" | "pageSize" | "orientation"
  > & { decor?: string | null },
  data: CertificateData
): Promise<Uint8Array> {
  const [pageW, pageH] = PAGE_SIZES[template.pageSize][template.orientation];
  const doc = await PDFDocument.create();
  const page = doc.addPage([pageW, pageH]);

  // Fondo
  if (template.backgroundFileId) {
    const record = getFileRecord(template.backgroundFileId);
    if (record) {
      const bytes = await fs.readFile(absolutePathFor(record.storedPath));
      const name = record.originalName.toLowerCase();
      if (name.endsWith(".pdf")) {
        const [embedded] = await doc.embedPdf(bytes, [0]);
        page.drawPage(embedded, { x: 0, y: 0, width: pageW, height: pageH });
      } else if (name.endsWith(".png")) {
        const img = await doc.embedPng(bytes);
        page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } else if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
        const img = await doc.embedJpg(bytes);
        page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      }
    }
  }

  // Adornos del preset SOBRE el fondo, DEBAJO de los campos
  drawDecor(page, template.decor ?? null, pageW, pageH);

  const fields = (template.fields as TemplateField[] | null) ?? [];
  for (const field of fields) {
    if (field.enabled === false) continue; // desactivado: no se imprime
    if (field.key === "qr") {
      const side = Math.max(40, field.fontSize);
      const png = await QRCode.toBuffer(data.verifyUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: Math.round(side * 4),
      });
      const img = await doc.embedPng(png);
      page.drawImage(img, {
        x: field.x,
        y: pageH - field.y - side,
        width: side,
        height: side,
      });
      continue;
    }

    const value =
      field.key === "student_name" ? data.studentName
      : field.key === "course_title" ? data.courseTitle
      : field.key === "date" ? data.date
      : field.key === "score" ? data.score
      : field.key === "folio" ? `Folio: ${data.folio}`
      : field.key === "teacher_name" ? data.teacherName
      : field.key === "validity" ? (data.validity ?? "")
      : (field.text ?? "");
    if (!value) continue;

    const font = await doc.embedFont(FONT_MAP[field.font] ?? StandardFonts.Helvetica);
    let size = field.fontSize;
    let width = font.widthOfTextAtSize(value, size);
    // Nombres larguísimos: reducir la fuente hasta caber en maxWidth (falla clásica)
    if (field.maxWidth) {
      while (width > field.maxWidth && size > 8) {
        size -= 1;
        width = font.widthOfTextAtSize(value, size);
      }
    }

    const x =
      field.align === "center" ? field.x - width / 2
      : field.align === "right" ? field.x - width
      : field.x;

    // El editor ancla el TOP del glifo en field.y; pdf-lib dibuja desde la
    // baseline. Usar el ascent real (no el tamaño completo) alinea el PDF
    // con la vista previa (con `size` el texto salía ~3 mm más abajo).
    const ascent = font.heightAtSize(size, { descender: false });
    page.drawText(value, {
      x,
      y: pageH - field.y - ascent,
      size,
      font,
      color: hexToRgb(field.color),
      rotate: degrees(0),
    });
  }

  return doc.save();
}

// ─── Emisión ─────────────────────────────────────────────────────────────────

const DATE_FMT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });

/**
 * Emite el certificado de una matrícula aprobada. Idempotente: si ya existe
 * uno no revocado para el enrollment, lo devuelve sin crear otro.
 */
export async function issueCertificate(enrollmentId: string): Promise<Certificate | null> {
  const enrollment = db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get();
  if (!enrollment || enrollment.status !== "completed") return null;

  const existing = db
    .select()
    .from(certificates)
    .where(and(eq(certificates.enrollmentId, enrollmentId), eq(certificates.revoked, false)))
    .get();
  if (existing) return existing;

  const course = db.select().from(courses).where(eq(courses.id, enrollment.courseId)).get();
  if (!course?.certificateTemplateId) return null;
  const template = getTemplate(course.certificateTemplateId);
  if (!template) return null;

  const student = db.select().from(users).where(eq(users.id, enrollment.studentId)).get();
  if (!student) return null;

  // El alumno, el curso y el maestro quedan fijos en el certificado (diploma
  // y /verify) aunque después se corrija el nombre, se renombre el curso o
  // se reasigne
  const teacher = db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, course.ownerId))
    .get();

  const folio = nextFolio();
  const issuedAt = new Date();

  // El PDF NO se guarda en disco: se genera al descargar desde
  // `templateSnapshot` (22 ms). Así el NAS no acumula miles de archivos de 9 KB
  // y el respaldo se mantiene ligero. Ver renderCertificateFor().
  const id = nanoid();
  db.insert(certificates)
    .values({
      id,
      folio,
      enrollmentId,
      studentId: enrollment.studentId,
      courseId: course.id,
      issuedAt,
      templateSnapshot: {
        backgroundFileId: template.backgroundFileId,
        fields: template.fields,
        pageSize: template.pageSize,
        orientation: template.orientation,
        decor: template.decor,
        teacherName: teacher?.fullName ?? "",
        studentName: student.fullName,
        courseTitle: course.title,
      },
      pdfFileId: null,
      // Vigencia congelada al emitir: cambiar la política del curso después no
      // altera lo ya emitido (igual que template_snapshot)
      expiresAt: computeExpiry(course.validityMode, course.validityMonths, issuedAt),
      verificationHash: verificationHash(folio, enrollment.studentId, course.id, issuedAt.getTime()),
    })
    .run();

  notify(enrollment.studentId, "certificate_issued", {
    certificateId: id,
    folio,
    courseId: course.id,
    courseTitle: course.title,
  });

  // El certificado es el documento que la empresa enseña a una auditoría: su
  // emisión tiene que dejar rastro. La emite el sistema al completarse el
  // curso, así que no hay un usuario detrás (userId = null).
  audit(null, "issue_certificate", "certificates", id, {
    folio,
    courseId: course.id,
    courseTitle: course.title,
    studentId: enrollment.studentId,
    studentName: student.fullName,
  });

  return db.select().from(certificates).where(eq(certificates.id, id)).get()!;
}


/**
 * Genera el PDF de un certificado ya emitido, a partir de la copia de la
 * plantilla congelada al emitirlo (`template_snapshot`). Fiel al original:
 * editar la plantilla después no altera los certificados históricos.
 */
export async function renderCertificateFor(
  cert: Certificate
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const snapshot = cert.templateSnapshot as
    | (Pick<CertificateTemplate, "backgroundFileId" | "fields" | "pageSize" | "orientation"> & {
        decor?: string | null;
        teacherName?: string;
        studentName?: string;
        courseTitle?: string;
      })
    | null;
  if (!snapshot) return null;

  const course = db.select().from(courses).where(eq(courses.id, cert.courseId)).get();
  const student = db.select().from(users).where(eq(users.id, cert.studentId)).get();
  if (!course || !student) return null;
  const teacher = db.select().from(users).where(eq(users.id, course.ownerId)).get();
  const base = await appUrl();

  const studentName = snapshot.studentName || student.fullName;
  const courseTitle = snapshot.courseTitle || course.title;

  const bytes = await renderCertificatePdf(snapshot, {
    studentName,
    courseTitle,
    date: DATE_FMT.format(cert.issuedAt),
    score: "",
    folio: cert.folio,
    teacherName: snapshot.teacherName || teacher?.fullName || "",
    verifyUrl: `${base}/verify/${cert.folio}`,
    validity: cert.expiresAt ? `Vigente hasta el ${DATE_FMT.format(cert.expiresAt)}` : "",
  });

  return { bytes, fileName: `${cert.folio} — ${studentName}.pdf` };
}

/** Igual que el anterior, buscando por folio. */
export async function renderCertificateByFolio(folio: string) {
  const cert = db.select().from(certificates).where(eq(certificates.folio, folio)).get();
  if (!cert) return null;
  return renderCertificateFor(cert);
}
