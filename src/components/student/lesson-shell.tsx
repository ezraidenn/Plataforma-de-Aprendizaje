"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  Link2,
  Play,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AssignmentView } from "./assignment-view";
import { DocumentViewer } from "./document-viewer";
import { ExamRunner } from "./exam-runner";
import { LinkView } from "./link-view";
import { ResourceView } from "./resource-view";
import { TextReader } from "./text-reader";
import { VideoPlayer } from "./video-player";
import type { LessonData, LessonNav } from "./types";

/**
 * Chasis de la lección en Focus Mode: despacha el visor según el tipo y
 * pinta la barra inferior fija [← Anterior] [Siguiente →] (DISENO-UX §2.3).
 */
export function LessonShell({
  courseId,
  itemId,
  itemTitle,
  courseHref,
  prev,
  next,
  initialCompleted,
  lesson,
}: {
  courseId: string;
  itemId: string;
  itemTitle: string;
  courseHref: string;
  prev: LessonNav | null;
  next: LessonNav | null;
  initialCompleted: boolean;
  lesson: LessonData;
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);
  const completedRef = useRef(initialCompleted);

  const handleCompleted = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleted(true);
    toast.success("Lección completada");
    // Refresca el árbol y la barra de progreso global (server components)
    router.refresh();
  }, [router]);

  // Examen enviado: el ítem queda "Completado" (≠ aprobado) sin toast de
  // lección — el ExamRunner ya comunica el resultado en pantalla.
  const handleExamSubmitted = useCallback(() => {
    completedRef.current = true;
    setCompleted(true);
    router.refresh();
  }, [router]);

  // Tarea entregada: el servicio ya marcó el ítem completado; AssignmentView
  // muestra su propio toast ("Tarea entregada"), aquí solo se refresca.
  const handleAssignmentSubmitted = useCallback(() => {
    completedRef.current = true;
    setCompleted(true);
    router.refresh();
  }, [router]);

  // "Siguiente" se habilita si el siguiente ítem no está bloqueado, o si el
  // bloqueo dependía de completar el actual y ya se completó.
  const nextEnabled = next !== null && (!next.locked || completed);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {lesson.kind === "document" ? (
          <DocumentViewer
            courseId={courseId}
            itemId={itemId}
            title={itemTitle}
            fileUrl={lesson.fileUrl}
            pageCount={lesson.pageCount}
            minSecondsPerPage={lesson.minSecondsPerPage}
            initialPage={lesson.initialPage}
            initialCreditedPages={lesson.initialCreditedPages}
            onCompleted={handleCompleted}
          />
        ) : lesson.kind === "text" ? (
          <TextReader
            courseId={courseId}
            itemId={itemId}
            title={itemTitle}
            contentMd={lesson.contentMd}
            minReadSeconds={lesson.minReadSeconds}
            initialPercent={lesson.initialPercent}
            initialCreditedSeconds={lesson.initialCreditedSeconds}
            initialCompleted={initialCompleted}
            nextHref={next ? next.href : null}
            courseHref={courseHref}
            onCompleted={handleCompleted}
          />
        ) : lesson.kind === "exam" ? (
          <ExamRunner
            courseId={courseId}
            itemId={itemId}
            title={itemTitle}
            data={lesson}
            courseHref={courseHref}
            nextHref={next ? next.href : null}
            onSubmitted={handleExamSubmitted}
          />
        ) : lesson.kind === "video" ? (
          <VideoPlayer
            courseId={courseId}
            itemId={itemId}
            title={itemTitle}
            data={lesson}
            onCompleted={handleCompleted}
          />
        ) : lesson.kind === "document-unavailable" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <TriangleAlert className="size-10 text-warning" aria-hidden />
            <p className="max-w-sm text-muted-foreground">
              Este documento se está preparando. Vuelve a intentarlo en unos
              minutos.
            </p>
          </div>
        ) : lesson.kind === "exam-unavailable" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-kind-exam-tint text-kind-exam">
              <FileQuestion className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-muted-foreground">
              Este examen se está preparando. Tu instructor lo publicará pronto.
            </p>
          </div>
        ) : lesson.kind === "video-unavailable" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-kind-video-tint text-kind-video">
              <Play className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-muted-foreground">
              Este video se está preparando. Tu instructor agregará el enlace
              pronto.
            </p>
          </div>
        ) : lesson.kind === "link" ? (
          <LinkView
            courseId={courseId}
            itemId={itemId}
            title={itemTitle}
            data={lesson}
            nextHref={next ? next.href : null}
            courseHref={courseHref}
            onCompleted={handleCompleted}
          />
        ) : lesson.kind === "resource" ? (
          <ResourceView
            courseId={courseId}
            itemId={itemId}
            title={itemTitle}
            data={lesson}
            nextHref={next ? next.href : null}
            courseHref={courseHref}
            onCompleted={handleCompleted}
          />
        ) : lesson.kind === "link-unavailable" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-kind-link-tint text-kind-link">
              <Link2 className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-muted-foreground">
              Este enlace se está preparando. Tu instructor lo agregará pronto.
            </p>
          </div>
        ) : lesson.kind === "assignment" ? (
          <AssignmentView
            courseId={courseId}
            itemId={itemId}
            title={itemTitle}
            data={lesson}
            onSubmitted={handleAssignmentSubmitted}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-kind-assignment-tint text-kind-assignment">
              <Upload className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-muted-foreground">
              Esta tarea se está preparando. Tu instructor la publicará pronto.
            </p>
          </div>
        )}
      </div>

      {/* Barra inferior fija */}
      <TooltipProvider delayDuration={100}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-4 py-2 shadow-[0_-1px_2px_rgb(15_23_42/0.04)]">
          {prev ? (
            <Button asChild variant="outline" className="h-11 min-w-28">
              <Link href={prev.href} aria-label={`Lección anterior: ${prev.title}`}>
                <ChevronLeft aria-hidden />
                Anterior
              </Link>
            </Button>
          ) : (
            <Button variant="outline" className="h-11 min-w-28" disabled>
              <ChevronLeft aria-hidden />
              Anterior
            </Button>
          )}

          {next === null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex rounded-lg">
                  <Button className="h-11 min-w-28" disabled aria-disabled="true">
                    Siguiente
                    <ChevronRight aria-hidden />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Es la última lección del curso</TooltipContent>
            </Tooltip>
          ) : nextEnabled ? (
            <Button
              asChild
              className="anim-pop h-11 min-w-28 bg-cta text-cta-foreground hover:bg-cta/90"
            >
              <Link href={next.href} aria-label={`Siguiente lección: ${next.title}`}>
                Siguiente
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex rounded-lg">
                  <Button className="h-11 min-w-28" disabled aria-disabled="true">
                    Siguiente
                    <ChevronRight aria-hidden />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                Completa esta lección para continuar
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}
