"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge } from "@/components/help/mini/basics";
import {
  IDENTITY_PERMISSION_CYCLE_MS,
  identityPermissionStory,
} from "./identity-permission.story";

/** El permiso de identidad: se enciende y el maestro gana la tarjeta. */
export function IdentityPermissionScene() {
  const phase = useSceneClock(IDENTITY_PERMISSION_CYCLE_MS);
  const s = identityPermissionStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[11.5px]">Prof. Roberto Martínez</b>
          <span className="flex items-center gap-1.5 text-[9.5px] text-slate-500">
            Maestro
            {s.badge && (
              <MiniBadge tone="ok" className="animate-in fade-in duration-300">
                Identidad
              </MiniBadge>
            )}
          </span>
        </span>
        <span className="shrink-0 text-[9.5px] text-slate-500">Puede editar identidad</span>
        <span
          className={cn(
            "flex h-[16px] w-[28px] shrink-0 items-center rounded-full px-0.5 transition-colors duration-300",
            s.allowed ? "justify-end bg-cta" : "justify-start bg-slate-300"
          )}
        >
          <span className="size-[12px] rounded-full bg-white" />
        </span>
      </div>

      <span className="text-[9.5px] font-semibold text-slate-500">Ajustes de Roberto</span>
      <div className="flex-1 rounded-lg border border-dashed px-2.5 py-2">
        {s.cardVisible ? (
          <div className="animate-in fade-in space-y-1 duration-500">
            <b className="block text-[11px]">Identidad de la empresa</b>
            <div className="flex items-center gap-1.5">
              <span className="flex size-6 items-center justify-center rounded bg-brand-tint text-[9px] font-bold text-cta">
                LOGO
              </span>
              <span className="h-[14px] flex-1 rounded bg-slate-100" />
            </div>
            <span className="block text-[9px] text-slate-500">Logo, nombre y portada</span>
          </div>
        ) : (
          <span className="text-[9.5px] text-slate-400">
            Sin el permiso, aquí solo ve su nombre y su contraseña.
          </span>
        )}
      </div>
    </div>
  );
}
