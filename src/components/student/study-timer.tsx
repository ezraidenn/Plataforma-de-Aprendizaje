"use client";

import { CircleCheck, Loader2, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

/** 75 → "1:15"; 3725 → "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Estimado legible: "45 s", "6 min", "1 h 20 min". */
export function formatApprox(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Anillo de progreso; `fraction` = parte cumplida (0–1). */
export function ProgressRing({
  fraction,
  size = 18,
  stroke = 2.5,
  className,
}: {
  fraction: number;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const done = Math.min(1, Math.max(0, fraction));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" opacity={0.2} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - done)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear"
      />
    </svg>
  );
}

/** Mini-cuenta regresiva para botones bloqueados («Siguiente», «Continuar»). */
export function CountdownRing({ remaining, total }: { remaining: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <ProgressRing fraction={total > 0 ? 1 - remaining / total : 1} />
      <span className="text-xs tabular-nums">
        {remaining >= 60 ? formatClock(remaining) : `${Math.max(0, Math.ceil(remaining))}s`}
      </span>
    </span>
  );
}

export type StudyTimerState = "running" | "paused" | "syncing" | "done";

/**
 * Contador visible del tiempo que exige una lección (lectura, página de
 * documento o video). Es solo informativo: quien acredita es el servidor con
 * su propio reloj; el contador corre en el navegador y se corrige con cada
 * latido.
 */
export function StudyTimer({
  remaining,
  total,
  state,
  caption,
  pausedHint,
  doneLabel,
  doneCaption,
  className,
}: {
  /** Segundos que faltan. */
  remaining: number;
  /** Segundos requeridos (para el anillo). */
  total: number;
  state: StudyTimerState;
  /** Segunda línea mientras corre: «Tiempo mínimo de lectura: 2:00». */
  caption?: string;
  /** Segunda línea en pausa: «Reproduce el video para avanzar». */
  pausedHint?: string;
  doneLabel: string;
  doneCaption?: string;
  className?: string;
}) {
  const clock = formatClock(remaining);
  const line1 =
    state === "done"
      ? doneLabel
      : state === "syncing"
        ? "Registrando tu tiempo…"
        : state === "paused"
          ? `En pausa · faltan ${clock}`
          : `Faltan ${clock}`;
  const line2 =
    state === "done"
      ? doneCaption
      : state === "syncing"
        ? "Confirmando con el servidor"
        : state === "paused"
          ? (pausedHint ?? caption)
          : caption;

  return (
    <div
      role="timer"
      aria-label={line2 ? `${line1}. ${line2}` : line1}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-colors duration-300",
        state === "done"
          ? "border-success/30 bg-success/10 text-success"
          : state === "paused"
            ? "border-border bg-muted/70 text-muted-foreground"
            : "border-cta/25 bg-cta/8 text-foreground",
        className
      )}
    >
      <span className="relative flex size-8 shrink-0 items-center justify-center">
        {state === "done" ? (
          <CircleCheck className="size-6" aria-hidden />
        ) : state === "syncing" ? (
          <Loader2 className="size-5 text-cta motion-safe:animate-spin" aria-hidden />
        ) : (
          <>
            <ProgressRing
              fraction={total > 0 ? 1 - remaining / total : 1}
              size={32}
              stroke={3.5}
              className={state === "paused" ? "text-muted-foreground" : "text-cta"}
            />
            {state === "paused" && <Pause className="absolute size-3" aria-hidden />}
          </>
        )}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block whitespace-nowrap text-sm font-semibold tabular-nums">{line1}</span>
        {line2 && (
          <span
            className={cn(
              "hidden whitespace-nowrap text-[11px] sm:block",
              state === "done" ? "text-success/80" : "text-muted-foreground"
            )}
          >
            {line2}
          </span>
        )}
      </span>
      {/* Solo se anuncia el cambio a «completado», no cada segundo */}
      <span className="sr-only" aria-live="polite">
        {state === "done" ? doneLabel : ""}
      </span>
    </div>
  );
}
