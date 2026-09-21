import "server-only";
import { and, eq, asc, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { fileIdsForItem } from "./storage-layout";
import {
  courseItems,
  itemDocuments,
  itemTexts,
  itemVideos,
  itemAssignments,
  itemLinks,
  exams,
} from "@/server/db/schema";

export type ItemKind = (typeof courseItems.$inferSelect)["kind"];
export type CourseItem = typeof courseItems.$inferSelect;

export type TreeNode = CourseItem & { children: TreeNode[] };

/** Profundidad máxima de carpetas: carpeta dentro de carpeta y ya (2 niveles). */
const MAX_FOLDER_DEPTH = 2;

export function getItems(courseId: string): CourseItem[] {
  return db
    .select()
    .from(courseItems)
    .where(eq(courseItems.courseId, courseId))
    .orderBy(asc(courseItems.position))
    .all();
}

export function getItem(itemId: string): CourseItem | null {
  return db.select().from(courseItems).where(eq(courseItems.id, itemId)).get() ?? null;
}

/** Árbol anidado ordenado por position. */
export function getTree(courseId: string): TreeNode[] {
  const items = getItems(courseId);
  const byParent = new Map<string | null, CourseItem[]>();
  for (const item of items) {
    const key = item.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(item);
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((item) => ({
      ...item,
      children: build(item.id),
    }));
  return build(null);
}

/**
 * Orden lineal DFS de lecciones (sin carpetas): es el orden que recorre el
 * estudiante y el que usa el gating de secuencia.
 */
export function linearOrder(courseId: string): CourseItem[] {
  const out: CourseItem[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") walk(node.children);
      else out.push(node);
    }
  };
  walk(getTree(courseId));
  return out;
}

function folderDepth(courseId: string, parentId: string | null): number {
  let depth = 0;
  let current = parentId;
  while (current) {
    const parent = getItem(current);
    if (!parent || parent.courseId !== courseId) throw new Error("Carpeta destino inválida");
    if (parent.kind !== "folder") throw new Error("El padre debe ser una carpeta");
    depth += 1;
    current = parent.parentId;
  }
  return depth;
}

function nextPosition(courseId: string, parentId: string | null): number {
  const siblings = db
    .select({ position: courseItems.position })
    .from(courseItems)
    .where(
      and(
        eq(courseItems.courseId, courseId),
        parentId === null ? isNull(courseItems.parentId) : eq(courseItems.parentId, parentId)
      )
    )
    .all();
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.position)) + 1;
}

export function createItem(opts: {
  courseId: string;
  parentId: string | null;
  kind: ItemKind;
  title: string;
}): CourseItem {
  const depth = folderDepth(opts.courseId, opts.parentId);
  if (opts.kind === "folder" && depth >= MAX_FOLDER_DEPTH) {
    throw new Error("Máximo dos niveles de carpetas");
  }

  const id = nanoid();
  const item: typeof courseItems.$inferInsert = {
    id,
    courseId: opts.courseId,
    parentId: opts.parentId,
    position: nextPosition(opts.courseId, opts.parentId),
    kind: opts.kind,
    title: opts.title,
  };

  db.transaction(() => {
    db.insert(courseItems).values(item).run();
    // Fila de detalle según el tipo
    switch (opts.kind) {
      case "document":
        db.insert(itemDocuments).values({ itemId: id }).run();
        break;
      case "text":
        db.insert(itemTexts).values({ itemId: id }).run();
        break;
      case "video":
        db.insert(itemVideos).values({ itemId: id, url: "", provider: "other" }).run();
        break;
      case "assignment":
        db.insert(itemAssignments).values({ itemId: id }).run();
        break;
      case "exam":
        db.insert(exams).values({ itemId: id }).run();
        break;
      case "link":
        db.insert(itemLinks).values({ itemId: id, url: "", description: "" }).run();
        break;
      // resource: los archivos se agregan después (item_resource_files)
    }
  });

  return getItem(id)!;
}

/**
 * Mueve un ítem a (newParentId, newIndex) renumerando hermanos en transacción.
 */
