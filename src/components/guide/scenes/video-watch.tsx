"use client";

import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniVideoPlayer, MiniWatchedBar } from "@/components/help/mini/player";
import { MiniBadge } from "@/components/help/mini/basics";
import { VIDEO_WATCH_CYCLE_MS, videoWatchStory, watchedPercent } from "./video-watch.story";

/** Solo cuentan los tramos vistos: adelantar deja un hueco que falta por ver. */
export function VideoWatchScene() {
  const phase = useSceneClock(VIDEO_WATCH_CYCLE_MS);
  const s = videoWatchStory(phase);
  const percent = watchedPercent(s);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <MiniVideoPlayer position={s.position} rate={1} className="h-[104px]" />
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-600">Lo que llevas visto</span>
          <span className="font-bold tabular-nums text-slate-900">{percent}%</span>
        </div>
        <MiniWatchedBar watched={s.watched} position={s.note === "missing" ? null : s.position} />
      </div>
      <p className="flex items-center gap-1.5 text-[10.5px] leading-snug">
        {s.note === "playing" && (
          <>
            <MiniBadge tone="ok">Cuenta</MiniBadge>
            <span className="text-slate-600">Mientras ves contenido nuevo, el avance sube.</span>
          </>
        )}
        {s.note === "skipped" && (
          <>
            <MiniBadge tone="warn">No cuenta</MiniBadge>
            <span className="text-slate-600">Adelantaste: ese tramo queda sin ver.</span>
          </>
        )}
        {s.note === "missing" && (
          <>
            <MiniBadge tone="bad">Te falta</MiniBadge>
            <span className="text-slate-600">El video terminó, pero falta el tramo que saltaste.</span>
          </>
        )}
      </p>
    </div>
  );
}
