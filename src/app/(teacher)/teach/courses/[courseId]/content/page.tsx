import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { FolderTree, MousePointerClick } from "lucide-react";
import { db } from "@/server/db";
import { itemTexts } from "@/server/db/schema";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getTree, getItem, getItems, type TreeNode } from "@/server/services/tree";
import { getDocumentDetail } from "@/server/services/documents";
import { getFileRecord } from "@/server/services/storage";
import { getVideoDetail } from "@/server/services/video";
import { listQuestions } from "@/server/services/exams";
import { getAssignmentDetail, listAssignmentAttachments } from "@/server/services/assignments";
import { getLink, listResourceFiles } from "@/server/services/resources";
import {
  TreeEditor,
  type DocStatus,
  type TreeItem,
} from "@/components/teach/content/tree-editor";
import {
  ItemDetailForm,
  type DocDetail,
  type TextDetail,
  type VideoDetail,
  type ExamSummary,
  type AssignmentDetail,
} from "@/components/teach/content/item-detail-form";
import type { LinkDetail } from "@/components/teach/content/link-section";
import type { ManagedFile } from "@/components/teach/content/file-list";
import { LessonsCsvDialog } from "@/components/teach/bulk/lessons-csv-dialog";
import { TabHeading } from "@/components/teach/tab-heading";

export const metadata: Metadata = { title: "Contenido del curso" };

function toLite(nodes: TreeNode[]): TreeItem[] {
  return nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    kind: n.kind,
    title: n.title,
    children: toLite(n.children),
  }));
}

export default async function CourseContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const user = await requireTeacher();
  const { courseId } = await params;
  const { item: selectedParam } = await searchParams;
  const course = getOwnedCourse(courseId, user);
  if (!course) notFound();

  const tree = toLite(getTree(courseId));

  // Estado de procesamiento de cada documento (badge en el árbol)
  const docStatus: Record<string, DocStatus> = {};
  for (const item of getItems(courseId)) {
    if (item.kind !== "document") continue;
    const detail = getDocumentDetail(item.id);
    if (detail) {
      docStatus[item.id] = {
        status: detail.processingStatus,
        pageCount: detail.pageCount,
        hasFile: detail.sourceFileId !== null,
      };
    }
  }

  // Detalle del ítem seleccionado (?item=id)
  const selected = selectedParam ? getItem(selectedParam) : null;
  const selectedItem = selected && selected.courseId === courseId ? selected : null;

  let doc: DocDetail | null = null;
  let text: TextDetail | null = null;
  let video: VideoDetail | null = null;
  let exam: ExamSummary | null = null;
  let assignment: AssignmentDetail | null = null;
  let link: LinkDetail | null = null;
  let resourceFiles: ManagedFile[] | null = null;

  if (selectedItem?.kind === "document") {
    const detail = getDocumentDetail(selectedItem.id);
    if (detail) {
      doc = {
        processingStatus: detail.processingStatus,
        processingError: detail.processingError,
        pageCount: detail.pageCount,
        minSecondsPerPage: detail.minSecondsPerPage,
        hasFile: detail.sourceFileId !== null,
        fileName: detail.sourceFileId
          ? getFileRecord(detail.sourceFileId)?.originalName ?? null
          : null,
      };
    }
  }

  if (selectedItem?.kind === "text") {
    const row = db
      .select()
      .from(itemTexts)
      .where(eq(itemTexts.itemId, selectedItem.id))
      .get();
    text = { contentMd: row?.contentMd ?? "", minReadSeconds: row?.minReadSeconds ?? 0 };
  }

  if (selectedItem?.kind === "video") {
    const detail = getVideoDetail(selectedItem.id);
    if (detail) {
      video = {
        url: detail.url,
        provider: detail.provider,
        videoId: detail.videoId,
        durationSeconds: detail.durationSeconds,
        allowSpeedUp: detail.allowSpeedUp,
      };
    }
  }

  if (selectedItem?.kind === "exam") {
    const questions = listQuestions(selectedItem.id);
    exam = {
      questionCount: questions.length,
      maxScore: questions.reduce((sum, q) => sum + q.points, 0),
    };
  }

  if (selectedItem?.kind === "assignment") {
    const detail = getAssignmentDetail(selectedItem.id);
    if (detail) {
      assignment = {
        instructionsMd: detail.instructionsMd,
        attachments: listAssignmentAttachments(selectedItem.id),
        dueAtMs: detail.dueAt?.getTime() ?? null,
        maxScore: detail.maxScore,
        allowedFileTypes: detail.allowedFileTypes,
        allowResubmission: detail.allowResubmission,
        allowLate: detail.allowLate,
      };
    }
  }

  if (selectedItem?.kind === "link") {
    const row = getLink(selectedItem.id);
    link = { url: row?.url ?? "", description: row?.description ?? "" };
  }

  if (selectedItem?.kind === "resource") {
    resourceFiles = listResourceFiles(selectedItem.id);
  }

  return (
    <div className="space-y-4">
      <TabHeading
        title="Contenido"
        description="Organiza el contenido; con el CSV editas las propiedades de todas las lecciones a la vez."
        icon={FolderTree}
        actions={<LessonsCsvDialog courseId={courseId} />}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <TreeEditor
          courseId={courseId}
          tree={tree}
          docStatus={docStatus}
          selectedId={selectedItem?.id ?? null}
        />

        {selectedItem ? (
          <ItemDetailForm
            key={selectedItem.id}
            courseId={courseId}
            item={{
              id: selectedItem.id,
              kind: selectedItem.kind,
              title: selectedItem.title,
              description: selectedItem.description,
              requiredForCompletion: selectedItem.requiredForCompletion,
              sequenceMode: selectedItem.sequenceMode,
            }}
            doc={doc}
            text={text}
            video={video}
            exam={exam}
            assignment={assignment}
            link={link}
            resourceFiles={resourceFiles}
          />
        ) : (
          <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <MousePointerClick className="size-8" aria-hidden />
            </span>
            <p className="max-w-xs text-sm text-muted-foreground">
              Selecciona un elemento del árbol para editar su contenido, o agrega uno nuevo con el
              botón «Agregar».
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
