import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Portada de curso: la foto si existe; si no, un degradado ESTABLE derivado
 * del id del curso (cada curso sin foto tiene su propio tono), con el icono
 * de curso. Sin "use client": sirve en tarjetas server y client.
 */
export function courseGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(120deg, hsl(${hue} 62% 36%), hsl(${hue2} 70% 52%))`;
}

export function CourseCover({
  courseId,
  coverFileId,
  title,
  className,
  iconClassName = "size-8",
}: {
  courseId: string;
  coverFileId: string | null;
  title?: string;
  className?: string;
  iconClassName?: string;
}) {
  if (coverFileId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${coverFileId}`}
        alt={title ? `Portada de ${title}` : ""}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn("flex h-full w-full items-center justify-center text-white/85", className)}
      style={{ backgroundImage: courseGradient(courseId) }}
    >
      <BookOpen className={iconClassName} />
    </div>
  );
}
