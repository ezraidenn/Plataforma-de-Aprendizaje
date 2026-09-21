"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge } from "@/components/help/mini/basics";
import { MiniNotice } from "@/components/help/mini/assignment";
import { ACCOUNT_TOGGLE_CYCLE_MS, accountToggleStory } from "./account-toggle.story";

/** Desactivar cierra sesiones y bloquea la entrada, pero no borra nada. */
export function AccountToggleScene() {
  const phase = useSceneClock(ACCOUNT_TOGGLE_CYCLE_MS);
  const s = accountToggleStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[11.5px]">Ana Ruiz</b>
          <span className="block text-[9.5px] text-slate-500">Estudiante</span>
        </span>
        <MiniBadge tone={s.active ? "ok" : "muted"}>{s.active ? "Activo" : "Inactivo"}</MiniBadge>
        {/* Interruptor */}
        <span
          className={cn(
            "flex h-[16px] w-[28px] shrink-0 items-center rounded-full px-0.5 transition-colors duration-300",
            s.active ? "justify-end bg-cta" : "justify-start bg-slate-300"
          )}
        >
          <span className="size-[12px] rounded-full bg-white" />
        </span>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-[10px]">
        <span className="text-slate-500">Sesiones abiertas</span>
        <b className="tabular-nums">{s.sessions}</b>
      </div>

      {s.loginBlocked ? (
        <MiniNotice tone="bad">Tu cuenta está desactivada. Contacta al administrador.</MiniNotice>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-[10px] text-green-800">
          Se conserva todo: avance {s.keeps.progress} · {s.keeps.certificates} certificados
        </div>
      )}

      <p className="mt-auto text-[9.5px] leading-snug text-slate-500">
        {s.active
          ? "Al reactivarla, entra de nuevo como si nada."
          : "Desactivada: no puede entrar, pero su historial sigue ahí."}
      </p>
    </div>
  );
}
