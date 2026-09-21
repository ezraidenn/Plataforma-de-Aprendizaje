"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/sessions";
import { getOwnedCourse } from "@/server/services/courses";
import { getItem, type ItemKind } from "@/server/services/tree";
import {
  addResourceFile,
  listResourceFiles,
  removeResourceFile,
  reorderResourceFiles,
  updateLink,
  type FileEntry,
} from "@/server/services/resources";
import {
  addAssignmentAttachment,
  listAssignmentAttachments,
  removeAssignmentAttachment,
} from "@/server/services/assignments";

export type ActionResult = { ok: true } | { error: string };
export type FilesResult = { ok: true; files: FileEntry[] } | { error: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function revalidateContent(courseId: string) {
  revalidatePath(`/teach/courses/${courseId}`, "layout");
}

/** Mismo guard que teacher-tree: maestro dueño del curso + ítem del tipo esperado. */
function guardItem(
  courseId: string,
  itemId: string,
  kind: ItemKind,
  user: SessionUser
): { error: string } | null {
  const course = getOwnedCourse(courseId, user);
  if (!course) return { error: "No encontramos este curso o no te pertenece" };
  const item = getItem(itemId);
  if (!item || item.courseId !== courseId || item.kind !== kind) {
    return { error: "No encontramos este elemento" };
  }
  return null;
}

// ─── Enlace externo ──────────────────────────────────────────────────────────

export async function updateLinkAction(
  courseId: string,
  itemId: string,
  input: { url: string; description: string }
): Promise<ActionResult> {
  const user = await requireTeacher();
  const g = guardItem(courseId, itemId, "link", user);
  if (g) return g;

  const url = input.url.trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    return { error: "La URL debe empezar con http:// o https://" };
  }
  try {
    updateLink(itemId, { url, description: input.description.trim().slice(0, 1000) });
    revalidateContent(courseId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo guardar el enlace. Intenta de nuevo.") };
  }
}

// ─── Recurso descargable ─────────────────────────────────────────────────────

export async function addResourceFileAction(
  courseId: string,
  itemId: string,
  fileId: string
): Promise<FilesResult> {
  const user = await requireTeacher();
  const g = guardItem(courseId, itemId, "resource", user);
  if (g) return g;
  try {
    addResourceFile(itemId, fileId, user);
    revalidateContent(courseId);
    return { ok: true, files: listResourceFiles(itemId) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo agregar el archivo. Intenta de nuevo.") };
  }
}

export async function removeResourceFileAction(
  courseId: string,
  itemId: string,
  entryId: string
): Promise<FilesResult> {
  const user = await requireTeacher();
  const g = guardItem(courseId, itemId, "resource", user);
  if (g) return g;
  try {
    removeResourceFile(itemId, entryId);
    revalidateContent(courseId);
    return { ok: true, files: listResourceFiles(itemId) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo quitar el archivo. Intenta de nuevo.") };
  }
}

export async function reorderResourceFilesAction(
  courseId: string,
  itemId: string,
  orderedEntryIds: string[]
): Promise<FilesResult> {
  const user = await requireTeacher();
  const g = guardItem(courseId, itemId, "resource", user);
  if (g) return g;
  try {
    reorderResourceFiles(itemId, orderedEntryIds);
    revalidateContent(courseId);
    return { ok: true, files: listResourceFiles(itemId) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo reordenar. Intenta de nuevo.") };
  }
}

// ─── Adjuntos de tarea (material de apoyo) ───────────────────────────────────

export async function addAssignmentAttachmentAction(
  courseId: string,
  itemId: string,
  fileId: string
): Promise<FilesResult> {
  const user = await requireTeacher();
  const g = guardItem(courseId, itemId, "assignment", user);
  if (g) return g;
  try {
    addAssignmentAttachment(itemId, fileId, user);
    revalidateContent(courseId);
    return { ok: true, files: listAssignmentAttachments(itemId) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo agregar el adjunto. Intenta de nuevo.") };
  }
}

export async function removeAssignmentAttachmentAction(
  courseId: string,
  itemId: string,
  entryId: string
): Promise<FilesResult> {
  const user = await requireTeacher();
  const g = guardItem(courseId, itemId, "assignment", user);
  if (g) return g;
  try {
    removeAssignmentAttachment(itemId, entryId);
    revalidateContent(courseId);
    return { ok: true, files: listAssignmentAttachments(itemId) };
  } catch (err) {
    return { error: errorMessage(err, "No se pudo quitar el adjunto. Intenta de nuevo.") };
  }
}
