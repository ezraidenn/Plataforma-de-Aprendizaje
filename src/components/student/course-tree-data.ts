import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import {
  exams,
  itemAssignments,
  itemDocuments,
  itemResourceFiles,
  itemVideos,
  questions,
} from "@/server/db/schema";
import { getTree, linearOrder, type TreeNode, type CourseItem } from "@/server/services/tree";
import { getCourse } from "@/server/services/courses";
import { getEnrollment, getProgressMap, lockStates } from "@/server/services/progress";
import type { StudentTreeNode, StudentItemStatus } from "./types";

/** Misma regla que el gating del servidor (progress.ts). */
function effectiveSequenceRequired(item: CourseItem, courseEnforces: boolean): boolean {
  if (item.sequenceMode === "required") return true;
  if (item.sequenceMode === "free") return false;
  return courseEnforces;
}

/**
 * Construye el árbol del curso listo para pintarse en el cliente:
 * estado por ítem (léxico de DISENO-UX §3.1), subtexto, href navegable y
 * razón del candado. Todo serializable.
 */
export function buildStudentTree(courseId: string, studentId: string): StudentTreeNode[] {
  const enrollment = getEnrollment(courseId, studentId);
  const course = getCourse(courseId);
  if (!enrollment || !course) return [];

  const progress = getProgressMap(enrollment.id);
  const locks = lockStates(courseId, studentId);
  const order = linearOrder(courseId).filter((i) => i.visible);

  // El ítem que bloquea es el PRIMER ítem del orden lineal requerido en
  // secuencia y sin completar (idéntico a canAccess en progress.ts).
  let blockerTitle: string | null = null;
  for (const item of order) {
    const mustComplete =
      effectiveSequenceRequired(item, course.enforceSequence) && item.requiredForCompletion;
    if (mustComplete && progress.get(item.id)?.status !== "completed") {
      blockerTitle = item.title;
      break;
    }
  }

  // Conteo de páginas de los documentos, en una sola consulta
  const docIds = order.filter((i) => i.kind === "document").map((i) => i.id);
  const docRows =
    docIds.length > 0
      ? db.select().from(itemDocuments).where(inArray(itemDocuments.itemId, docIds)).all()
      : [];
  const docByItem = new Map(docRows.map((d) => [d.itemId, d]));

  // Número de preguntas por examen, en una sola consulta
  const examIds = order.filter((i) => i.kind === "exam").map((i) => i.id);
  const questionCountByExam = new Map<string, number>();
  if (examIds.length > 0) {
    const rows = db
      .select({ examItemId: questions.examItemId })
      .from(questions)
      .where(inArray(questions.examItemId, examIds))
      .all();
    for (const r of rows) {
      questionCountByExam.set(r.examItemId, (questionCountByExam.get(r.examItemId) ?? 0) + 1);
    }
  }

  // drawCount por examen: con pool aleatorio el subtexto muestra las preguntas
  // POR INTENTO, no el tamaño del banco (B8)
  const drawCountByExam = new Map<string, number | null>();
  if (examIds.length > 0) {
    const rows = db
      .select({ itemId: exams.itemId, drawCount: exams.drawCount })
      .from(exams)
      .where(inArray(exams.itemId, examIds))
      .all();
    for (const r of rows) drawCountByExam.set(r.itemId, r.drawCount);
  }

  // Detalle de los videos (duración y enlace válido), en una sola consulta
  const videoIds = order.filter((i) => i.kind === "video").map((i) => i.id);
  const videoRows =
    videoIds.length > 0
      ? db.select().from(itemVideos).where(inArray(itemVideos.itemId, videoIds)).all()
      : [];
  const videoByItem = new Map(videoRows.map((v) => [v.itemId, v]));

  // Puntos de las tareas, en una sola consulta
  const assignmentIds = order.filter((i) => i.kind === "assignment").map((i) => i.id);
  const assignmentRows =
    assignmentIds.length > 0
      ? db
          .select()
          .from(itemAssignments)
          .where(inArray(itemAssignments.itemId, assignmentIds))
          .all()
      : [];
  const assignmentByItem = new Map(assignmentRows.map((a) => [a.itemId, a]));

  // Número de archivos por recurso, en una sola consulta
  const resourceIds = order.filter((i) => i.kind === "resource").map((i) => i.id);
  const resourceCountByItem = new Map<string, number>();
  if (resourceIds.length > 0) {
    const rows = db
      .select({ itemId: itemResourceFiles.itemId })
      .from(itemResourceFiles)
      .where(inArray(itemResourceFiles.itemId, resourceIds))
      .all();
    for (const r of rows) {
      resourceCountByItem.set(r.itemId, (resourceCountByItem.get(r.itemId) ?? 0) + 1);
    }
  }

  const toNode = (node: TreeNode): StudentTreeNode => {
    if (node.kind === "folder") {
      return {
        id: node.id,
        title: node.title,
        kind: "folder",
        status: "available",
        percent: 0,
        subtext: null,
        href: null,
        comingSoon: false,
        blockedByTitle: null,
        children: node.children.filter((c) => c.visible).map(toNode),
      };
    }

    const p = progress.get(node.id);
    const locked = locks.get(node.id) ?? false;
    const status: StudentItemStatus = locked
      ? "locked"
      : p?.status === "completed"
        ? "completed"
        : p?.status === "in_progress"
          ? "in_progress"
          : "available";

    let subtext: string | null = null;
    let ready = true;
    if (node.kind === "document") {
      const doc = docByItem.get(node.id);
      ready = doc?.processingStatus === "ready" && !!doc.pageCount && !!doc.renderFileId;
      subtext = ready
        ? `${doc!.pageCount} ${doc!.pageCount === 1 ? "página" : "páginas"}`
        : "En preparación";
    } else if (node.kind === "text") {
      subtext = "Lectura";
    } else if (node.kind === "video") {
      const video = videoByItem.get(node.id);
      ready =
        !!video?.videoId && (video.provider === "youtube" || video.provider === "vimeo");
      const mins = video?.durationSeconds
        ? Math.max(1, Math.round(video.durationSeconds / 60))
        : null;
      subtext = ready ? (mins !== null ? `Video · ${mins} min` : "Video") : "En preparación";
    } else if (node.kind === "exam") {
      const bank = questionCountByExam.get(node.id) ?? 0;
      const draw = drawCountByExam.get(node.id);
      const n = draw && draw > 0 && draw < bank ? draw : bank;
      subtext = n > 0 ? `Examen · ${n} ${n === 1 ? "pregunta" : "preguntas"}` : "Examen";
    } else if (node.kind === "assignment") {
      const a = assignmentByItem.get(node.id);
      ready = !!a;
      subtext = a ? `Tarea · ${a.maxScore} pts` : "En preparación";
    } else if (node.kind === "resource") {
      const n = resourceCountByItem.get(node.id) ?? 0;
      subtext = n > 0 ? `Recurso · ${n} ${n === 1 ? "archivo" : "archivos"}` : "Recurso";
    } else if (node.kind === "link") {
      subtext = "Enlace";
    }

    const navigable = !locked && ready;

    return {
      id: node.id,
      title: node.title,
      kind: node.kind,
      status,
      percent: Math.round(p?.percent ?? 0),
      subtext,
      href: navigable ? `/courses/${courseId}/items/${node.id}` : null,
      comingSoon: false,
      blockedByTitle: locked ? blockerTitle : null,
      children: [],
    };
  };

  return getTree(courseId)
    .filter((n) => n.visible)
    .map(toNode);
}
