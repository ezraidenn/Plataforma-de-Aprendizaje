"use server";

import { sanitizeRichHtml, isHtmlContent } from "@/lib/rich-html";

/** HTML del editor → saneado; markdown legado se deja igual. */
function cleanRich(s: string): string {
  return isHtmlContent(s) ? sanitizeRichHtml(s) : s;
}

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { itemDocuments, itemTexts } from "@/server/db/schema";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import {
  createItem,
  moveItem,
  deleteItem,
  updateItem,
  getItem,
  type ItemKind,
} from "@/server/services/tree";
import { attachDocumentFile } from "@/server/services/documents";

/** Todos los tipos de lección (la tarea se habilitó en Fase 3). */
const ALLOWED_KINDS: ItemKind[] = ["folder", "document", "text", "video", "exam", "assignment", "resource", "link"];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function revalidateContent(courseId: string) {
  revalidatePath(`/teach/courses/${courseId}`, "layout");
  revalidatePath("/teach/courses");
}

export type CreateItemResult = { ok: true; itemId: string } | { error: string };

export async function createItemAction(input: {
  courseId: string;
  parentId: string | null;
  kind: ItemKind;
  title: string;
}): Promise<CreateItemResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(input.courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  if (!ALLOWED_KINDS.includes(input.kind)) {
    return { error: "Este tipo de lección estará disponible en una fase posterior" };
  }
  const title = input.title?.trim();
  if (!title) return { error: "Escribe un título" };

  try {
    const item = createItem({
      courseId: input.courseId,
      parentId: input.parentId,
      kind: input.kind,
      title,
    });
    revalidateContent(input.courseId);
    return { ok: true, itemId: item.id };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo agregar el elemento. Intenta de nuevo.") };
  }
}

export type MoveItemResult = { ok: true } | { error: string };

export async function moveItemAction(input: {
  courseId: string;
  itemId: string;
  newParentId: string | null;
  newIndex: number;
}): Promise<MoveItemResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(input.courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  try {
    moveItem(input);
    revalidateContent(input.courseId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo mover el elemento. Intenta de nuevo.") };
  }
}

export type DeleteItemResult = { ok: true } | { error: string };

export async function deleteItemAction(
  courseId: string,
  itemId: string
): Promise<DeleteItemResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  try {
    deleteItem(courseId, itemId);
    revalidateContent(courseId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo eliminar el elemento. Intenta de nuevo.") };
  }
}

export type UpdateItemResult = { ok: true } | { error: string };

export async function updateItemAction(
  courseId: string,
  itemId: string,
  patch: {
    title?: string;
    description?: string;
    sequenceMode?: "inherit" | "required" | "free";
    requiredForCompletion?: boolean;
  }
): Promise<UpdateItemResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  if (patch.title !== undefined && !patch.title.trim()) {
    return { error: "El título no puede quedar vacío" };
  }

  try {
    updateItem(courseId, itemId, {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.sequenceMode !== undefined ? { sequenceMode: patch.sequenceMode } : {}),
      ...(patch.requiredForCompletion !== undefined
        ? { requiredForCompletion: patch.requiredForCompletion }
        : {}),
    });
    revalidateContent(courseId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudieron guardar los cambios. Intenta de nuevo.") };
  }
}

export type AttachDocumentResult =
  | { ok: true; status: "ready" | "pending" | "error"; pageCount?: number }
  | { error: string };

/** Asocia un archivo ya subido (vía /api/uploads) a un ítem de tipo documento. */
export async function attachDocumentAction(
  courseId: string,
  itemId: string,
  fileId: string
): Promise<AttachDocumentResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  const item = getItem(itemId);
  if (!item || item.courseId !== courseId) return { error: "No encontramos esta lección" };
  if (item.kind !== "document") return { error: "Esta lección no acepta archivos" };

  try {
    const result = await attachDocumentFile(itemId, fileId, user);
    revalidateContent(courseId);
    return {
      ok: true,
      status: result.status,
      ...(result.status === "ready" ? { pageCount: result.pageCount } : {}),
    };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo procesar el archivo. Intenta de nuevo.") };
  }
}

export type UpdateDocumentSettingsResult = { ok: true } | { error: string };

/** Segundos mínimos por página del documento (Fase 1: campo directo). */
export async function updateDocumentSettingsAction(
  courseId: string,
  itemId: string,
  settings: { minSecondsPerPage: number }
): Promise<UpdateDocumentSettingsResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  const item = getItem(itemId);
  if (!item || item.courseId !== courseId) return { error: "No encontramos esta lección" };
  if (item.kind !== "document") return { error: "Esta lección no es un documento" };

  const seconds = Math.round(settings.minSecondsPerPage);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600) {
    return { error: "Los segundos por página deben estar entre 0 y 600" };
  }

  try {
    db.update(itemDocuments)
      .set({ minSecondsPerPage: seconds })
      .where(eq(itemDocuments.itemId, itemId))
      .run();
    revalidateContent(courseId);
    return { ok: true };
  } catch {
    return { error: "No se pudieron guardar los cambios. Intenta de nuevo." };
  }
}

export type UpdateTextResult = { ok: true } | { error: string };

/** Contenido de una lectura (markdown) y su tiempo mínimo de lectura. */
export async function updateTextAction(
  courseId: string,
  itemId: string,
  content: { contentMd?: string; minReadSeconds?: number }
): Promise<UpdateTextResult> {
  const user = await requireTeacher();
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };

  const item = getItem(itemId);
  if (!item || item.courseId !== courseId) return { error: "No encontramos esta lección" };
  if (item.kind !== "text") return { error: "Esta lección no es una lectura" };

  if (content.minReadSeconds !== undefined) {
    const seconds = Math.round(content.minReadSeconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
      return { error: "Los segundos mínimos de lectura no son válidos" };
    }
    content = { ...content, minReadSeconds: seconds };
  }

  try {
    db.update(itemTexts)
      .set({
        ...(content.contentMd !== undefined ? { contentMd: cleanRich(content.contentMd) } : {}),
        ...(content.minReadSeconds !== undefined
          ? { minReadSeconds: content.minReadSeconds }
          : {}),
      })
      .where(eq(itemTexts.itemId, itemId))
      .run();
    revalidateContent(courseId);
    return { ok: true };
  } catch {
    return { error: "No se pudieron guardar los cambios. Intenta de nuevo." };
  }
}
