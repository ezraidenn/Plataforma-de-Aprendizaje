"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "../use-scene-clock";
import { MiniFileChip } from "../mini/assignment";
import {
  COVER_PLACEMENT_CYCLE_MS,
  coverPlacementStory,
  STORAGE_CYCLE_MS,
  STORAGE_TREE,
  storageStory,
  type CoverPlacement,
} from "./admin.story";

export function StorageScene() {
  const phase = useSceneClock(STORAGE_CYCLE_MS);
  const s = storageStory(phase);
  const lesson = s.upload === "lesson";
  return (
    <div className="absolute inset-0 grid grid-cols-[0.85fr_1.35fr] gap-2 bg-slate-50 p-2.5 text-[11px]">
      <div className="flex min-w-0 flex-col justify-center gap-1.5 rounded-lg border bg-white p-2">
        <p className="text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-slate-400">{lesson ? "Tú subes" : "El alumno entrega"}</p>
        <div key={s.upload} className="animate-in fade-in space-y-1 duration-300">
          <MiniFileChip name={lesson ? "Manual del participante.pdf" : "plan-evacuacion.pdf"} />
          <p className="text-[9px] leading-snug text-slate-500">{lesson ? "Lección 2 del Módulo 1" : "Tarea «Plan de evacuación»"}</p>
        </div>
      </div>
      <div className="min-w-0 overflow-hidden rounded-lg border bg-white p-1.5 font-mono text-[9px] leading-[17px]">
        {STORAGE_TREE.slice(0, s.shown).map((node, i) => (
          <div
            key={i}
            className={cn("flex animate-in fade-in items-center gap-1 rounded px-1 duration-300", i === s.highlight && "bg-indigo-50 font-bold text-cta")}
            style={{ paddingLeft: 4 + node.depth * 9 }}
          >
            <span aria-hidden>{node.kind === "file" ? "📄" : node.kind === "root" ? "🗄" : "📁"}</span>
            <span className="truncate">{node.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PLACEMENTS: readonly (readonly [CoverPlacement, string])[] = [
  ["login", "Inicio de sesión"],
  ["dashboard", "Panel de inicio"],
  ["both", "Ambas"],
];

/** «Foto» de portada de la empresa en las escenas. */
function CoverPhoto({ on }: { on: boolean }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,#155e75,#0ea5e9_60%,#fde68a)] text-3xl transition-opacity duration-700",
        on ? "opacity-100" : "opacity-0"
      )}
    >
      <span className="opacity-70" aria-hidden>
        🏭
      </span>
    </div>
  );
}

export function CoverPlacementScene({ value }: { value: { placement: CoverPlacement } }) {
  const phase = useSceneClock(COVER_PLACEMENT_CYCLE_MS);
  const s = coverPlacementStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2.5 bg-white p-2.5 text-[11px]">
      <div className="flex gap-0.5 self-center rounded-full bg-slate-100 p-0.5 text-[9.5px] font-extrabold">
        {PLACEMENTS.map(([placement, label]) => (
          <span
            key={placement}
            className={cn("relative rounded-full px-2 py-0.5 transition-all duration-300", s.active === placement ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
          >
            {label}
            {value.placement === placement && (
              <span className="absolute -right-1 -top-2.5 whitespace-nowrap rounded-full bg-cta px-1 text-[7px] font-bold text-white">tu ajuste</span>
            )}
          </span>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2">
        <div className="relative overflow-hidden rounded-lg border bg-[linear-gradient(160deg,#0f172a_0%,#1e1b4b_55%,#312e81_100%)]">
          <CoverPhoto on={s.inLogin} />
          <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 space-y-1.5 rounded-md bg-white/95 p-2 shadow">
            <b className="block text-[9.5px]">Iniciar sesión</b>
            <span className="block h-2.5 rounded bg-slate-100" />
            <span className="block h-2.5 rounded bg-slate-100" />
            <span className="block h-3 rounded bg-cta" />
          </div>
          <span className="absolute bottom-1 left-1.5 text-[8px] font-bold text-white/90">Inicio de sesión</span>
        </div>
        <div className="relative flex flex-col overflow-hidden rounded-lg border bg-slate-50">
          <div className="relative h-14 shrink-0 bg-slate-200">
            <CoverPhoto on={s.inDashboard} />
            <b
              className={cn(
                "absolute bottom-1 left-2 text-[9.5px] transition-colors duration-700",
                s.inDashboard ? "text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]" : "text-slate-600"
              )}
            >
              Hola, Laura
            </b>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-1 p-1.5">
            <span className="rounded bg-white shadow-sm" />
            <span className="rounded bg-white shadow-sm" />
          </div>
          <span className="absolute bottom-1 left-1.5 text-[8px] font-bold text-slate-500">Panel de inicio</span>
        </div>
      </div>
    </div>
  );
}
