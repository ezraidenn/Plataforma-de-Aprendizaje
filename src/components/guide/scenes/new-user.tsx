"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge, MiniButton, MiniToast } from "@/components/help/mini/basics";
import { NEW_USER_CYCLE_MS, newUserStory } from "./new-user.story";

/** Campo del formulario en miniatura. */
function Field({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="space-y-0.5">
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span
        className={cn(
          "flex h-[22px] items-center rounded-md border bg-white px-1.5 text-[10.5px] transition-colors duration-200",
          active && "border-cta"
        )}
      >
        <span className="truncate">{value}</span>
        {active && <span className="ml-px inline-block w-[1px] animate-pulse bg-slate-900">&nbsp;</span>}
      </span>
    </div>
  );
}

/** Crear usuario: la contraseña temporal se muestra una sola vez. */
export function NewUserScene() {
  const phase = useSceneClock(NEW_USER_CYCLE_MS);
  const s = newUserStory(phase);
  const typingName = s.stage === "form" && s.fields.email === "";
  const typingEmail = s.stage === "form" && s.fields.email !== "";

  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <b className="text-[12px]">Nuevo usuario</b>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Nombre" value={s.fields.name} active={typingName} />
        <Field label="Rol" value={s.fields.role} active={false} />
      </div>
      <Field label="Correo" value={s.fields.email} active={typingEmail} />

      {s.stage === "created" ? (
        <div className="mt-auto space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px] font-bold text-slate-900">{s.password}</span>
            <MiniBadge tone="warn">Se muestra una sola vez</MiniBadge>
          </div>
          <span className="block text-[9px] text-amber-800">
            Cópiala y dásela en persona; después solo puedes restablecerla.
          </span>
        </div>
      ) : (
        <div className="mt-auto flex justify-end">
          <MiniButton variant="primary" glow={s.stage === "creating"}>
            Crear usuario
          </MiniButton>
        </div>
      )}

      <MiniToast show={s.copied}>Contraseña copiada</MiniToast>
    </div>
  );
}
