import { notFound } from "next/navigation";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse, publishBlockers } from "@/server/services/courses";
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

  // Lo que impide publicar: la MISMA lista que aplica publishCourse
  const blockers = publishBlockers(courseId);

  return (
    <div className="space-y-4">
      <CourseHeader
        course={{ id: course.id, title: course.title, status: course.status, coverFileId: course.coverFileId }}
        publishBlockers={blockers}
      />
      <CourseTabs courseId={course.id} />
      {children}
    </div>
  );
}
