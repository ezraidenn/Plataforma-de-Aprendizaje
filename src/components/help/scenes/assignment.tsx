"use client";

import { cn } from "@/lib/utils";
import { KindChip } from "@/components/kind-meta";
import { useSceneClock } from "../use-scene-clock";
import { MiniButton, MiniToast } from "../mini/basics";
import { MiniCursor } from "../mini/cursor";
import { MiniDropzone, MiniFileChip, MiniNotice, MiniSubmissionBadge } from "../mini/assignment";
import {
  EXAMPLE_DUE,
  FILE_TYPES_CYCLE_MS,
  fileTypesStory,
  LATE_CYCLE_MS,
  lateStory,
  REPLACE_CYCLE_MS,
  replaceStory,
} from "./assignment.story";

const DATE_FMT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDate = (ms: number) => DATE_FMT.format(new Date(ms));
const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;

export function LateScene({ value }: { value: { hasDue: boolean; allowLate: boolean } }) {
  const phase = useSceneClock(LATE_CYCLE_MS);
  const s = lateStory(phase, value.hasDue, value.allowLate);
  const closed = s.pastDue && !value.allowLate;
  return (
    <div className="absolute inset-0 space-y-2 bg-white p-3 text-[11px]">
      <div className="relative mx-1 mt-2 h-9">
        <div className="absolute inset-x-0 top-[13px] h-1 rounded bg-slate-200" />
        {s.duePos !== null && (
          <>
            <span className="absolute top-[10px] size-2.5 -translate-x-1/2 rounded-full bg-red-500" style={{ left: pct(s.duePos) }} />
            <span className="absolute top-[22px] -translate-x-1/2 whitespace-nowrap text-[8.5px] text-slate-500" style={{ left: pct(s.duePos) }}>
              fecha límite
            </span>
          </>
        )}
        <span className="absolute top-0 h-[26px] w-0.5 bg-cta transition-[left] duration-100 ease-linear" style={{ left: pct(s.todayPos) }}>
          <span className="absolute -left-2 -top-3 text-[8.5px] font-extrabold text-cta">hoy</span>
        </span>
      </div>
      <div className="space-y-2 rounded-lg border p-2.5">
        <div className="flex items-center gap-2">
          <KindChip kind="assignment" />
          <b className="truncate text-[12px]">Plan de evacuación</b>
          <span className="ml-auto shrink-0 text-[9.5px] text-slate-500">{value.hasDue ? `Entrega: ${fmtDate(EXAMPLE_DUE)}` : "Sin fecha límite"}</span>
        </div>
        {s.outcome === "late" || s.outcome === "onTime" ? (
          <div className="flex animate-in fade-in flex-wrap gap-1.5 duration-300">
            <MiniSubmissionBadge kind="submitted" />
            {s.outcome === "late" && <MiniSubmissionBadge kind="late" />}
          </div>
        ) : (
          <>
            {s.pastDue &&
              (value.allowLate ? (
                <MiniNotice tone="warn">La fecha de entrega ya pasó: si entregas ahora, tu tarea se marcará como entregada con retraso.</MiniNotice>
              ) : (
                <MiniNotice tone="bad">La fecha de entrega ya pasó y esta tarea no acepta entregas tardías.</MiniNotice>
              ))}
            <div className="flex items-center gap-2">
              <MiniFileChip name="plan-evacuacion.pdf" />
              <span className="relative shrink-0">
                <MiniButton variant={closed ? "disabled" : "primary"} className={cn(s.pressed && "scale-95")}>
                  Entregar
                </MiniButton>
                <MiniCursor at={s.cursorAtButton} pressed={s.pressed} />
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ReplaceScene({ value }: { value: { allowed: boolean } }) {
  const phase = useSceneClock(REPLACE_CYCLE_MS);
  const s = replaceStory(phase, value.allowed);
  return (
    <div className="absolute inset-0 bg-white p-3 text-[11px]">
      <b className="text-[12px]">Tu entrega</b>
      <div className={cn("mt-2 space-y-2 transition-opacity duration-300", s.delivered ? "opacity-100" : "opacity-0")}>
        <MiniSubmissionBadge kind="submitted" />
        <div className="rounded-lg border p-2">
          <p className="text-[9.5px] text-slate-500">Entregada el 10 sep 2026, 5:40 p.m.</p>
          <span key={s.file} className="mt-1.5 inline-block animate-in fade-in duration-300">
            <MiniFileChip name={s.file} />
          </span>
        </div>
        {value.allowed ? (
          <span className="relative inline-block">
            <MiniButton className={cn(s.pressed && "scale-95")}>↺ Reemplazar entrega</MiniButton>
            <MiniCursor at={s.cursorAtButton} pressed={s.pressed} />
          </span>
        ) : (
          <span className="inline-block rounded-md border border-dashed border-cta px-1.5 py-0.5 text-[9.5px] font-bold text-cta">
            sin botón para reemplazar
          </span>
        )}
      </div>
      {s.stage === "confirm" && (
        <div className="absolute inset-0 flex animate-in fade-in items-center justify-center bg-slate-900/40 p-4 duration-200">
          <div className="w-full rounded-lg bg-white p-3 shadow-lg">
            <b className="block text-[12px]">¿Reemplazar tu entrega?</b>
            <p className="mt-1 text-[10px] leading-snug text-slate-500">
              Harás una entrega nueva que sustituirá a la anterior. Tu instructor calificará la entrega más reciente.
            </p>
            <div className="mt-2 flex justify-end gap-1.5">
              <MiniButton>Cancelar</MiniButton>
              <MiniButton variant="primary">Sí, reemplazar</MiniButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FileTypesScene({ value }: { value: { types: string } }) {
  const phase = useSceneClock(FILE_TYPES_CYCLE_MS);
  const s = fileTypesStory(phase, value.types);
  const dragging = s.stage === "dragBad" || s.stage === "dragGood";
  const draggedName = s.stage === "dragBad" ? s.badName : s.goodName;
  const afterBad = s.stage === "rejected" || s.stage === "dragGood" || s.stage === "accepted";
  return (
    <div className="absolute inset-0 space-y-2 bg-white p-3 text-[11px]">
      <MiniDropzone hint={`${s.label} · máx 25 MB c/u · hasta 10 archivos`} active={dragging} />
      <div className="relative h-7">
        {dragging && (
          <span key={draggedName} className="absolute left-1/2 top-0 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <MiniFileChip name={draggedName} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {afterBad && s.badAccepted && <MiniFileChip name={s.badName} />}
        {s.stage === "accepted" && <MiniFileChip name={s.goodName} />}
      </div>
      <MiniToast show={s.stage === "rejected" && !s.badAccepted}>
        «{s.badName}» no se acepta en esta tarea. Sube un archivo {s.label}.
      </MiniToast>
    </div>
  );
}
