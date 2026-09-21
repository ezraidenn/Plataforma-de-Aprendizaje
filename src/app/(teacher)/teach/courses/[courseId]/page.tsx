import { redirect } from "next/navigation";

export default async function CourseIndexPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  redirect(`/teach/courses/${courseId}/content`);
}
