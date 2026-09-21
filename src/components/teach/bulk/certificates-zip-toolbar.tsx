"use client";

import { useState } from "react";
import { FolderArchive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

/**
 * Descarga física de certificados en ZIP: todos los del maestro o solo los de
 * un curso (?courseId). `courses` trae únicamente cursos con certificados
 * vigentes, así la descarga nunca sale vacía.
 */
export function CertificatesZipToolbar({
  courses,
  disabled,
}: {
  courses: { id: string; title: string }[];
  disabled: boolean;
}) {
  const [courseId, setCourseId] = useState(ALL);

  function download() {
    toast("Preparando descarga…");
    const url =
      courseId === ALL
        ? "/api/certificates/zip"
        : `/api/certificates/zip?courseId=${encodeURIComponent(courseId)}`;
    window.location.assign(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {courses.length > 1 && (
        <Select value={courseId} onValueChange={setCourseId} disabled={disabled}>
          <SelectTrigger className="h-11 w-56" aria-label="Curso del ZIP a descargar">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los cursos</SelectItem>
            {courses.map((course) => (
              <SelectItem key={course.id} value={course.id}>
                {course.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        type="button"
        onClick={download}
        disabled={disabled}
        className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
      >
        <FolderArchive aria-hidden />
        {courseId === ALL ? "Descargar todos (ZIP)" : "Descargar ZIP del curso"}
      </Button>
    </div>
  );
}
