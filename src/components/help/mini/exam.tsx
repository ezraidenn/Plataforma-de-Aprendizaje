import { cn } from "@/lib/utils";

/** Encabezado del examen en curso: «Pregunta N de M», «Guardado» y reloj (si hay límite). */
export function MiniExamBar({
  index,
  total,
  timer,
  level = "normal",
}: {
  index: number;
  total: number;
  /** Texto del reloj («12:34»); null = sin límite */
  timer: string | null;
  level?: "normal" | "warn" | "danger";
}) {
  return (
    <div className="flex items-center gap-2 border-b bg-white px-2.5 py-1.5 text-[11px]">
      <b className="min-w-0 flex-1 truncate">
        Pregunta {index} de {total}
      </b>
      <span className="text-[9.5px] text-slate-400">✓ Guardado</span>
      {timer !== null && (
        <span
          className={cn(
            "flex items-center gap-1 font-bold tabular-nums transition-colors duration-300",
            level === "normal" && "text-slate-500",
            level === "warn" && "text-amber-600",
            level === "danger" && "animate-pulse text-red-600"
          )}
        >
          ⏱ {timer} restantes
        </span>
      )}
    </div>
  );
}

/** Pregunta de opción única como en el examen del alumno. */
export function MiniQuestion({ prompt, options, picked }: { prompt: string; options: readonly string[]; picked: number | null }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10.5px] font-bold leading-snug">{prompt}</p>
      {options.map((option, i) => (
        <div
          key={option}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1 text-[10px] transition-colors duration-300",
            picked === i && "border-cta bg-indigo-50 font-bold"
          )}
        >
          <span className={cn("size-3 shrink-0 rounded-full border", picked === i && "border-[4px] border-cta")} />
          {option}
        </div>
      ))}
    </div>
  );
}

/** Anillo de calificación del resultado; `fill` (0–1) anima el llenado. */
export function MiniScoreRing({
  percent,
  passed,
  fill = 1,
  className,
}: {
  percent: number;
  /** Verde si aprueba, rojo si no, índigo si aún no hay veredicto */
  passed: boolean | null;
  fill?: number;
  className?: string;
}) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const shown = percent * Math.min(1, Math.max(0, fill));
  const color = passed === null ? "#4f46e5" : passed ? "#16a34a" : "#dc2626";
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r={r} stroke="#e2e8f0" strokeWidth="4" fill="none" />
      <circle
        cx="20"
        cy="20"
        r={r}
        stroke={color}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - shown / 100)}
        transform="rotate(-90 20 20)"
        className="transition-[stroke-dashoffset,stroke] duration-100 ease-linear"
      />
      <text x="20" y="21" textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="800" fill="#0f172a">
        {Math.round(shown)}%
      </text>
    </svg>
  );
}
