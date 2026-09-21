"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  publishCourseAction,
  setCourseStatusAction,
  updateCourseAction,
} from "@/server/actions/teacher-courses";
import { CourseStatusBadge } from "./course-status-badge";
import { CourseCover } from "@/components/course-cover";
import { COURSE_STATUS_LABEL } from "./format";
import { HelpTip } from "@/components/help/help-tip";

type CourseHeaderProps = {
  course: {
    id: string;
    title: string;
    status: "draft" | "published" | "archived";
    coverFileId?: string | null;
  };
  /** Títulos de documentos sin procesar que bloquean la publicación. */
  publishBlockers: string[];
};

export function CourseHeader({ course, publishBlockers }: CourseHeaderProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(course.title);
  const [savingTitle, startTitleTransition] = useTransition();
  const [changingStatus, startStatusTransition] = useTransition();

  function saveTitle() {
    const next = title.trim();
    if (!next || next === course.title) {
      setTitle(course.title);
      setEditing(false);
      return;
    }
    startTitleTransition(async () => {
      const result = await updateCourseAction(course.id, { title: next });
      if ("error" in result) {
        toast.error(result.error);
        setTitle(course.title);
      } else {
        toast.success("Título actualizado");
        router.refresh();
      }
      setEditing(false);
    });
  }

  function publish() {
    startStatusTransition(async () => {
      const result = await publishCourseAction(course.id);
      if ("error" in result) {
        toast.error(result.error);
      } else if (!result.ok) {
        toast.error("Aún no puedes publicar: hay documentos sin procesar", {
          description: result.blockers.join(" · "),
          duration: 8000,
        });
      } else {
        toast.success("Curso publicado. Tus estudiantes ya pueden verlo.");
        router.refresh();
      }
    });
  }

  function setStatus(status: "draft" | "archived") {
    startStatusTransition(async () => {
      const result = await setCourseStatusAction(course.id, status);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          status === "draft" ? "El curso volvió a borrador" : "Curso archivado"
        );
        router.refresh();
      }
    });
  }

  // Misma anatomía que <PageHeader> (acento de sección + chip de icono), pero
  // con el título editable en línea; por eso no se reutiliza el componente.
  return (
    <header className="anim-rise relative overflow-hidden rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)] md:p-6">
      <span aria-hidden className="section-gradient absolute inset-x-0 top-0 h-1" />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-section opacity-[0.12]"
      />
      <div className="relative flex flex-wrap items-center gap-4">
        <span className="section-glow flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl">
          <CourseCover courseId={course.id} coverFileId={course.coverFileId ?? null} iconClassName="size-6" />
        </span>
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  setTitle(course.title);
                  setEditing(false);
                }
              }}
              className="h-10 max-w-lg font-heading text-lg font-semibold"
              maxLength={200}
              autoFocus
              aria-label="Título del curso"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={saveTitle}
              disabled={savingTitle}
              aria-label="Guardar título"
            >
              {savingTitle ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setTitle(course.title);
                setEditing(false);
              }}
              aria-label="Cancelar edición del título"
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-section-strong">
                Curso
              </p>
              <h1 className="truncate font-heading text-2xl font-bold tracking-tight md:text-[1.75rem]">
                {course.title}
              </h1>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setEditing(true)}
              aria-label="Editar título del curso"
            >
              <Pencil aria-hidden />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 gap-2" disabled={changingStatus}>
                {changingStatus ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <CourseStatusBadge status={course.status} />
                )}
                <ChevronDown aria-hidden />
                <span className="sr-only">Cambiar estado del curso ({COURSE_STATUS_LABEL[course.status]})</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Estado del curso</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={course.status === "draft"}
                onSelect={() => setStatus("draft")}
              >
                Borrador — solo tú lo ves
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={course.status === "published"}
                onSelect={() => publish()}
              >
                <span className="flex flex-col items-start gap-0.5">
                  <span>Publicar — visible para matriculados</span>
                  {publishBlockers.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <TriangleAlert className="size-3" aria-hidden />
                      {publishBlockers.length === 1
                        ? "1 documento sin procesar"
                        : `${publishBlockers.length} documentos sin procesar`}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={course.status === "archived"}
                onSelect={() => setStatus("archived")}
              >
                Archivar — se oculta sin borrar nada
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <HelpTip topic="course.status" value={{ status: course.status }} />
        </div>
      </div>
    </header>
  );
}
