"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KindChip } from "@/components/kind-meta";
import { sendHeartbeat } from "./heartbeat";
import { RichContent } from "@/components/rich-content";
import { CountdownRing, StudyTimer, formatClock, type StudyTimerState } from "./study-timer";
import type { HeartbeatResponse } from "./types";

const HEARTBEAT_MS = 10_000;

/**
 * Corrección con el servidor sin que el contador «suba» por 1–3 s de latencia:
 * solo se acepta un valor mayor si la diferencia es real.
 */
function reconcile(local: number, server: number): number {
  return server > local && server - local <= 3 ? local : server;
}

/**
 * Lector de ítems de texto (DISENO-UX §2.4): una sola "página" con
 * min_read_seconds; el servidor acredita el tiempo con su reloj. El contador
 * visible corre en el navegador y se corrige con cada latido.
 */
export function TextReader({
  courseId,
  itemId,
  title,
  contentMd,
  minReadSeconds,
  initialCreditedSeconds,
  initialCompleted,
  nextHref,
  courseHref,
  onCompleted,
}: {
  courseId: string;
  itemId: string;
  title: string;
  contentMd: string;
  minReadSeconds: number;
  initialPercent: number;
  initialCreditedSeconds: number;
  initialCompleted: boolean;
  nextHref: string | null;
  courseHref: string;
  onCompleted: () => void;
}) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [remaining, setRemaining] = useState(() =>
    initialCompleted ? 0 : Math.max(0, minReadSeconds - initialCreditedSeconds)
  );
  const [visible, setVisible] = useState(true);
  // Vista previa del maestro: el servidor no registra nada
  const [preview, setPreview] = useState(false);
  const completedRef = useRef(initialCompleted);
  const timed = minReadSeconds > 0;

  const applyResponse = useCallback(
    (res: HeartbeatResponse | null) => {
      if (!res) return;
      if (res.preview) {
        setPreview(true);
        return;
      }
      if (typeof res.creditedSeconds === "number") {
        const server = Math.max(0, minReadSeconds - res.creditedSeconds);
        setRemaining((local) => reconcile(local, server));
      }
      if (res.completed && !completedRef.current) {
        completedRef.current = true;
        setCompleted(true);
        setRemaining(0);
        onCompleted();
      }
    },
    [onCompleted, minReadSeconds]
  );

  const beat = useCallback(async () => {
    const res = await sendHeartbeat({ courseId, itemId, kind: "text" });
    applyResponse(res);
  }, [courseId, itemId, applyResponse]);

  // Con min_read_seconds = 0, un solo latido al montar la completa; si es
  // mayor, latidos cada 10 s (pausados con la pestaña oculta) hasta completar.
  useEffect(() => {
    if (completedRef.current) return;

    let interval: number | null = null;
    const stop = () => {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const start = () => {
      if (interval === null && !completedRef.current) {
        interval = window.setInterval(() => {
          if (completedRef.current) stop();
          else void beat();
        }, HEARTBEAT_MS);
      }
    };
    const onVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      if (isVisible) start();
      else stop();
    };

    void beat();
    if (timed) {
      if (document.visibilityState === "visible") start();
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [beat, timed]);

  // Cuenta regresiva local: solo corre con la pestaña visible (igual que el servidor)
  const counting = timed && !completed && remaining > 0;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [counting]);

  // Al llegar a cero, latido inmediato: el servidor confirma con su reloj
  useEffect(() => {
    if (timed && remaining === 0 && !completedRef.current && !preview) void beat();
  }, [timed, remaining, preview, beat]);

  const previewDone = preview && remaining === 0;
  const timerState: StudyTimerState =
    completed || previewDone
      ? "done"
      : remaining === 0
        ? "syncing"
        : !visible
          ? "paused"
          : "running";
  const percent = completed || !timed ? 100 : Math.round(((minReadSeconds - remaining) / minReadSeconds) * 100);

  const continueHref = nextHref ?? courseHref;
  const continueLabel = nextHref ? "Continuar" : "Volver al curso";

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-full flex-col">
        {/* Barra superior: título + contador del tiempo mínimo de lectura */}
        <div className="border-b bg-card px-4 py-2">
          <div className="flex items-center gap-3">
            <KindChip kind="text" />
            <h2 className="min-w-0 flex-1 truncate font-heading text-sm font-semibold">
              {title}
            </h2>
            {(timed || completed) && (
              <StudyTimer
                remaining={remaining}
                total={minReadSeconds}
                state={timerState}
                caption={`Tiempo mínimo de lectura: ${formatClock(minReadSeconds)}`}
                pausedHint="Se reanuda al volver a esta pestaña"
                doneLabel={previewDone && !completed ? "Tiempo cumplido" : "Lectura completada"}
                doneCaption={previewDone && !completed ? "Vista previa: no se registra" : undefined}
              />
            )}
          </div>
          {!completed && timed && (
            <Progress value={percent} className="mt-2 h-1" aria-label={`Lectura al ${percent}%`} />
          )}
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-auto">
          <article className="mx-auto max-w-2xl space-y-4 p-6 text-base md:p-8">
            {contentMd.trim() ? (
              <RichContent content={contentMd} />
            ) : (
              <p className="text-muted-foreground">Esta lectura aún no tiene contenido.</p>
            )}

            <div className="pt-4">
              {completed || previewDone ? (
                <Button
                  asChild
                  className="anim-pop h-11 min-w-36 bg-cta text-cta-foreground hover:bg-cta/90"
                >
                  <Link href={continueHref}>
                    {continueLabel}
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex rounded-lg">
                      <Button className="h-11 min-w-36" disabled aria-disabled="true">
                        {timed && remaining > 0 && (
                          <CountdownRing remaining={remaining} total={minReadSeconds} />
                        )}
                        Continuar
                        <ChevronRight aria-hidden />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {remaining > 0
                      ? `Podrás continuar en ${formatClock(remaining)}: es el tiempo mínimo de lectura`
                      : "Un momento… estamos registrando tu lectura"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </article>
        </div>
      </div>
    </TooltipProvider>
  );
}
