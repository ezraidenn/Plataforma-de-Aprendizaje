import { cn } from "@/lib/utils";
import { formatClock } from "@/components/student/study-timer";
import { MiniCheck, MiniRing } from "./icons";

/** Contador de la barra superior del visor (réplica del StudyTimer real). */
export function MiniTimerPill({ remaining, total, done, doneLabel }: { remaining: number; total: number; done: boolean; doneLabel: string }) {
  return (
    <span
      className={cn(
        "flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2.5 text-[10.5px] font-bold transition-colors duration-300",
        done ? "border-green-200 bg-green-50 text-green-700" : "border-indigo-200 bg-indigo-50 text-slate-900"
      )}
    >
      {done ? <MiniCheck className="size-4" /> : <MiniRing className="size-[18px]" progress={total > 0 ? 1 - remaining / total : 1} />}
      <span className="tabular-nums">{done ? doneLabel : `Faltan ${formatClock(remaining)}`}</span>
    </span>
  );
}

/** Barra segmentada del visor: una marca por página; se pinta al acreditarla. */
export function MiniSegments({ total, done, filling }: { total: number; done: number; filling: number }) {
  return (
    <div className="flex gap-0.5 bg-white px-2.5 py-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="relative h-[5px] flex-1 overflow-hidden rounded-sm bg-slate-200">
          <span
            className="absolute inset-y-0 left-0 rounded-sm bg-green-500 transition-[width] duration-200"
            style={{ width: i < done ? "100%" : i === done ? `${Math.round(filling * 100)}%` : "0%" }}
          />
        </span>
      ))}
    </div>
  );
}

/** Página de PDF en miniatura (título y renglones). */
export function MiniDocPage({ title }: { title: string }) {
  const lines = [90, 75, 84, 60, 80, 40];
  return (
    <div className="h-[104px] w-[62%] rounded bg-white px-3 py-2.5 shadow-[0_2px_6px_rgb(0_0_0/0.1)]">
      <b className="mb-1.5 block text-[10px] text-[#5d4037]">{title}</b>
      {lines.map((w, i) => (
        <span key={i} className="my-[5px] block h-[5px] rounded bg-slate-200" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
