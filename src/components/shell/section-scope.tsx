"use client";

import { usePathname } from "next/navigation";
import { SECTION_META, sectionFor } from "./sections";

/**
 * Envuelve el contenido con `data-section` (activa las CSS vars del color de
 * sección) y pinta el HEADER de la app: una barra del color de la sección con
 * icono + nombre a la izquierda y los controles (campana, logo móvil) a la
 * derecha. Es sticky: sustituye al header blanco.
 */
export function SectionScope({
  children,
  leading,
  trailing,
}: {
  children: React.ReactNode;
  /** Se muestra a la izquierda solo en móvil (logo/nombre) */
  leading?: React.ReactNode;
  /** Controles a la derecha (campana, etc.) */
  trailing?: React.ReactNode;
}) {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  const { label, Icon } = SECTION_META[section];

  return (
    <div data-section={section} className="section-halo min-h-dvh">
      <header
        className="section-gradient sticky top-0 z-30 flex h-14 items-center justify-between gap-3 px-4 text-section-fg shadow-[0_4px_16px_-8px_rgb(15_23_42/0.35)] md:px-6"
        aria-label={`Sección: ${label}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {leading && <div className="md:hidden">{leading}</div>}
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="truncate font-heading text-sm font-bold uppercase tracking-[0.12em]">
            {label}
          </span>
        </div>
        {trailing && <div className="flex items-center gap-1">{trailing}</div>}
      </header>
      {children}
    </div>
  );
}