export function moveItem(opts: {
  courseId: string;
  itemId: string;
  newParentId: string | null;
  newIndex: number;
}) {
  const item = getItem(opts.itemId);
  if (!item || item.courseId !== opts.courseId) throw new Error("Ítem no encontrado");

  // No moverse dentro de sí mismo ni de un descendiente
  let cursor = opts.newParentId;
  while (cursor) {
    if (cursor === opts.itemId) throw new Error("No puedes mover una carpeta dentro de sí misma");
    cursor = getItem(cursor)?.parentId ?? null;
  }

  const destDepth = folderDepth(opts.courseId, opts.newParentId);
  if (item.kind === "folder") {
    // La carpeta y su contenido no deben exceder la profundidad máxima
    const hasSubfolders = db
      .select({ id: courseItems.id })
      .from(courseItems)
      .where(and(eq(courseItems.parentId, item.id), eq(courseItems.kind, "folder")))
      .all().length > 0;
    const ownDepth = destDepth + 1 + (hasSubfolders ? 1 : 0);
    if (ownDepth > MAX_FOLDER_DEPTH) throw new Error("Máximo dos niveles de carpetas");
  }

  db.transaction(() => {
    const siblingsOf = (parentId: string | null) =>
      db
        .select()
        .from(courseItems)
        .where(
          and(
            eq(courseItems.courseId, opts.courseId),
            parentId === null ? isNull(courseItems.parentId) : eq(courseItems.parentId, parentId)
          )
        )
        .orderBy(asc(courseItems.position))
        .all()
        .filter((s) => s.id !== opts.itemId);

    const dest = siblingsOf(opts.newParentId);
    const clampedIndex = Math.max(0, Math.min(opts.newIndex, dest.length));
    dest.splice(clampedIndex, 0, { ...item, parentId: opts.newParentId });

    for (let i = 0; i < dest.length; i++) {
      db.update(courseItems)
        .set({ position: i, parentId: dest[i].id === opts.itemId ? opts.newParentId : dest[i].parentId })
        .where(eq(courseItems.id, dest[i].id))
        .run();
    }

    // Renumerar el origen si cambió de padre
    if ((item.parentId ?? null) !== (opts.newParentId ?? null)) {
      const origin = siblingsOf(item.parentId ?? null);
      for (let i = 0; i < origin.length; i++) {
        db.update(courseItems).set({ position: i }).where(eq(courseItems.id, origin[i].id)).run();
      }
    }
  });
}

/** Borra un ítem y todos sus descendientes (el detalle cae por FK cascade). */
export function deleteItem(courseId: string, itemId: string) {
  const item = getItem(itemId);
  if (!item || item.courseId !== courseId) throw new Error("Ítem no encontrado");

  const collectIds = (id: string): string[] => {
    const children = db
      .select({ id: courseItems.id })
      .from(courseItems)
      .where(eq(courseItems.parentId, id))
      .all();
    return [id, ...children.flatMap((c) => collectIds(c.id))];
  };

  const ids = collectIds(itemId);
  // Los archivos se recogen ANTES de borrar: después ya no hay cómo llegar a ellos
  const fileIds = ids.flatMap((id) => fileIdsForItem(id));
  db.transaction(() => {
    for (const id of ids.reverse()) {
      db.delete(courseItems).where(eq(courseItems.id, id)).run();
    }
  });
  if (fileIds.length > 0) enqueueJob("cleanup_files", { fileIds });
}

export function updateItem(
  courseId: string,
  itemId: string,
  patch: Partial<
    Pick<CourseItem, "title" | "description" | "sequenceMode" | "requiredForCompletion" | "visible">
  >
) {
  const item = getItem(itemId);
  if (!item || item.courseId !== courseId) throw new Error("Ítem no encontrado");
  db.update(courseItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(courseItems.id, itemId))
    .run();
  // El título forma parte de la ruta física: acomodar en segundo plano
  if (patch.title !== undefined && patch.title !== item.title) {
    enqueueJob("relocate_files", item.kind === "folder" ? { courseId } : { itemId });
  }
}
