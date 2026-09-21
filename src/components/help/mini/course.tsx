import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SceneLesson } from "../scenes/course.story";
import { MiniCheck, MiniLock, MiniOpen, MiniRing } from "./icons";

export function MiniModuleHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-blue-900">
      ▣ {children}
    </div>
  );
}

/** Fila de lección del árbol del alumno con el ícono de su estado. */
export function MiniLessonRow({ title, meta, state, progress, highlight, dense = false }: SceneLesson & { dense?: boolean }) {
  const locked = state === "locked";
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-t border-slate-100 px-2.5 leading-tight transition-colors duration-500",
        dense ? "py-1" : "py-1.5",
        state === "current" && !highlight && "bg-indigo-50 shadow-[inset_3px_0_0_#4f46e5]",
        highlight && "bg-emerald-50 shadow-[inset_3px_0_0_#16a34a]"
      )}
    >
      <span className="size-[18px] shrink-0">
        {state === "done" ? (
          <MiniCheck className="size-[18px]" />
        ) : state === "locked" ? (
          <MiniLock className="size-[18px]" />
        ) : state === "current" ? (
          <MiniRing
            className="size-[18px]"
            progress={progress ?? 0.35}
            color={highlight ? "#16a34a" : "#4f46e5"}
            track={highlight ? "#bbf7d0" : "#e0e7ff"}
          />
        ) : (
          <MiniOpen className="size-[18px]" />
        )}
      </span>
      <span className="min-w-0">
        <b className={cn("block truncate text-[12px] font-semibold transition-colors duration-500", locked && "text-slate-400")}>{title}</b>
        <span className={cn("block truncate text-[10.5px]", locked ? "text-slate-400" : "text-slate-500")}>{meta}</span>
      </span>
    </div>
  );
}

/** «Foto» del curso en las escenas (degradado con el extintor). */
export function MiniCoverArt({ className }: { className?: string }) {
  return (
    <div className={cn("flex size-full items-center justify-center bg-[linear-gradient(135deg,#b91c1c,#f97316)] text-xl", className)}>
      <span aria-hidden>🧯</span>
    </div>
  );
}

/** Color propio del curso cuando no tiene imagen. */
export function MiniCoverBlank({ className }: { className?: string }) {
  return (
    <div className={cn("flex size-full items-center justify-center bg-[linear-gradient(135deg,#1e3a8a,#0ea5e9)] text-white/80", className)}>
      <BookOpen className="size-5" aria-hidden />
    </div>
  );
}

/** Tarjeta de «Mis cursos» del panel del alumno. */
export function MiniCourseCard({
  title,
  percent,
  cover,
  className,
}: {
  title: string;
  percent: number;
  cover: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-white shadow-[0_1px_2px_rgb(15_23_42/0.06)]", className)}>
      <div className="relative h-9 overflow-hidden">{cover}</div>
      <div className="space-y-1 px-1.5 py-1">
        <b className="block truncate text-[9.5px] leading-tight">{title}</b>
        <div className="flex items-center justify-between gap-1">
          <span className="flex items-center gap-1 text-[8.5px] text-slate-500">
            <MiniRing className="size-3" progress={percent / 100} />
            {percent}%
          </span>
          <span className="rounded bg-cta px-1.5 py-0.5 text-[8px] font-bold text-white">{percent > 0 ? "Continuar" : "Empezar"}</span>
        </div>
      </div>
    </div>
  );
}
