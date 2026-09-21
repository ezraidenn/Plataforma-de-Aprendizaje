"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, CircleCheck, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KindChip } from "@/components/kind-meta";
import { markResourceDownloadedAction } from "@/server/actions/student-resources";
import { DownloadList } from "./download-list";
import type { ResourceLessonData } from "./types";

/**
 * Visor de recurso descargable: lista de archivos; al descargar cualquiera
 * el ítem queda completado (optimista aquí; /api/files también lo marca en el
 * servidor, así que el estado converge aunque falle la action).
 */
export function ResourceView({
  courseId,
  itemId,
  title,
  data,
  nextHref,
  courseHref,
  onCompleted,
}: {
  courseId: string;
  itemId: string;
  title: string;
  data: ResourceLessonData;
  nextHref: string | null;
  courseHref: string;
  onCompleted: () => void;
}) {
  const [completed, setCompleted] = useState(data.initialCompleted);
  const completedRef = useRef(data.initialCompleted);

  function handleDownload() {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleted(true);
    void markResourceDownloadedAction({ courseId, itemId }).then((res) => {
      // La descarga por /api/files ya marca el avance en el servidor; si la
      // action falla no se revierte el estado visual.
      if (!("error" in res)) onCompleted();
    });
  }

  const continueHref = nextHref ?? courseHref;
  const continueLabel = nextHref ? "Siguiente lección" : "Volver al curso";

  return (
    <div className="h-full overflow-auto">
      <div className="anim-rise mx-auto max-w-2xl space-y-6 p-6 md:p-8">
        <div className="flex items-center gap-3">
          <KindChip kind="resource" size="lg" />
          <h2 className="min-w-0 flex-1 font-heading text-xl font-semibold">{title}</h2>
          {completed && (
            <p
              className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-success"
              aria-live="polite"
            >
              <CircleCheck className="size-4" aria-hidden />
              Visto
            </p>
          )}
        </div>

        {data.files.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-kind-resource-tint text-kind-resource">
              <FolderDown className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-muted-foreground">
              Este recurso aún no tiene archivos. Tu instructor los agregará pronto.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <DownloadList
              files={data.files}
              onDownload={handleDownload}
              ariaLabel="Archivos del recurso"
            />
            {!completed && (
              <p className="text-sm text-muted-foreground">
                Descarga cualquiera para marcar este recurso como visto.
              </p>
            )}
          </div>
        )}

        {completed && (
          <Button
            asChild
            className="anim-pop h-11 min-w-40 bg-cta text-cta-foreground hover:bg-cta/90"
          >
            <Link href={continueHref}>
              {continueLabel}
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
