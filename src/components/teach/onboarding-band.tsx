"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { requestOpenDialog, type OpenDialogName } from "@/lib/open-dialog";
import type { Onboarding, OnboardingStep, OnboardingStepKey } from "@/lib/onboarding";

/** Se guarda por usuario para que la caja compartida no se oculte a todos */
const storageKey = (userId: string) => `onboarding-hidden:${userId}`;

/** Diálogo que abre cada paso cuando su destino ya es la pantalla actual */
const DIALOG_OF: Partial<Record<OnboardingStepKey, OpenDialogName>> = {
  course: "new-course",
  lesson: "add-item",
  students: "new-student",
  publish: "enroll",
};

/**
 * Botón de un paso. Si el destino es ESTA misma ruta no navega: avisa al
 * diálogo que ya está montado. Next descarta las navegaciones blandas que solo
 * cambian la búsqueda de la misma ruta, así que el enlace no hacía nada.
 */
function StepAction({
  step,
  className,
  children,
}: {
  step: OnboardingStep;
  className: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const dialog = DIALOG_OF[step.key];
  const samePage = step.href.split(/[?#]/)[0] === pathname;

  if (dialog && samePage) {
    return (
      <button type="button" onClick={() => requestOpenDialog(dialog)} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link href={step.href} className={className}>
      {children}
    </Link>
  );
}

/**
 * Banda de una línea con los cinco primeros pasos del maestro. Desaparece sola
 * cuando están los cinco; «Ocultar» la guarda en el navegador, no en la base.
 */
export function OnboardingBand({ userId, data }: { userId: string; data: Onboarding }) {
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // localStorage no existe en el servidor: se lee ya montado
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(storageKey(userId)) === "1");
    } catch {
      /* modo privado o almacenamiento bloqueado: se queda visible */
    }
  }, [userId]);

  const { steps, next, done, total } = data;
  if (!next) return null;

  function hide() {
    setHidden(true);
    setExpanded(false);
    try {
      window.localStorage.setItem(storageKey(userId), "1");
    } catch {
      /* si no se puede guardar, solo se oculta en esta pantalla */
    }
  }

  function show() {
    setHidden(false);
    try {
      window.localStorage.removeItem(storageKey(userId));
    } catch {
      /* nada que borrar */
    }
  }

  if (hidden) {
    return (
      <button
        type="button"
        onClick={show}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Primeros pasos ({done}/{total})
      </button>
    );
  }

  const pct = Math.round((done / total) * 100);

  return (
    <section
      role="region"
      aria-label="Primeros pasos"
      className="anim-rise rounded-xl border border-l-4 border-l-section bg-card px-3 py-2 shadow-[0_1px_2px_rgb(15_23_42/0.05)]"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(var(--section-strong) 0 ${pct}%, var(--section-soft) ${pct}% 100%)` }}
          aria-hidden
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-card font-heading text-[11px] font-bold">
            {done}/{total}
          </span>
        </span>

        <div className="min-w-0 flex-1">
          {/* En celular el paso se lee completo (dos líneas) y solo queda «Ver todos» debajo */}
          <p className="line-clamp-2 text-sm font-semibold sm:truncate">Siguiente: {next.title}</p>
          <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Primeros pasos · faltan {total - done} ·</span>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Ver todos
            </button>
          </p>
        </div>

        <span className="hidden shrink-0 gap-1 sm:flex" aria-hidden>
          {steps.map((s) => (
            <span
              key={s.key}
              className={cn(
                "h-1.5 w-4 rounded-full",
                s.done ? "bg-success" : s.key === next.key ? "bg-section-strong" : "bg-muted"
              )}
            />
          ))}
        </span>

        <StepAction step={next} className={cn(buttonVariants(), "h-9 shrink-0 gap-1.5")}>
          {next.action}
          <ArrowRight className="size-4" aria-hidden />
        </StepAction>

        <button
          type="button"
          onClick={hide}
          aria-label="Ocultar primeros pasos"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {expanded && (
        <ol className="mt-2 space-y-2 border-t pt-2">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  s.done
                    ? "bg-success/10 text-success"
                    : s.key === next.key
                      ? "bg-section-strong text-section-fg"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {s.done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("text-sm font-medium", s.done && "text-muted-foreground")}>
                  {s.title}
                </span>
                <span className="block text-xs text-muted-foreground">{s.help}</span>
                {s.key === next.key && (
                  <StepAction
                    step={s}
                    className="text-xs font-medium text-section-strong underline underline-offset-2"
                  >
                    {s.action}
                  </StepAction>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
