"use server";

import { sanitizeRichHtml, isHtmlContent } from "@/lib/rich-html";

/** HTML del editor → saneado; markdown legado se deja igual. */
function cleanRich(s: string): string {
  return isHtmlContent(s) ? sanitizeRichHtml(s) : s;
}

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import {
  getExam,
  listQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  duplicateQuestion,
  moveQuestion,
  updateExamSettings,
  imageQuestionFilesProblem,
  type QuestionInput,
} from "@/server/services/exams";
import { setExamResultsPublished } from "@/server/services/exam-results";
import { audit } from "@/server/services/audit";

// ─── Guard común: el ítem debe ser un examen de un curso del maestro ─────────

async function guardExamItem(
  courseId: string,
  itemId: string
): Promise<{ error: string } | null> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  const item = getItem(itemId);
  if (!item || item.courseId !== courseId || item.kind !== "exam" || !getExam(itemId)) {
    return { error: "No encontramos este examen" };
  }
  return null;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function revalidateExam(courseId: string, itemId: string) {
  revalidatePath(`/teach/courses/${courseId}/items/${itemId}/edit`);
  revalidatePath(`/teach/courses/${courseId}/content`);
}

// ─── Ajustes del examen ──────────────────────────────────────────────────────

export type ExamSettingsInput = {
  instructionsMd: string;
  /** Timestamps en ms (hora local convertida en el cliente); null = sin fecha */
  opensAtMs: number | null;
  closesAtMs: number | null;
  /** null = intentos ilimitados */
  maxAttempts: number | null;
  attemptScorePolicy: "best" | "last" | "average";
  /** null = sin límite de tiempo */
  timeLimitMinutes: number | null;
  /** % informativo; null = sin calificación mínima */
  passScore: number | null;
  shuffleQuestions: boolean;
  showResultsMode: "immediately" | "after_close" | "manual";
  /** Pool aleatorio: preguntas por intento; null = todas las del banco */
  drawCount: number | null;
};

export type UpdateExamSettingsResult = { ok: true } | { error: string };

