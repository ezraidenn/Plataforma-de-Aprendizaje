"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniButton, MiniToast } from "@/components/help/mini/basics";
import { GRADING_QUEUE_CYCLE_MS, gradingQueueStory } from "./grading-queue.story";

/** Cola de «Por calificar»: puntos y «Calificar y siguiente». */
export function GradingQueueScene() {
  const phase = useSceneClock(GRADING_QUEUE_CYCLE_MS);
  const s = gradingQueueStory(phase);
  const open = s.pending[0];
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[12px]">Por calificar</b>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9.5px] font-extrabold text-amber-700">
          {s.pending.length} pendientes
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {s.pending.map((p, i) => (
          <div
            key={`${p.student}-${p.item}`}
            className={cn(
              "flex items-center gap-2 border-t border-slate-100 px-2.5 py-1 first:border-t-0",
              i === 0 && "bg-amber-50"
            )}
          >
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[10.5px]">{p.student}</b>
              <span className="block truncate text-[9px] text-slate-500">{p.item}</span>
            </span>
            {i === 0 && (
              <span className="shrink-0 text-[9px] font-extrabold text-amber-700">abierta</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="text-slate-500">Puntos de {open?.student ?? "—"}:</span>
          <span
            className={cn(
              "inline-flex h-[22px] w-[52px] items-center justify-center rounded-md border bg-white font-bold tabular-nums transition-all duration-300",
              s.stage === "scoring" && "border-cta shadow-[0_0_0_3px_rgb(79_70_229/0.15)]"
            )}
          >
            {s.score ?? "—"} / 100
          </span>
        </span>
        <MiniButton variant="primary" glow={s.stage === "scoring"} className="shrink-0">
          Calificar y siguiente
        </MiniButton>
      </div>

      <MiniToast show={s.stage === "saved"}>Calificada · sigue la siguiente</MiniToast>
    </div>
  );
}
