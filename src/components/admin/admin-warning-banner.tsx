import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Franja de advertencia de administración (DISENO-UX §1.6).
 * Solo se muestra dentro de acciones destructivas: borde superior ámbar (advertencia) 2px + aviso.
 */
export function AdminWarningBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-t-2 border-t-warning bg-warning/5 px-3 py-2 text-xs text-foreground/80",
        className
      )}
    >
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      <span>Estás en administración — los cambios afectan a toda la plataforma.</span>
    </div>
  );
}