export async function updateExamSettingsAction(
  courseId: string,
  itemId: string,
  input: ExamSettingsInput
): Promise<UpdateExamSettingsResult> {
  const guard = await guardExamItem(courseId, itemId);
  if (guard) return guard;

  if (
    input.maxAttempts !== null &&
    (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 100)
  ) {
    return { error: "Los intentos máximos deben ser un número entre 1 y 100" };
  }
  if (
    input.timeLimitMinutes !== null &&
    (!Number.isInteger(input.timeLimitMinutes) ||
      input.timeLimitMinutes < 1 ||
      input.timeLimitMinutes > 600)
  ) {
    return { error: "El tiempo límite debe estar entre 1 y 600 minutos" };
  }
  if (
    input.passScore !== null &&
    (!Number.isFinite(input.passScore) || input.passScore < 0 || input.passScore > 100)
  ) {
    return { error: "La calificación mínima debe estar entre 0 y 100" };
  }
  if (
    input.opensAtMs !== null &&
    input.closesAtMs !== null &&
    input.opensAtMs >= input.closesAtMs
  ) {
    return { error: "La fecha de cierre debe ser posterior a la de apertura" };
  }
  if (
    input.drawCount !== null &&
    (!Number.isInteger(input.drawCount) || input.drawCount < 1)
  ) {
    return { error: "Las preguntas por intento deben ser un número entero de 1 en adelante" };
  }

  // Pool aleatorio: N >= total del banco equivale a "todas" → se guarda null
  const bankSize = listQuestions(itemId).length;
  const drawCount =
    input.drawCount !== null && input.drawCount >= bankSize ? null : input.drawCount;

  try {
    updateExamSettings(itemId, {
      instructionsMd: cleanRich(input.instructionsMd),
      opensAt: input.opensAtMs === null ? null : new Date(input.opensAtMs),
      closesAt: input.closesAtMs === null ? null : new Date(input.closesAtMs),
      maxAttempts: input.maxAttempts,
      attemptScorePolicy: input.attemptScorePolicy,
      timeLimitMinutes: input.timeLimitMinutes,
      passScore: input.passScore,
      shuffleQuestions: input.shuffleQuestions,
      showResultsMode: input.showResultsMode,
      drawCount,
    });
    revalidateExam(courseId, itemId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudieron guardar los ajustes. Intenta de nuevo.") };
  }
}

// ─── Publicar resultados ─────────────────────────────────────────────────────

export type SetResultsPublishedResult = { ok: true; notified: number } | { error: string };

/** «Publicar resultados» / «Ocultar» (modos al cierre y cuando yo decida). */
export async function setExamResultsPublishedAction(
  courseId: string,
  itemId: string,
  published: boolean
): Promise<SetResultsPublishedResult> {
  const guard = await guardExamItem(courseId, itemId);
  if (guard) return guard;
  const user = await requireTeacher();

  try {
    const { notified } = setExamResultsPublished(itemId, published);
    audit(user.id, published ? "publish_exam_results" : "hide_exam_results", "exams", itemId, { notified });
    revalidateExam(courseId, itemId);
    revalidatePath(`/courses/${courseId}`);
    revalidatePath(`/courses/${courseId}/items/${itemId}`);
    return { ok: true, notified };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo actualizar la publicación. Intenta de nuevo.") };
  }
}

// ─── Preguntas ───────────────────────────────────────────────────────────────

export type QuestionFormInput = {
  type:
    | "single_choice"
    | "multiple_choice"
    | "true_false"
    | "short_text"
    | "matching"
    | "ordering"
    | "open_text"
    | "image_drag"
    | "image_click";
  promptMd: string;
  points: number;
  /** single/multiple/true_false */
  options?: { textMd: string; isCorrect: boolean }[];
  /** short_text: variantes aceptadas */
  accepted?: string[];
  /** matching: pares izquierda/derecha */
  pairs?: { left: string; right: string }[];
  /** ordering: pasos en el orden correcto */
  steps?: string[];
  /** image_drag/image_click: foto de fondo (archivo editor_image) */
  imageFileId?: string | null;
  /** image_drag/image_click: la config tal como la arma el editor */
  imageConfig?: unknown;
};

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asNumber = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/**
 * Config de una pregunta sobre imagen que llega del navegador: se copian solo
 * los campos conocidos, para no guardar lo que el cliente quiera meter. Que
 * los valores tengan sentido lo revisa la validación del servicio.
 */
function cleanImageConfig(type: "image_drag" | "image_click", raw: unknown) {
  const c = asObject(raw);
  const point = (v: unknown) => {
    const p = asObject(v);
    return { x: asNumber(p.x), y: asNumber(p.y) };
  };
  if (type === "image_click") {
    return { aspect: asNumber(c.aspect), precision: asString(c.precision), spots: asList(c.spots).map(point) };
  }
  return {
    aspect: asNumber(c.aspect),
    iconSize: asString(c.iconSize),
    elements: asList(c.elements).map((v) => {
      const e = asObject(v);
      return { id: asString(e.id), kind: asString(e.kind), fileId: asString(e.fileId), text: asString(e.text)?.trim() };
    }),
    zones: asList(c.zones).map((v) => ({ ...point(v), elementId: asString(asObject(v).elementId) })),
  };
}

/** Convierte el input del formulario al contrato del servicio (config por tipo). */
function toServiceInput(input: QuestionFormInput): QuestionInput | { error: string } {
  const base = {
    type: input.type,
    promptMd: input.promptMd,
    points: input.points,
  };
  switch (input.type) {
    case "image_drag":
    case "image_click":
      return {
        ...base,
        imageFileId: asString(input.imageFileId) || null,
        config: cleanImageConfig(input.type, input.imageConfig),
      };
    case "short_text": {
      const accepted = (input.accepted ?? []).map((a) => a.trim()).filter(Boolean);
      return { ...base, config: { accepted } };
    }
    case "matching": {
      // Ignorar pares totalmente vacíos; un par a medias es un error claro
      const pairs = (input.pairs ?? []).filter((p) => p.left.trim() || p.right.trim());
      if (pairs.some((p) => !p.left.trim() || !p.right.trim())) {
        return { error: "Completa ambos lados de cada par" };
      }
      return {
        ...base,
        config: { pairs: pairs.map((p) => ({ left: p.left.trim(), right: p.right.trim() })) },
      };
    }
    case "ordering": {
      // Los renglones vacíos se ignoran; la validación del servicio pide 3 a 10
      const steps = (input.steps ?? []).map((s) => s.trim()).filter(Boolean);
      return { ...base, config: { steps } };
    }
    case "open_text":
      return base;
    default: {
      const options = (input.options ?? []).filter((o) => o.textMd.trim());
      return { ...base, options };
    }
  }
}

function ownsQuestion(itemId: string, questionId: string): boolean {
  return listQuestions(itemId).some((q) => q.id === questionId);
}

/** Preguntas sobre imagen: la foto y los íconos deben ser imágenes que subió este usuario. */
function imageFilesError(
  user: { id: string; role: string },
  input: QuestionInput,
  questionId?: string
): { error: string } | null {
  if (input.type !== "image_drag" && input.type !== "image_click") return null;
  const problem = imageQuestionFilesProblem(user, input.imageFileId, input.config, questionId);
  return problem ? { error: problem } : null;
}

export type QuestionMutationResult = { ok: true; questionId?: string } | { error: string };

export async function createQuestionAction(
  courseId: string,
  itemId: string,
  input: QuestionFormInput
): Promise<QuestionMutationResult> {
  const guard = await guardExamItem(courseId, itemId);
  if (guard) return guard;

  const serviceInput = toServiceInput(input);
  if ("error" in serviceInput) return serviceInput;
  const filesError = imageFilesError(await requireTeacher(), serviceInput);
  if (filesError) return filesError;

  try {
    const questionId = createQuestion(itemId, serviceInput);
    revalidateExam(courseId, itemId);
    return { ok: true, questionId };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo crear la pregunta. Intenta de nuevo.") };
  }
}

export async function updateQuestionAction(
  courseId: string,
  itemId: string,
  questionId: string,
  input: QuestionFormInput
): Promise<QuestionMutationResult> {
  const guard = await guardExamItem(courseId, itemId);
  if (guard) return guard;
  if (!ownsQuestion(itemId, questionId)) return { error: "No encontramos esta pregunta" };

  const serviceInput = toServiceInput(input);
  if ("error" in serviceInput) return serviceInput;
  const filesError = imageFilesError(await requireTeacher(), serviceInput, questionId);
  if (filesError) return filesError;

  try {
    updateQuestion(questionId, serviceInput);
    revalidateExam(courseId, itemId);
    return { ok: true, questionId };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo guardar la pregunta. Intenta de nuevo.") };
  }
}

export async function deleteQuestionAction(
  courseId: string,
  itemId: string,
  questionId: string
): Promise<QuestionMutationResult> {
  const guard = await guardExamItem(courseId, itemId);
  if (guard) return guard;
  if (!ownsQuestion(itemId, questionId)) return { error: "No encontramos esta pregunta" };

  try {
    deleteQuestion(itemId, questionId);
    revalidateExam(courseId, itemId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo eliminar la pregunta. Intenta de nuevo.") };
  }
}

export async function duplicateQuestionAction(
  courseId: string,
  itemId: string,
  questionId: string
): Promise<QuestionMutationResult> {
  const guard = await guardExamItem(courseId, itemId);
  if (guard) return guard;
  if (!ownsQuestion(itemId, questionId)) return { error: "No encontramos esta pregunta" };

  try {
    const newId = duplicateQuestion(itemId, questionId);
    revalidateExam(courseId, itemId);
    return { ok: true, questionId: newId };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo duplicar la pregunta. Intenta de nuevo.") };
  }
}

export async function moveQuestionAction(
  courseId: string,
  itemId: string,
  questionId: string,
  direction: "up" | "down"
): Promise<QuestionMutationResult> {
  const guard = await guardExamItem(courseId, itemId);
  if (guard) return guard;
  if (!ownsQuestion(itemId, questionId)) return { error: "No encontramos esta pregunta" };

  try {
    moveQuestion(itemId, questionId, direction);
    revalidateExam(courseId, itemId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo mover la pregunta. Intenta de nuevo.") };
  }
}
