import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Cabecera de página v3: hereda el color de la sección activa (CSS vars del
 * SectionScope). Eyebrow + título Sora + descripción + acciones a la derecha.
 * Sustituye al <h1> suelto de cada página.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  /** Texto pequeño sobre el título (p. ej. nombre del curso o de la sección) */
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "anim-rise relative overflow-hidden rounded-2xl border bg-card p-5 md:p-6",
        "shadow-[0_1px_2px_rgb(15_23_42/0.05)]",
        className
      )}
    >
      {/* Acento de sección: barra superior degradada + halo suave a la derecha */}
      <span aria-hidden className="section-gradient absolute inset-x-0 top-0 h-1" />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full opacity-[0.12]"
        style={{ background: "var(--section)" }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {Icon && (
            <span className="section-gradient section-glow flex size-12 shrink-0 items-center justify-center rounded-xl text-section-fg">
              <Icon className="size-6" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-section-strong">
                {eyebrow}
              </p>
            )}
            <h1
              title={title}
              className="line-clamp-2 break-words font-heading text-2xl font-bold tracking-tight md:line-clamp-none md:truncate md:text-[1.75rem]"
            >
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
