import "server-only";
import { and, eq, asc, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { fileIdsForItem } from "./storage-layout";
import { copyStoredFile, deleteFile } from "./storage";
import {
  courseItems,
  itemDocuments,
  itemTexts,
  itemVideos,
  itemAssignments,
  itemLinks,
  exams,
  itemResourceFiles,
  assignmentAttachments,
  questions,
  questionOptions,
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

// ─── Copiar y pegar (copia profunda) ─────────────────────────────────────────

/** Fila copiada sin sus marcas de tiempo (toman las del momento de la copia). */
function withoutTimestamps<T extends object>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as T;
}

/**
 * Copia un ítem (y, si es carpeta, todo su contenido) a otro lugar del mismo
 * curso o de otro. Copia la configuración de cada tipo y sus archivos: cada
 * copia con los SUYOS (si dos lecciones compartieran un archivo, los permisos
 * y el avance de los alumnos seguirían solo a una). Nunca copia el avance,
 * los intentos ni las entregas; un examen copiado empieza sin resultados
 * publicados. Las imágenes del editor se comparten (son de la plataforma).
 */
export async function duplicateItem(opts: {
  sourceItemId: string;
  targetCourseId: string;
  parentId: string | null;
  index: number;
  uploadedBy: string;
}): Promise<{ item: CourseItem; count: number; missingFiles: number }> {
  const src = getItem(opts.sourceItemId);
  if (!src) throw new Error("Lo que copiaste ya no existe");

  // Foto del subárbol ANTES de insertar nada (una carpeta puede pegarse dentro de sí misma)
  const all = getItems(src.courseId);
  const childrenOf = new Map<string | null, CourseItem[]>();
  for (const it of all) childrenOf.set(it.parentId, [...(childrenOf.get(it.parentId) ?? []), it]);
  const subtree: CourseItem[] = [];
  const walk = (it: CourseItem) => {
    subtree.push(it);
    for (const c of (childrenOf.get(it.id) ?? []).sort((a, b) => a.position - b.position)) walk(c);
  };
  walk(src);

  const destDepth = folderDepth(opts.targetCourseId, opts.parentId);
  if (src.kind === "folder") {
    const hasSubfolders = subtree.some((it) => it.id !== src.id && it.kind === "folder");
    if (destDepth + 1 + (hasSubfolders ? 1 : 0) > MAX_FOLDER_DEPTH) {
      throw new Error("Máximo dos niveles de carpetas");
    }
  }

  // 1) Archivos (asíncrono, fuera de la transacción)
  const ids = subtree.map((it) => it.id);
  const docs = new Map(
    db.select().from(itemDocuments).where(inArray(itemDocuments.itemId, ids)).all().map((d) => [d.itemId, d])
  );
  const resourceFiles = db.select().from(itemResourceFiles).where(inArray(itemResourceFiles.itemId, ids)).all();
  const attachments = db.select().from(assignmentAttachments).where(inArray(assignmentAttachments.itemId, ids)).all();
  const fileIds = new Set<string>();
  for (const d of docs.values()) {
    if (d.sourceFileId) fileIds.add(d.sourceFileId);
    if (d.renderFileId) fileIds.add(d.renderFileId);
  }
  for (const r of resourceFiles) fileIds.add(r.fileId);
  for (const a of attachments) fileIds.add(a.fileId);

  const newFile = new Map<string, string>();
  let missingFiles = 0;
  try {
    for (const fid of fileIds) {
      const copied = await copyStoredFile(fid, opts.uploadedBy);
      if (copied) newFile.set(fid, copied);
      else missingFiles++;
    }
  } catch (err) {
    for (const id of newFile.values()) await deleteFile(id).catch(() => {});
    throw err;
  }
  const mapFile = (fid: string | null) => (fid ? newFile.get(fid) ?? null : null);

  // 2) Filas (una sola transacción: o se copia todo o nada)
  const newId = new Map(subtree.map((it) => [it.id, nanoid()]));
  const sameCourse = src.courseId === opts.targetCourseId;
  const reconvert: string[] = [];
  try {
    db.transaction(() => {
      for (const it of subtree) {
        const id = newId.get(it.id)!;
        const isTop = it.id === src.id;
        db.insert(courseItems)
          .values({
            id,
            courseId: opts.targetCourseId,
            parentId: isTop ? opts.parentId : newId.get(it.parentId!)!,
            position: isTop ? nextPosition(opts.targetCourseId, opts.parentId) : it.position,
            kind: it.kind,
            // En el mismo curso se distingue del original (y su archivo no choca de ruta)
            title: isTop && sameCourse ? `${it.title} (copia)` : it.title,
            description: it.description,
            sequenceMode: it.sequenceMode,
            requiredForCompletion: it.requiredForCompletion,
            visible: it.visible,
          })
          .run();

        switch (it.kind) {
          case "document": {
            const d = docs.get(it.id);
            if (!d) break;
            const source = mapFile(d.sourceFileId);
            // Un PDF usa el mismo archivo como fuente y como versión final
            const render = d.renderFileId === d.sourceFileId ? source : mapFile(d.renderFileId);
            let status = d.processingStatus;
            if (!source) status = "pending";
            else if (!render && d.sourceType !== "pdf") {
              // PowerPoint sin versión convertida: se vuelve a convertir
              status = "pending";
              reconvert.push(id);
            }
            db.insert(itemDocuments)
              .values(
                withoutTimestamps({
                  ...d,
                  itemId: id,
                  sourceFileId: source,
                  renderFileId: render,
                  thumbnailFileId: null,
                  processingStatus: status,
                  pageCount: render ? d.pageCount : null,
                })
              )
              .run();
            break;
          }
          case "text": {
            const t = db.select().from(itemTexts).where(eq(itemTexts.itemId, it.id)).get();
            if (t) db.insert(itemTexts).values(withoutTimestamps({ ...t, itemId: id })).run();
            break;
          }
          case "video": {
            const v = db.select().from(itemVideos).where(eq(itemVideos.itemId, it.id)).get();
            if (v) db.insert(itemVideos).values(withoutTimestamps({ ...v, itemId: id })).run();
            break;
          }
          case "link": {
            const l = db.select().from(itemLinks).where(eq(itemLinks.itemId, it.id)).get();
            if (l) db.insert(itemLinks).values(withoutTimestamps({ ...l, itemId: id })).run();
            break;
          }
          case "assignment": {
            const a = db.select().from(itemAssignments).where(eq(itemAssignments.itemId, it.id)).get();
            if (a) db.insert(itemAssignments).values(withoutTimestamps({ ...a, itemId: id })).run();
            for (const att of attachments.filter((x) => x.itemId === it.id)) {
              const fid = mapFile(att.fileId);
              if (fid) db.insert(assignmentAttachments).values({ ...att, id: nanoid(), itemId: id, fileId: fid }).run();
            }
            break;
          }
          case "resource": {
            for (const r of resourceFiles.filter((x) => x.itemId === it.id)) {
              const fid = mapFile(r.fileId);
              if (fid) db.insert(itemResourceFiles).values({ ...r, id: nanoid(), itemId: id, fileId: fid }).run();
            }
            break;
          }
          case "exam": {
            const e = db.select().from(exams).where(eq(exams.itemId, it.id)).get();
            if (e) {
              db.insert(exams)
                .values(withoutTimestamps({ ...e, itemId: id, resultsPublishedAt: null, resultsNotifiedAt: null }))
                .run();
            }
            for (const q of db.select().from(questions).where(eq(questions.examItemId, it.id)).all()) {
              const qid = nanoid();
              // imageFileId viaja tal cual: la foto y los íconos se comparten
              db.insert(questions)
                .values(withoutTimestamps({ ...q, id: qid, examItemId: id }))
                .run();
              for (const o of db.select().from(questionOptions).where(eq(questionOptions.questionId, q.id)).all()) {
                db.insert(questionOptions).values({ ...o, id: nanoid(), questionId: qid }).run();
              }
            }
            break;
          }
        }
      }
    });
  } catch (err) {
    for (const id of newFile.values()) await deleteFile(id).catch(() => {});
    throw err;
  }

  // 3) En su lugar entre los hermanos, sus archivos a su ruta legible y, si hace falta, reconvertir
  const top = newId.get(src.id)!;
  moveItem({ courseId: opts.targetCourseId, itemId: top, newParentId: opts.parentId, newIndex: opts.index });
  if (newFile.size > 0) enqueueJob("relocate_files", { courseId: opts.targetCourseId });
  for (const itemId of reconvert) enqueueJob("convert_ppt", { itemId });

  return { item: getItem(top)!, count: subtree.length, missingFiles };
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
