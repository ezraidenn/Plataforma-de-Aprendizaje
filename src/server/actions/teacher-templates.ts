"use server";

import { revalidatePath } from "next/cache";
import { getDecorPreset } from "@/lib/certificate-decor";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { certificates, courses, users } from "@/server/db/schema";
import { requireTeacher } from "@/server/auth/guards";
import { appUrl } from "@/server/services/app-url";
import type { SessionUser } from "@/server/auth/sessions";
import { getOwnedCourse } from "@/server/services/courses";
import { getFileRecord } from "@/server/services/storage";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { actingOwnerId } from "@/server/auth/view-scope";
import { audit } from "@/server/services/audit";
import {
  canAssignTemplate,
  createTemplate,
  deleteTemplate,
  getTemplate,
  renderCertificatePdf,
  revokeCertificate,
  updateTemplate,
  type CertificateTemplate,
  type TemplateField,
  type TemplateFieldKey,
} from "@/server/services/certificates";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** La plantilla debe existir y pertenecer al maestro (el admin toca todas). */
function ownedTemplate(templateId: string, user: SessionUser): CertificateTemplate | null {
  const template = getTemplate(templateId);
  if (!template) return null;
  if (user.role !== "admin" && template.ownerId !== user.id) return null;
  return template;
}

// ─── Crear ───────────────────────────────────────────────────────────────────

export type CreateTemplateResult = { ok: true; templateId: string } | { error: string };

export async function createTemplateAction(name: string): Promise<CreateTemplateResult> {
  const user = await requireTeacher();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Escribe un nombre para la plantilla" };
  if (trimmed.length > 120) return { error: "El nombre es demasiado largo (máximo 120 caracteres)" };

  try {
    const ownerId = actingOwnerId(await getViewScope(user), user);
    const template = createTemplate(ownerId, trimmed);
    if (ownerId !== user.id) {
      audit(user.id, "create_template", "certificate_templates", template.id, { onBehalfOf: ownerId });
    }
    revalidatePath("/teach/templates");
    return { ok: true, templateId: template.id };
  } catch {
    return { error: "No se pudo crear la plantilla. Intenta de nuevo." };
  }
}

// ─── Actualizar ──────────────────────────────────────────────────────────────

const FIELD_KEYS: TemplateFieldKey[] = [
  "student_name",
  "course_title",
  "date",
  "score",
  "folio",
  "qr",
  "teacher_name",
  "validity",
  "custom_text",
];
const FONTS = ["helvetica", "helvetica_bold", "times", "times_bold"] as const;
const ALIGNS = ["left", "center", "right"] as const;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Valida y normaliza los campos recibidos del editor; null = payload inválido. */
function sanitizeFields(raw: unknown): TemplateField[] | null {
  if (!Array.isArray(raw) || raw.length > 40) return null;
  const out: TemplateField[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const f = item as Record<string, unknown>;
    if (!FIELD_KEYS.includes(f.key as TemplateFieldKey)) return null;
    if (typeof f.x !== "number" || typeof f.y !== "number" || typeof f.fontSize !== "number") {
      return null;
    }
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.fontSize)) {
      return null;
    }
    const field: TemplateField = {
      key: f.key as TemplateFieldKey,
      x: Math.round(clamp(f.x, -1000, 2000)),
      y: Math.round(clamp(f.y, -1000, 2000)),
      fontSize: Math.round(clamp(f.fontSize, 4, 400)),
      font: FONTS.includes(f.font as (typeof FONTS)[number])
        ? (f.font as TemplateField["font"])
        : "helvetica",
      color:
        typeof f.color === "string" && /^#[0-9a-fA-F]{6}$/.test(f.color)
          ? f.color.toLowerCase()
          : "#164e63",
      align: ALIGNS.includes(f.align as (typeof ALIGNS)[number])
        ? (f.align as TemplateField["align"])
        : "left",
    };
    if (typeof f.text === "string") field.text = f.text.slice(0, 500);
    if (typeof f.maxWidth === "number" && Number.isFinite(f.maxWidth)) {
      field.maxWidth = Math.round(clamp(f.maxWidth, 20, 2000));
    }
    // Campo desactivado: se conserva en la plantilla pero no se imprime
    if (f.enabled === false) field.enabled = false;
    out.push(field);
  }
  return out;
}

export type UpdateTemplateInput = {
  name?: string;
  backgroundFileId?: string;
  fields?: unknown;
  pageSize?: "letter" | "a4";
  orientation?: "landscape" | "portrait";
  /** id de preset de adornos (lib/certificate-decor) o null = sin adornos */
  decor?: string | null;
};

export type UpdateTemplateResult = { ok: true } | { error: string };

