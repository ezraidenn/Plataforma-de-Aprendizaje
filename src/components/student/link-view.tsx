"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, CircleCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { KindChip } from "@/components/kind-meta";
import { markLinkOpenedAction } from "@/server/actions/student-resources";
import type { LinkLessonData } from "./types";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Visor de enlace externo: tarjeta con la URL y botón "Abrir enlace" (pestaña
 * nueva). Al abrirlo el servidor marca el ítem como completado (canAccess
 * se revalida allá) y se habilita "Siguiente lección".
 */
export function LinkView({
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
  data: LinkLessonData;
  nextHref: string | null;
  courseHref: string;
  onCompleted: () => void;
}) {
  const [completed, setCompleted] = useState(data.initialCompleted);
  const completedRef = useRef(data.initialCompleted);

  function handleOpen() {
    if (completedRef.current) return;
    // Optimista: el enlace ya se abrió en otra pestaña
    completedRef.current = true;
    setCompleted(true);
    void markLinkOpenedAction({ courseId, itemId }).then((res) => {
      if ("error" in res) {
        completedRef.current = false;
        setCompleted(false);
        toast.error(res.error);
        return;
      }
      onCompleted();
    });
  }

  const continueHref = nextHref ?? courseHref;
  const continueLabel = nextHref ? "Siguiente lección" : "Volver al curso";

  return (
    <div className="h-full overflow-auto">
      <div className="anim-rise mx-auto max-w-2xl space-y-6 p-6 md:p-8">
        <div className="space-y-5 rounded-2xl border bg-card p-6 md:p-8">
          <div className="flex items-start gap-4">
            <KindChip kind="link" size="lg" />
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="font-heading text-xl font-semibold">{title}</h2>
              <p className="truncate text-sm text-muted-foreground" title={data.url}>
                {domainOf(data.url)}
              </p>
            </div>
          </div>

          {data.description.trim() && (
            <p className="whitespace-pre-line text-base">{data.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              asChild
              className="h-11 min-w-44 bg-cta text-cta-foreground hover:bg-cta/90"
            >
              <a href={data.url} target="_blank" rel="noopener noreferrer" onClick={handleOpen}>
                <ExternalLink aria-hidden />
                Abrir enlace
              </a>
            </Button>
            {completed ? (
              <p
                className="flex items-center gap-1.5 text-sm font-medium text-success"
                aria-live="polite"
              >
                <CircleCheck className="size-4" aria-hidden />
                Visto
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Se abre en una pestaña nueva y se marca como visto.
              </p>
            )}
          </div>
        </div>

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
