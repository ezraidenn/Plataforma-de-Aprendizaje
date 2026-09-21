"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CourseOption = { id: string; title: string; status: string };

/** Selector de curso del reporte: navega con ?course= (server-side). */
export function CourseSelect({
  courses,
  value,
}: {
  courses: CourseOption[];
  value: string;
}) {
  const router = useRouter();

  return (
    <Select
      value={value}
      onValueChange={(id) => router.push(`/teach/reports?course=${id}`)}
    >
      <SelectTrigger
        className="w-64 max-w-full bg-card data-[size=default]:h-11"
        aria-label="Curso del reporte"
      >
        <SelectValue placeholder="Elige un curso" />
      </SelectTrigger>
      <SelectContent>
        {courses.map((course) => (
          <SelectItem key={course.id} value={course.id}>
            {course.title}
            {course.status === "draft" ? " (borrador)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
