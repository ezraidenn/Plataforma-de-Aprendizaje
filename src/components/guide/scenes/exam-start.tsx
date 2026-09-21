"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniButton } from "@/components/help/mini/basics";
import { MiniCursor } from "@/components/help/mini/cursor";
import { EXAM_START_CYCLE_MS, EXAM_START_FACTS, examStartStory } from "./exam-start.story";

/** Antes de comenzar: repasa los datos del examen y arranca el intento. */
export function ExamStartScene() {
  const phase = useSceneClock(EXAM_START_CYCLE_MS);
  const s = examStartStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-extrabold text-cta">EXAMEN</span>
        <b className="text-[12px]">Evaluación parcial</b>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {EXAM_START_FACTS.map((fact, i) => (
          <div
            key={fact.label}
            className={cn(
              "rounded-lg border px-2 py-1.5 transition-all duration-300",
              s.highlighted === i
                ? "border-cta bg-indigo-50 shadow-[0_0_0_3px_rgb(79_70_229/0.15)]"
                : "bg-white"
            )}
          >
            <span className="block text-[9px] uppercase tracking-wide text-slate-400">{fact.label}</span>
            <b className="text-[12px] text-slate-900">{fact.value}</b>
          </div>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[9.5px] leading-snug text-slate-500">
          {s.started ? "⏱ 09:58 restantes — el reloj ya corre" : "El reloj empieza al comenzar."}
        </span>
        <span className="relative shrink-0">
          <MiniButton
            variant="primary"
            glow={s.cursorAtButton && !s.pressed}
            className={cn(s.pressed && "scale-95")}
          >
            {s.started ? "Intento en curso" : "Comenzar intento"}
          </MiniButton>
          <MiniCursor at={s.cursorAtButton} pressed={s.pressed} />
        </span>
      </div>
    </div>
  );
}
