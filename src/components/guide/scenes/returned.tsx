"use client";

import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniButton } from "@/components/help/mini/basics";
import { MiniFileChip, MiniNotice, MiniSubmissionBadge } from "@/components/help/mini/assignment";
import { RETURNED_CYCLE_MS, returnedStory } from "./returned.story";

/** La entrega vuelve con comentarios, se corrige y termina calificada. */
export function ReturnedScene() {
  const phase = useSceneClock(RETURNED_CYCLE_MS);
  const s = returnedStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b className="truncate text-[12px]">Croquis de extintores</b>
        <MiniSubmissionBadge
          kind={s.stage === "graded" ? "graded" : s.stage === "submitted" ? "submitted" : "returned"}
        />
      </div>

      <div className="flex items-center gap-2">
        <MiniFileChip name={s.fileName} />
        {s.stage === "resubmitting" && (
          <span className="text-[9.5px] font-semibold text-cta">corregido</span>
        )}
      </div>

      {s.comment && (
        <MiniNotice tone={s.stage === "graded" ? "warn" : "bad"}>
          <b>Instructor:</b> {s.comment}
        </MiniNotice>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        {s.score !== null ? (
          <b className="text-[12px] text-green-700">{s.score} / 100 puntos</b>
        ) : (
          <span className="text-[9.5px] leading-snug text-slate-500">
            {s.stage === "returned" ? "Puedes corregir y volver a entregar." : "Entrega recibida."}
          </span>
        )}
        {s.stage === "resubmitting" && (
          <MiniButton variant="primary" className="shrink-0">
            Volver a entregar
          </MiniButton>
        )}
      </div>
    </div>
  );
}
