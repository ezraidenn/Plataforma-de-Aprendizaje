"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniToast } from "@/components/help/mini/basics";
import { MiniCursor } from "@/components/help/mini/cursor";
import {
  REASSIGN_OWNER_CYCLE_MS,
  REASSIGN_TO,
  reassignOwnerStory,
} from "./reassign-owner.story";

/** Reasignar el dueño: cambia el maestro, no el historial de los alumnos. */
export function ReassignOwnerScene() {
  const phase = useSceneClock(REASSIGN_OWNER_CYCLE_MS);
  const s = reassignOwnerStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="relative rounded-lg border px-2.5 py-2">
        <b className="block truncate text-[11.5px]">Uso y Manejo de Extintores</b>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px]">
          <span className="text-slate-500">Dueño:</span>
          <b className={cn("transition-colors duration-500", s.done && "text-cta")}>{s.owner}</b>
        </span>

        {s.picking && (
          <span className="absolute right-2 top-8 z-10 w-[132px] animate-in fade-in rounded-lg border bg-white p-1 text-[9.5px] shadow-lg duration-200">
            <span className="block rounded px-1.5 py-0.5 text-slate-500">Prof. Luis Márquez</span>
            <span className="relative block rounded bg-indigo-50 px-1.5 py-0.5 font-bold text-cta">
              {REASSIGN_TO}
              <MiniCursor at pressed />
            </span>
          </span>
        )}
      </div>

      <div className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-[10px] text-green-800">
        No cambia nada del alumnado: {s.keeps.students} alumnos · {s.keeps.percent}% de avance ·{" "}
        {s.keeps.certificates} certificados
      </div>

      <p className="mt-auto text-[9.5px] leading-snug text-slate-500">
        {s.done
          ? "El curso ya es de su nuevo dueño; sigue igual para los alumnos."
          : "Menú ⋯ → Reasignar, y eliges al maestro que lo recibe."}
      </p>

      <MiniToast show={s.done}>Curso reasignado</MiniToast>
    </div>
  );
}
