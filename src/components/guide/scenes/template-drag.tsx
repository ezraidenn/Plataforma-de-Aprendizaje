"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniCursor } from "@/components/help/mini/cursor";
import { TEMPLATE_DRAG_CYCLE_MS, templateDragStory } from "./template-drag.story";

/** Plantilla: se arrastra el campo «Nombre» y las guías lo alinean al centro. */
export function TemplateDragScene() {
  const phase = useSceneClock(TEMPLATE_DRAG_CYCLE_MS);
  const s = templateDragStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[12px]">Plantilla del certificado</b>
        <span className="text-[9.5px] text-slate-500">
          {s.snapped ? "Centrado" : s.centerGuide ? "Imán al centro" : "Arrastra el campo"}
        </span>
      </div>

      {/* Lienzo del diploma */}
      <div className="relative flex-1 overflow-hidden rounded-md border-2 border-brand-deep bg-[#fffdf7]">
        <div className="pt-2 text-center text-[7.5px] tracking-[0.2em] text-amber-700">CONSTANCIA</div>

        {/* Guía roja del centro */}
        <span
          className={cn(
            "absolute inset-y-0 left-1/2 w-px bg-red-500 transition-opacity duration-200",
            s.centerGuide ? "opacity-100" : "opacity-0"
          )}
        />

        {/* Campo que se arrastra */}
        <span
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded border-2 border-dashed px-2 py-0.5 font-serif text-[11px] font-bold transition-[border-color,box-shadow] duration-200",
            s.dragging ? "border-cta bg-white shadow-md" : "border-slate-300 bg-white/80",
            s.snapped && "border-green-500"
          )}
          style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
        >
          Laura Pérez
          {s.dragging && <MiniCursor at pressed />}
        </span>

        {/* Cota en mm hacia el centro */}
        {s.mm !== null && (
          <span
            className="absolute -translate-y-1/2 rounded bg-blue-600 px-1 py-px text-[8px] font-bold text-white transition-all duration-200"
            style={{ left: `${Math.min(s.x, 0.5) * 100 + 2}%`, top: `${(s.y + 0.16) * 100}%` }}
          >
            {s.mm} mm
          </span>
        )}
      </div>

      <p className="text-[9.5px] leading-snug text-slate-500">
        Guías rojas al alinear, cotas en mm y flechas para mover 1 pt.
      </p>
    </div>
  );
}
