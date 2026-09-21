"use client";

import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { VIEW_OWN } from "@/lib/view-context";
import { useSwitchViewContext, useViewContext } from "./view-context";

/** Franja bajo el header mientras el admin no está en «Mi contenido». */
export function ViewContextStrip() {
  const info = useViewContext();
  const pathname = usePathname();
  const { switchTo, pending } = useSwitchViewContext();
  if (info.kind === "own" || !pathname.startsWith("/teach")) return null;

  const who = info.kind === "all" ? "todos los maestros" : info.ownerName;
  return (
    <div role="status" className="sticky top-14 z-20 border-b border-primary/20 bg-brand-tint text-primary">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm md:px-6">
        <p className="flex items-center gap-2">
          <Eye className="size-4 shrink-0" aria-hidden />
          <span className="sm:hidden">
            Viendo: <strong>{who}</strong>
          </span>
          <span className="hidden sm:inline">
            Estás viendo el contenido de <strong>{who}</strong>. Lo que hagas aquí queda a tu nombre en la
            auditoría.
          </span>
        </p>
        <button
          type="button"
          onClick={() => switchTo(VIEW_OWN)}
          disabled={pending}
          aria-label="Volver a Mi contenido"
          className="shrink-0 rounded font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        >
          <span className="sm:hidden">Volver</span>
          <span className="hidden sm:inline">Volver a Mi contenido</span>
        </button>
      </div>
    </div>
  );
}
