"use client";

import { useSwitchViewContext } from "@/components/shell/view-context";

/** Botón con forma de enlace que cambia el contexto de vista (solo admin). */
export function SwitchContextButton({ value, children }: { value: string; children: React.ReactNode }) {
  const { switchTo, pending } = useSwitchViewContext();
  return (
    <button
      type="button"
      onClick={() => switchTo(value)}
      disabled={pending}
      className="font-semibold text-primary underline underline-offset-2 hover:no-underline disabled:opacity-60"
    >
      {children}
    </button>
  );
}
