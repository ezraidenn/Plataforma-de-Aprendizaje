"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { groupsHref, type GroupsQuery } from "./href";

const ALL = "all";

export type GroupsCourseOption = { id: string; title: string; archived: boolean };

/** Filtro por curso (`?curso=`) de la página de grupos: conserva pestaña y búsqueda. */
export function CourseFilter({
  query,
  courses,
}: {
  query: GroupsQuery;
  courses: GroupsCourseOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(value: string) {
    startTransition(() => {
      router.replace(groupsHref({ ...query, curso: value === ALL ? undefined : value }), {
        scroll: false,
      });
    });
  }

  return (
    <div className="relative max-w-full" aria-busy={pending || undefined}>
      <Select value={query.curso ?? ALL} onValueChange={change}>
        <SelectTrigger
          className="w-60 max-w-full data-[size=default]:h-11"
          aria-label="Filtrar grupos por curso"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los cursos</SelectItem>
          {courses.map((course) => (
            <SelectItem key={course.id} value={course.id}>
              {course.title}
              {course.archived ? " (archivado)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && (
        <span className="pointer-events-none absolute right-8 top-1/2 flex -translate-y-1/2 items-center">
          <Loader2 className="size-4 animate-spin text-section-strong" aria-hidden />
          <span className="sr-only">Actualizando…</span>
        </span>
      )}
    </div>
  );
}
