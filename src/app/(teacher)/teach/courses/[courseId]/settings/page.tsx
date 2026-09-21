import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import {
  assignableTemplateInfo,
  listAssignableTemplates,
} from "@/server/services/certificates";
import { Settings } from "lucide-react";
import { CourseSettingsForm } from "@/components/teach/course-settings-form";
import { CourseCoverCard } from "@/components/teach/course-cover-card";
import { TabHeading } from "@/components/teach/tab-heading";

export const metadata: Metadata = { title: "Ajustes del curso" };

export default async function CourseSettingsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const user = await requireTeacher();
  const { courseId } = await params;
  const course = getOwnedCourse(courseId, user);
  if (!course) notFound();

  // Maestro: sus plantillas y las generales (del admin); admin: todas, con el
  // maestro dueño en las que no son generales
  const templates = listAssignableTemplates(user).map((t) => ({
    id: t.id,
    name: t.general
      ? `${t.name} (general)`
      : user.role === "admin"
        ? `${t.name} · ${t.ownerName}`
        : t.name,
  }));
  // La plantilla actual puede no estar entre las elegibles (p. ej. la de otro
  // maestro que asignó el admin): se agrega para que el selector no quede en blanco
  const currentId = course.certificateTemplateId;
  if (currentId && !templates.some((t) => t.id === currentId)) {
    const current = assignableTemplateInfo(currentId);
    if (current) {
      templates.push({
        id: current.id,
        name: current.general ? `${current.name} (general)` : `${current.name} · ${current.ownerName}`,
      });
    }
  }

  return (
    <div className="space-y-4">
      <TabHeading
        title="Ajustes"
        icon={Settings}
        description="Información general, certificado, vigencia y acciones sobre el curso."
      />
      <div className="max-w-2xl">
        <CourseCoverCard courseId={course.id} coverFileId={course.coverFileId} />
      </div>
      <CourseSettingsForm
        course={{
          id: course.id,
          title: course.title,
          description: course.description,
          enforceSequence: course.enforceSequence,
          status: course.status,
          certificateTemplateId: course.certificateTemplateId,
          validityMode: course.validityMode,
          validityMonths: course.validityMonths,
        }}
        templates={templates}
      />
    </div>
  );
}
