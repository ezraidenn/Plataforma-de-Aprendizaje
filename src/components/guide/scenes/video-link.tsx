"use client";

import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge } from "@/components/help/mini/basics";
import { MiniVideoPlayer } from "@/components/help/mini/player";
import { VIDEO_LINK_CYCLE_MS, videoLinkStory } from "./video-link.story";

/** Video: se pega el enlace, se reconoce y el alumno ve el reproductor. */
export function VideoLinkScene() {
  const phase = useSceneClock(VIDEO_LINK_CYCLE_MS);
  const s = videoLinkStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="space-y-1">
        <span className="block text-[9.5px] font-semibold text-slate-500">Enlace del video</span>
        <div className="flex items-center gap-2">
          <span className="flex h-[26px] min-w-0 flex-1 items-center rounded-lg border bg-white px-2 font-mono text-[10px]">
            <span className="truncate">{s.typed}</span>
            {!s.recognized && <span className="ml-px inline-block w-[1px] animate-pulse bg-slate-900">&nbsp;</span>}
          </span>
          {s.recognized && <MiniBadge tone="ok">Enlace válido</MiniBadge>}
        </div>
      </div>

      {s.preview ? (
        <div className="flex flex-1 items-center gap-2">
          <MiniVideoPlayer position={s.studentProgress} rate={1} className="h-[96px] flex-1" />
          <span className="w-[86px] shrink-0 text-[9.5px] leading-snug text-slate-500">
            Así lo ve el alumno: solo cuentan los tramos vistos.
          </span>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-[9.5px] text-slate-400">
          {s.recognized ? "Cargando vista previa…" : "Pega el enlace de YouTube"}
        </div>
      )}
    </div>
  );
}
