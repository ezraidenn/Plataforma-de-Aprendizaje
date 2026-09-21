import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Encabezado ligero para las pestañas del editor de curso (la cabecera grande
 * con el título del curso ya la pinta el layout). Chip de icono con el color
 * de la sección + título Sora + descripción + acciones a la derecha.
 */
export function TabHeading({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <Icon className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
