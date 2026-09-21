import {
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  Infinity as InfinityIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { validityState } from "@/lib/validity";
import { formatShortDate, relativeDaysLabel } from "@/lib/validity-format";

const BASE =
  "inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0";

/**
 * Insignia de vigencia de un certificado. Colores semánticos, no de marca:
 * verde vigente · ámbar por vencer · gris vencido (icono ámbar: vencido no es
 * falso) · neutro vitalicio. Sin estado: pensada para componentes de servidor.
 */
export function ValidityBadge({
  expiresAt,
  now = Date.now(),
  className,
}: {
  /** null/undefined = vitalicio */
  expiresAt: Date | number | null | undefined;
  now?: number;
  className?: string;
}) {
  if (expiresAt === null || expiresAt === undefined) {
    return (
      <span className={cn(BASE, "border-border bg-secondary text-slate-600", className)}>
        <InfinityIcon aria-hidden />
        Vitalicio
      </span>
    );
  }

  const state = validityState(expiresAt, now);
  const date = formatShortDate(expiresAt);

  if (state === "expired") {
    return (
      <span className={cn(BASE, "border-slate-200 bg-slate-100 text-slate-700", className)}>
        <CalendarX2 className="text-amber-600" aria-hidden />
        Vencido el {date}
      </span>
    );
  }

  if (state === "expiring") {
    return (
      <span
        className={cn(BASE, "border-amber-200 bg-amber-50 text-amber-800", className)}
        title={`Vence el ${date}`}
      >
        <CalendarClock aria-hidden />
        Por vencer · {relativeDaysLabel(expiresAt, now)}
        <span className="sr-only">, vence el {date}</span>
      </span>
    );
  }

  return (
    <span className={cn(BASE, "border-green-200 bg-green-50 text-green-700", className)}>
      <CalendarCheck aria-hidden />
      Vigente hasta el {date}
    </span>
  );
}
