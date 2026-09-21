"use client";

import { cn } from "@/lib/utils";
import { KindChip } from "@/components/kind-meta";
import { useSceneClock } from "../use-scene-clock";
import { MiniVideoPlayer } from "../mini/player";
import { SPEED_CYCLE_MS, videoSpeedStory } from "./content.story";

export function VideoSpeedScene({ value }: { value: { allowed: boolean } }) {
  const phase = useSceneClock(SPEED_CYCLE_MS);
  const s = videoSpeedStory(phase, value.allowed);
  const note = s.snapBack ? "↺ regresa a 1x" : value.allowed && s.rate === 2 ? "» al doble de velocidad" : null;
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <div className="flex items-center gap-2 border-b px-2.5 py-1.5 text-[11px]">
        <KindChip kind="video" />
        <span className="min-w-0 flex-1 truncate font-bold">Uso correcto del extintor</span>
      </div>
      <div className="relative flex-1 p-2.5">
        <MiniVideoPlayer className="h-full" position={s.position} rate={s.rate} menuOpen={s.menuOpen} alert={s.snapBack} />
        <span
          className={cn(
            "absolute left-4 top-4 rounded-md border border-dashed border-cta bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-cta transition-opacity duration-300",
            note ? "opacity-100" : "opacity-0"
          )}
        >
          {note ?? " "}
        </span>
      </div>
    </div>
  );
}
