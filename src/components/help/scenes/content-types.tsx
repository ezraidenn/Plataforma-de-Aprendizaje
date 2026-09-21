"use client";

import { cn } from "@/lib/utils";
import { KIND_META, KindChip } from "@/components/kind-meta";
import { useSceneClock } from "../use-scene-clock";
import { MiniButton } from "../mini/basics";
import { MiniDocPage, MiniSegments, MiniTimerPill } from "../mini/doc";
import { MiniQuestion } from "../mini/exam";
import { MiniCheck } from "../mini/icons";
import { MiniVideoPlayer } from "../mini/player";
import { CONTENT_KINDS, KIND_HINTS, TYPES_CYCLE_MS, typesStory, type ContentKindShown } from "./content.story";

const TEXT_SLIDE_SECONDS = 20;

function Seen({ on }: { on: boolean }) {
  return (
    <span className={cn("flex items-center gap-1 text-[10px] font-semibold text-green-600 transition-opacity duration-300", on ? "opacity-100" : "opacity-0")}>
      <MiniCheck className="size-3.5" /> Visto
    </span>
  );
}

/** Cómo vive el alumno cada tipo, en miniatura; `local` = avance dentro del turno (0–1). */
function Slide({ kind, local }: { kind: ContentKindShown; local: number }) {
  switch (kind) {
    case "document":
      return (
        <div className="flex h-full flex-col overflow-hidden rounded-md border bg-slate-50">
          <MiniSegments total={4} done={1} filling={local} />
          <div className="flex flex-1 items-start justify-center pt-1">
            <MiniDocPage title="Clases de fuego" />
          </div>
        </div>
      );
    case "text": {
      const remaining = Math.max(0, Math.ceil(TEXT_SLIDE_SECONDS * (1 - local) - 1e-9));
      return (
        <div className="flex h-full flex-col rounded-md border bg-white">
          <div className="flex justify-end border-b px-2 py-1">
            <MiniTimerPill remaining={remaining} total={TEXT_SLIDE_SECONDS} done={remaining === 0} doneLabel="Lectura completada" />
          </div>
          <div className="space-y-2 p-3">
            {[90, 80, 94, 72, 60].map((w, i) => (
              <span key={i} className="block h-[5px] rounded bg-slate-200" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      );
    }
    case "video":
      return <MiniVideoPlayer className="h-full" position={0.15 + 0.5 * local} rate={1} />;
    case "exam":
      return (
        <div className="h-full rounded-md border bg-white p-2.5">
          <MiniQuestion prompt="¿Qué extintor usas en un fuego eléctrico?" options={["Agua", "CO₂", "Espuma"]} picked={local >= 0.45 ? 1 : null} />
        </div>
      );
    case "assignment":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-teal-300 bg-teal-50/50 p-3 text-center">
          {local < 0.45 ? (
            <>
              <span className="text-[18px]" aria-hidden>
                ⤒
              </span>
              <p className="text-[10px] text-slate-600">Arrastra tu archivo aquí</p>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[10px] font-semibold">
                <span className="rounded bg-red-50 px-1 text-[8px] font-extrabold text-red-600">PDF</span>
                plan-evacuacion.pdf
              </span>
              <MiniButton variant="primary">Entregar</MiniButton>
            </>
          )}
        </div>
      );
    case "resource":
      return (
        <div className="h-full rounded-md border bg-white p-2.5">
          <div className="flex items-center gap-2 rounded-md border px-2 py-1.5">
            <span className="rounded bg-red-50 px-1 text-[8px] font-extrabold text-red-600">PDF</span>
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">Hoja-seguridad-CO2.pdf</span>
            <MiniButton className="px-2 py-1 text-[10px]">⤓ Descargar</MiniButton>
          </div>
          <div className="mt-2">
            <Seen on={local >= 0.5} />
          </div>
        </div>
      );
    case "link":
      return (
        <div className="h-full rounded-md border bg-white p-2.5">
          <p className="text-[10.5px] font-bold">Tabla de clases de fuego</p>
          <p className="text-[9.5px] text-slate-500">stps.gob.mx</p>
          <div className="mt-2.5 flex items-center gap-2">
            <MiniButton variant="primary">↗ Abrir enlace</MiniButton>
            <Seen on={local >= 0.5} />
          </div>
        </div>
      );
  }
}

export function TypesScene() {
  const phase = useSceneClock(TYPES_CYCLE_MS);
  const s = typesStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-2.5">
      <div className="flex items-center gap-2">
        <KindChip kind={s.kind} size="md" />
        <b className="text-[12px]">{KIND_META[s.kind].label}</b>
        <span className="ml-auto text-[10px] tabular-nums text-slate-400">
          {s.index + 1} / {CONTENT_KINDS.length}
        </span>
      </div>
      <div key={s.kind} className="min-h-0 flex-1 animate-in fade-in duration-300">
        <Slide kind={s.kind} local={s.local} />
      </div>
      <p className="truncate text-[10.5px] text-slate-600">{KIND_HINTS[s.kind]}</p>
      <div className="flex justify-center gap-1">
        {CONTENT_KINDS.map((kind, i) => (
          <span key={kind} className={cn("h-1.5 rounded-full transition-all duration-300", i === s.index ? "w-4 bg-cta" : "w-1.5 bg-slate-300")} />
        ))}
      </div>
    </div>
  );
}
