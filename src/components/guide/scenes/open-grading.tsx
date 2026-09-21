"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge, MiniButton, MiniToast } from "@/components/help/mini/basics";
import {
  OPEN_GRADING_CYCLE_MS,
  OPEN_GRADING_MAX_POINTS,
  openGradingStory,
} from "./open-grading.story";

/** Preguntas abiertas: puntos, intento calificado y aviso al alumno. */
export function OpenGradingScene() {
  const phase = useSceneClock(OPEN_GRADING_CYCLE_MS);
  const s = openGradingStory(phase, true);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b className="truncate text-[12px]">Ana Ruiz · Evaluación parcial</b>
        {s.stage === "finalized" ? (
          <MiniBadge tone="ok">Calificado · {s.finalPercent}%</MiniBadge>
        ) : (
          <MiniBadge tone="warn">En revisión</MiniBadge>
        )}
      </div>

      <div className="rounded-lg border px-2.5 py-2 leading-snug">
        <b className="block text-[10.5px]">¿Cuándo NO debes usar un extintor?</b>
        <p className="mt-1 text-[10px] text-slate-600">
          «Cuando el fuego ya alcanzó el techo o hay humo denso: ahí toca evacuar y llamar a
          los bomberos.»
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="text-slate-500">Puntos:</span>
          <span
            className={cn(
              "inline-flex h-[22px] w-[48px] items-center justify-center rounded-md border bg-white font-bold tabular-nums transition-all duration-300",
              s.stage === "scoring" && "border-cta shadow-[0_0_0_3px_rgb(79_70_229/0.15)]"
            )}
          >
            {s.points ?? "—"} / {OPEN_GRADING_MAX_POINTS}
          </span>
        </span>
        {s.stage !== "finalized" && (
          <MiniButton variant="primary" glow={s.stage === "scoring"} className="shrink-0">
            Calificar y siguiente
          </MiniButton>
        )}
      </div>

      <MiniToast show={s.stage === "finalized"}>
        {s.notice === "grade"
          ? "Se avisó a Ana: calificación publicada"
          : "Resultados ocultos: el aviso llega al publicarlos"}
      </MiniToast>
    </div>
  );
}
