import { notFound } from "next/navigation";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getItems } from "@/server/services/tree";
import { getDocumentDetail } from "@/server/services/documents";
import { CourseHeader } from "@/components/teach/course-header";
import { CourseTabs } from "@/components/teach/course-tabs";

export default async function CourseEditorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const user = await requireTeacher();
  const { courseId } = await params;
  const course = getOwnedCourse(courseId, user);
  if (!course) notFound();

  // Documentos sin procesar que impiden publicar (misma regla que publishCourse)
  const publishBlockers = getItems(courseId)
    .filter((item) => item.kind === "document")
    .filter((item) => getDocumentDetail(item.id)?.processingStatus !== "ready")
    .map((item) => item.title);

  return (
    <div className="space-y-4">
      <CourseHeader
        course={{ id: course.id, title: course.title, status: course.status, coverFileId: course.coverFileId }}
        publishBlockers={publishBlockers}
      />
      <CourseTabs courseId={course.id} />
      {children}
    </div>
  );
}
