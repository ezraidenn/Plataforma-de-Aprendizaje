import { cn } from "@/lib/utils";
import { formatClock } from "@/components/student/study-timer";

/** Reproductor de video en miniatura (estilo YouTube) con la velocidad y su menú. */
export function MiniVideoPlayer({
  position,
  duration = 120,
  rate,
  menuOpen = false,
  alert = false,
  className,
}: {
  /** Avance (0–1) */
  position: number;
  /** Duración en segundos */
  duration?: number;
  rate: number;
  menuOpen?: boolean;
  /** Resalta la velocidad (acaba de regresar a 1x) */
  alert?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-slate-900", className)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,#334155,#0f172a)]" />
      <span className="absolute left-1/2 top-[42%] flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-red-600/90 text-white">
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.7),transparent)] px-2 pb-1.5 pt-4">
        <div className="relative h-1 rounded bg-white/30">
          <span
            className="absolute inset-y-0 left-0 rounded bg-red-600 transition-[width] duration-100 ease-linear"
            style={{ width: `${Math.round(Math.min(1, position) * 1000) / 10}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[9px] font-semibold text-white">
          <span className="tabular-nums">
            {formatClock(Math.min(1, position) * duration)} / {formatClock(duration)}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 transition-colors duration-300",
              alert ? "bg-red-600" : rate > 1 ? "bg-white/25" : "bg-white/10"
            )}
          >
            ⚙ {rate}x
          </span>
        </div>
      </div>
      <div
        className={cn(
          "absolute bottom-8 right-2 w-16 rounded-md bg-black/85 py-1 text-[9px] text-white transition-all duration-200",
          menuOpen ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
        )}
      >
        {[0.5, 1, 1.5, 2].map((r) => (
          <div key={r} className={cn("px-2 py-0.5", r === 2 && "bg-white/20 font-bold")}>
            {r}x
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barra de lo realmente visto: los tramos acreditados en verde y los huecos en gris. */
export function MiniWatchedBar({
  watched,
  position,
}: {
  watched: { from: number; to: number }[];
  /** Posición actual del reproductor (0–1); null = no mostrar la aguja */
  position: number | null;
}) {
  return (
    <div className="relative h-[7px] w-full overflow-hidden rounded-full bg-slate-200">
      {watched.map((r, i) => (
        <span
          key={i}
          className="absolute inset-y-0 rounded-full bg-green-500 transition-[width] duration-200"
          style={{ left: `${r.from * 100}%`, width: `${Math.max(0, r.to - r.from) * 100}%` }}
        />
      ))}
      {position !== null && (
        <span
          className="absolute -top-[2px] h-[11px] w-[2px] rounded bg-slate-900 transition-[left] duration-200"
          style={{ left: `${Math.min(1, position) * 100}%` }}
        />
      )}
    </div>
  );
}
