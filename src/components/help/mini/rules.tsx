import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Barra de avance de una condición con la línea del mínimo (verde si cumple). */
export function MiniConditionBar({
  label,
  value,
  min,
  mark,
  showValue = false,
}: {
  label: string;
  value: number;
  min: number;
  /** Muestra ✓ / ✗ con color */
  mark: boolean;
  /** Muestra el porcentaje aunque aún no haya marca */
  showValue?: boolean;
}) {
  const ok = value >= min;
  return (
    <div className="mt-2 rounded-lg border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span
          className={cn(
            "font-extrabold tabular-nums transition-[opacity,color] duration-300",
            mark ? (ok ? "text-green-600" : "text-red-600") : "text-slate-500",
            mark || showValue ? "opacity-100" : "opacity-0"
          )}
        >
          {mark ? (ok ? "✓ " : "✗ ") : ""}
          {Math.round(value)}%
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded bg-slate-100">
        <span className={cn("absolute inset-y-0 left-0 rounded", ok ? "bg-green-500" : "bg-amber-500")} style={{ width: `${value}%` }} />
        <span className="absolute -top-1 h-3.5 w-0.5 bg-slate-900" style={{ left: `calc(${min}% - 1px)` }} />
      </div>
    </div>
  );
}

/** Estado de una condición: pendiente, cumplida o no cumplida. */
export function MiniConditionState({ passed }: { passed: boolean | null }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold transition-colors duration-300",
        passed === null ? "bg-slate-100 text-slate-500" : passed ? "bg-green-100 text-green-700" : "bg-red-50 text-red-700"
      )}
    >
      {passed === null ? "Pendiente" : passed ? "✓ Cumplida" : "✗ No cumplida"}
    </span>
  );
}

/** Tarjeta de una condición como en el editor de reglas (ícono, nombre, detalle y estado). */
export function MiniConditionCard({
  Icon,
  title,
  detail,
  passed,
}: {
  Icon: LucideIcon;
  title: string;
  detail: string;
  passed: boolean | null;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-cta">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block truncate text-[11px]">{title}</b>
        <span className="block truncate text-[9.5px] text-slate-500">{detail}</span>
      </span>
      <MiniConditionState passed={passed} />
    </div>
  );
}
