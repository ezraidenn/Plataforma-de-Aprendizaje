import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/server/db";
import { documentProgress, itemTexts } from "@/server/db/schema";
import { requireStudent } from "@/server/auth/guards";
import { getCourse } from "@/server/services/courses";
import { getItem, linearOrder } from "@/server/services/tree";
import {
  canAccess,
  courseProgress,
  getEnrollment,
  getProgressMap,
  lockStates,
  pagesFromBitmap,
} from "@/server/services/progress";
import { getDocumentDetail } from "@/server/services/documents";
import { getBranding } from "@/server/services/branding";
import { BrandLogo } from "@/components/shell/brand-logo";
import { buildStudentTree } from "@/components/student/course-tree-data";
import {
  buildAssignmentLessonData,
  buildExamLessonData,
  buildLinkLessonData,
  buildResourceLessonData,
  buildVideoLessonData,
} from "@/components/student/lesson-data";
import { FocusSidebar } from "@/components/student/focus-sidebar";
import { LessonShell } from "@/components/student/lesson-shell";
import { Progress } from "@/components/ui/progress";
import type { LessonData, LessonNav } from "@/components/student/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string; itemId: string }>;
}) {
  const { itemId } = await params;
  return { title: getItem(itemId)?.title ?? "Lección" };
}

/**
 * Focus Mode (DISENO-UX §2.3): header propio de 56px, sidebar con el árbol
 * del curso, área de lección y barra inferior Anterior/Siguiente.
 * El acceso se valida server-side con canAccess: la URL directa no salta
 * el candado.
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ courseId: string; itemId: string }>;
}) {
  const user = await requireStudent();
  const { courseId, itemId } = await params;

  const course = getCourse(courseId);
  if (!course || course.status !== "published") redirect("/dashboard");

  const enrollment = getEnrollment(courseId, user.id);
  if (!enrollment || enrollment.status === "dropped") redirect("/dashboard");

  const item = getItem(itemId);
  if (!item || item.courseId !== courseId || item.kind === "folder" || !item.visible) {
    redirect(`/courses/${courseId}`);
  }

  const access = canAccess(courseId, user.id, itemId);
  if (!access.allowed) redirect(`/courses/${courseId}`);

  const branding = getBranding();

  // ─── Datos para el chasis ──────────────────────────────────────────────────

  const summary = courseProgress(courseId, user.id);
  const nodes = buildStudentTree(courseId, user.id);
  const progress = getProgressMap(enrollment.id);
  const locks = lockStates(courseId, user.id);
  const ip = progress.get(itemId);
  const completed = ip?.status === "completed";

  const order = linearOrder(courseId).filter((i) => i.visible);
  const index = order.findIndex((i) => i.id === itemId);
  const prevItem = index > 0 ? order[index - 1] : null;
  const nextItem = index >= 0 && index < order.length - 1 ? order[index + 1] : null;

  const toNav = (target: typeof prevItem): LessonNav | null =>
    target
      ? {
          id: target.id,
          title: target.title,
          href: `/courses/${courseId}/items/${target.id}`,
          locked: locks.get(target.id) ?? false,
        }
      : null;

  // ─── Datos de la lección según su tipo ─────────────────────────────────────

  let lesson: LessonData;
  if (item.kind === "document") {
    const detail = getDocumentDetail(itemId);
    if (
      detail &&
      detail.processingStatus === "ready" &&
      detail.renderFileId &&
      detail.pageCount
    ) {
      const docProg = ip
        ? (db
            .select()
            .from(documentProgress)
            .where(eq(documentProgress.itemProgressId, ip.id))
            .get() ?? null)
        : null;
      const bitmap = (docProg?.pagesViewed as Buffer | null) ?? null;
      lesson = {
        kind: "document",
        fileUrl: `/api/files/${detail.renderFileId}`,
        pageCount: detail.pageCount,
        minSecondsPerPage: detail.minSecondsPerPage,
        initialPage: Math.max(1, Math.min(docProg?.currentPage ?? 1, detail.pageCount)),
        initialCreditedPages: pagesFromBitmap(bitmap, detail.pageCount),
      };
    } else {
      lesson = { kind: "document-unavailable" };
    }
  } else if (item.kind === "text") {
    const textRow =
      db.select().from(itemTexts).where(eq(itemTexts.itemId, itemId)).get() ?? null;
    lesson = {
      kind: "text",
      contentMd: textRow?.contentMd ?? "",
      minReadSeconds: textRow?.minReadSeconds ?? 0,
      initialPercent: Math.round(ip?.percent ?? 0),
      initialCreditedSeconds: ip?.totalSeconds ?? 0,
    };
  } else if (item.kind === "exam") {
    lesson = buildExamLessonData(itemId, user.id);
  } else if (item.kind === "video") {
    lesson = buildVideoLessonData(courseId, user.id, itemId);
  } else if (item.kind === "link") {
    lesson = buildLinkLessonData(itemId, completed);
  } else if (item.kind === "resource") {
    lesson = buildResourceLessonData(itemId, completed);
  } else {
    lesson = buildAssignmentLessonData(itemId, user.id);
  }

  return (
    <div className="flex h-dvh flex-col">
      {/* Header propio 56px azul noche (sin franja de sección: el Focus Mode
          no usa el shell). Volver + logo + curso + progreso global. */}
      <header className="flex h-14 shrink-0 items-center gap-2 bg-[linear-gradient(90deg,#0f172a,#1e1b4b)] px-3 text-white sm:gap-3 sm:px-4">
        <Link
          href={`/courses/${courseId}`}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-white/85 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">Volver al curso</span>
          <span className="sr-only sm:hidden">Volver al curso</span>
        </Link>
        <span aria-hidden className="h-6 w-px shrink-0 bg-white/15" />
        <span className="flex shrink-0 items-center gap-2">
          <BrandLogo logoFileId={branding.logoFileId} size={26} />
          <span className="hidden max-w-44 truncate font-heading text-sm font-semibold lg:block">
            {branding.platformName}
          </span>
        </span>
        <span aria-hidden className="hidden h-6 w-px shrink-0 bg-white/15 lg:block" />
        <p className="min-w-0 flex-1 truncate font-heading text-sm font-semibold">
          {course.title}
        </p>
        {/* Móvil: aquí se monta el botón de contenido del curso (FocusSidebar, via portal) */}
        <span id="focus-mobile-toggle" className="flex shrink-0 items-center md:hidden" />
        <div className="flex shrink-0 items-center gap-2">
          <Progress
            value={summary.percent}
            className="h-1.5 w-20 bg-white/20 sm:w-32 [&>[data-slot=progress-indicator]]:bg-progress-ring"
            aria-label={`Progreso del curso: ${summary.percent}%`}
          />
          <span className="text-sm font-medium tabular-nums text-white/85">
            {summary.percent}%
          </span>
        </div>
      </header>

      {/* Sidebar + lección */}
      <div className="flex min-h-0 flex-1">
        <FocusSidebar nodes={nodes} currentItemId={itemId} />
        <main className="min-w-0 flex-1 bg-background">
          <LessonShell
            courseId={courseId}
            itemId={itemId}
            itemTitle={item.title}
            courseHref={`/courses/${courseId}`}
            prev={toNav(prevItem)}
            next={toNav(nextItem)}
            initialCompleted={completed}
            lesson={lesson}
          />
        </main>
      </div>
    </div>
  );
}
