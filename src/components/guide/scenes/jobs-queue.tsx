"use client";

import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge, MiniButton } from "@/components/help/mini/basics";
import { MiniCursor } from "@/components/help/mini/cursor";
import { JOBS_QUEUE_CYCLE_MS, jobsQueueStory, type JobRow } from "./jobs-queue.story";

const STATUS: Record<JobRow["status"], { tone: "ok" | "warn" | "bad" | "muted"; text: string }> = {
  pending: { tone: "muted", text: "En cola" },
  running: { tone: "warn", text: "En proceso" },
  done: { tone: "ok", text: "Terminado" },
  error: { tone: "bad", text: "Error" },
};

/** La cola de trabajos avanza sola; lo que falla se reintenta. */
export function JobsQueueScene() {
  const phase = useSceneClock(JOBS_QUEUE_CYCLE_MS);
  const s = jobsQueueStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <b className="text-[12px]">Trabajos en segundo plano</b>

      <div className="overflow-hidden rounded-lg border">
        {s.jobs.map((job) => (
          <div key={job.title} className="border-t border-slate-100 px-2.5 py-1.5 first:border-t-0">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">{job.title}</span>
              <MiniBadge tone={STATUS[job.status].tone}>{STATUS[job.status].text}</MiniBadge>
              {job.status === "error" && (
                <span className="relative shrink-0">
                  <MiniButton glow={s.retrying}>Reintentar</MiniButton>
                  <MiniCursor at={s.retrying} pressed={s.retrying} />
                </span>
              )}
            </div>
            {job.status === "running" && (
              <div className="mt-1 h-[5px] w-full overflow-hidden rounded-full bg-slate-200">
                <span
                  className="block h-full rounded-full bg-amber-500 transition-[width] duration-200"
                  style={{ width: `${Math.round(Math.min(1, job.progress) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-auto text-[9.5px] leading-snug text-slate-500">
        La plataforma los hace sola, uno por uno. Si algo falla, queda en «Error» con su motivo.
      </p>
    </div>
  );
}