export async function updateTemplateAction(
  templateId: string,
  patch: UpdateTemplateInput
): Promise<UpdateTemplateResult> {
  const user = await requireTeacher();
  const template = ownedTemplate(templateId, user);
  if (!template) return { error: "No encontramos esta plantilla o no te pertenece" };

  const update: Parameters<typeof updateTemplate>[1] = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: "El nombre no puede quedar vacío" };
    if (name.length > 120) return { error: "El nombre es demasiado largo (máximo 120 caracteres)" };
    update.name = name;
  }

  if (patch.backgroundFileId !== undefined) {
    const record = getFileRecord(patch.backgroundFileId);
    if (!record || record.kind !== "template_bg") {
      return { error: "El archivo de fondo no es válido" };
    }
    if (user.role !== "admin" && record.uploadedBy !== user.id) {
      return { error: "El archivo de fondo no es válido" };
    }
    update.backgroundFileId = patch.backgroundFileId;
  }

  if (patch.fields !== undefined) {
    const fields = sanitizeFields(patch.fields);
    if (fields === null) return { error: "Los campos de la plantilla no son válidos" };
    update.fields = fields;
  }

  if (patch.pageSize !== undefined) {
    if (patch.pageSize !== "letter" && patch.pageSize !== "a4") {
      return { error: "Tamaño de página no válido" };
    }
    update.pageSize = patch.pageSize;
  }

  if (patch.orientation !== undefined) {
    if (patch.orientation !== "landscape" && patch.orientation !== "portrait") {
      return { error: "Orientación no válida" };
    }
    update.orientation = patch.orientation;
  }

  if (patch.decor !== undefined) {
    if (patch.decor !== null && !getDecorPreset(patch.decor)) {
      return { error: "El estilo de adornos no es válido" };
    }
    update.decor = patch.decor;
  }

  try {
    updateTemplate(templateId, update);
    revalidatePath("/teach/templates");
    revalidatePath(`/teach/templates/${templateId}`);
    return { ok: true };
  } catch {
    return { error: "No se pudieron guardar los cambios. Intenta de nuevo." };
  }
}

// ─── Eliminar ────────────────────────────────────────────────────────────────

export type DeleteTemplateResult = { ok: true } | { error: string };

export async function deleteTemplateAction(templateId: string): Promise<DeleteTemplateResult> {
  const user = await requireTeacher();
  const template = ownedTemplate(templateId, user);
  if (!template) return { error: "No encontramos esta plantilla o no te pertenece" };

  try {
    deleteTemplate(templateId);
    revalidatePath("/teach/templates");
    return { ok: true };
  } catch {
    return { error: "No se pudo eliminar la plantilla. Intenta de nuevo." };
  }
}

// ─── PDF de prueba ───────────────────────────────────────────────────────────

export type RenderTestPdfResult = { ok: true; base64: string } | { error: string };

const TEST_DATE_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Renderiza el PDF con el pipeline real (pdf-lib): lo que ves es lo que se emite. */
export async function renderTestPdfAction(
  templateId: string,
  sampleStudentName: string
): Promise<RenderTestPdfResult> {
  const user = await requireTeacher();
  const template = ownedTemplate(templateId, user);
  if (!template) return { error: "No encontramos esta plantilla o no te pertenece" };

  const base = await appUrl();
  const folio = "CERT-0000-000000-DEMO";

  // El PDF de prueba muestra el nombre del dueño de la plantilla como ejemplo
  // de maestro; en los certificados reales el maestro es el dueño de CADA
  // curso que use la plantilla (no necesariamente el dueño de la plantilla)
  const owner = db.select({ fullName: users.fullName }).from(users).where(eq(users.id, template.ownerId)).get();

  try {
    const bytes = await renderCertificatePdf(template, {
      studentName: sampleStudentName.trim() || "Laura Pérez Domínguez",
      courseTitle: "Seguridad Industrial (ejemplo)",
      date: TEST_DATE_FMT.format(new Date()),
      score: "95",
      teacherName: owner?.fullName ?? user.fullName,
      folio,
      verifyUrl: `${base}/verify/${folio}`,
      validity: `Vigente hasta el ${TEST_DATE_FMT.format(new Date(new Date().getFullYear(), 11, 31))}`,
    });
    return { ok: true, base64: Buffer.from(bytes).toString("base64") };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo generar el PDF de prueba. Intenta de nuevo.") };
  }
}

// ─── Revocar certificados ────────────────────────────────────────────────────

export type RevokeCertificateResult = { ok: true } | { error: string };

export async function revokeCertificateAction(
  certificateId: string,
  reason: string
): Promise<RevokeCertificateResult> {
  const user = await requireTeacher();

  const cert = db.select().from(certificates).where(eq(certificates.id, certificateId)).get();
  if (!cert) return { error: "No encontramos este certificado" };
  const course = getOwnedCourse(cert.courseId, user);
  if (!course) return { error: "No encontramos este certificado o no te pertenece" };
  if (cert.revoked) return { error: "Este certificado ya estaba revocado" };

  const trimmed = reason.trim();
  if (!trimmed) return { error: "Escribe el motivo de la revocación" };

  try {
    revokeCertificate(certificateId, trimmed);
    revalidatePath("/teach/templates");
    revalidatePath("/teach/dashboard");
    return { ok: true };
  } catch {
    return { error: "No se pudo revocar el certificado. Intenta de nuevo." };
  }
}

// ─── Plantilla asignada a un curso ───────────────────────────────────────────

export type SetCourseTemplateResult = { ok: true } | { error: string };

export async function setCourseCertificateTemplateAction(
  courseId: string,
  templateId: string | null
): Promise<SetCourseTemplateResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  // Maestro: una plantilla suya o una general (del admin); el admin, cualquiera
  if (templateId !== null && !canAssignTemplate(user, templateId)) {
    return { error: "No encontramos esta plantilla o no te pertenece" };
  }

  try {
    db.update(courses)
      .set({ certificateTemplateId: templateId, updatedAt: new Date() })
      .where(eq(courses.id, courseId))
      .run();
    revalidatePath(`/teach/courses/${courseId}`, "layout");
    return { ok: true };
  } catch {
    return { error: "No se pudo guardar el cambio. Intenta de nuevo." };
  }
}
