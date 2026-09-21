"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniButton } from "@/components/help/mini/basics";
import { MiniModuleHeader } from "@/components/help/mini/course";
import { MiniCursor } from "@/components/help/mini/cursor";
import { TREE_EDIT_CYCLE_MS, treeEditStory } from "./tree-edit.story";

/** El árbol del curso: se agrega una lección y se arrastra a su lugar. */
export function TreeEditScene() {
  const phase = useSceneClock(TREE_EDIT_CYCLE_MS);
  const s = treeEditStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col bg-white text-[11px]">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span className="min-w-0 leading-tight">
          <b className="block text-[11.5px]">Contenido del curso</b>
          <span className="block truncate text-[9px] text-slate-500">
            {s.stage === "menu"
              ? "Elige qué agregar: carpeta o tipo de lección."
              : s.stage === "added"
                ? "Se inserta al final de la carpeta."
                : s.stage === "dragging"
                  ? "Arrástrala a su lugar…"
                  : "La numeración se reacomoda sola."}
          </span>
        </span>
        <span className="relative">
          <MiniButton variant="primary" glow={s.stage === "menu"}>
            + Agregar
          </MiniButton>
          {s.stage === "menu" && (
            <span className="absolute right-0 top-full z-10 mt-1 w-[104px] animate-in fade-in rounded-lg border bg-white p-1 text-[9.5px] shadow-lg duration-200">
              <span className="block rounded px-1.5 py-0.5 text-slate-500">Carpeta</span>
              <span className="block rounded bg-indigo-50 px-1.5 py-0.5 font-bold text-cta">Video</span>
              <span className="block rounded px-1.5 py-0.5 text-slate-500">Examen</span>
            </span>
          )}
        </span>
      </div>

      <div className="mx-2.5 overflow-hidden rounded-lg border">
        <MiniModuleHeader>Módulo 1 — Fundamentos del fuego</MiniModuleHeader>
        {s.rows.map((row, i) => (
          <div
            key={row.title}
            className={cn(
              "relative flex items-center gap-2 border-t border-slate-100 px-2.5 py-1 transition-all duration-500",
              row.isNew && "bg-emerald-50 shadow-[inset_3px_0_0_#16a34a]",
              s.dragging === i && "z-10 scale-[1.02] shadow-md"
            )}
          >
            <span className="w-3 shrink-0 text-center text-[10px] text-slate-400">⠿</span>
            <span className="w-3 shrink-0 text-center text-[10px] font-bold tabular-nums text-slate-400">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[11px]">{row.title}</b>
              <span className="block truncate text-[9px] text-slate-500">{row.meta}</span>
            </span>
            {s.dragging === i && <MiniCursor at pressed />}
          </div>
        ))}
      </div>

    </div>
  );
}
