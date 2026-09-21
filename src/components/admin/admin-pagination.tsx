import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * Paginación server-side por links (?page=N) que preserva varios parámetros
 * a la vez (búsqueda + filtro de rol, filtro de entidad, etc.).
 */
export function AdminPagination({
  basePath,
  page,
  totalPages,
  params = {},
  anchor,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  /** Parámetros a preservar en los links; los vacíos se omiten. */
  params?: Record<string, string | undefined>;
  /** Ancla opcional (#seccion) para volver a la tabla al cambiar de página. */
  anchor?: string;
}) {
  if (totalPages <= 1) return null;

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) sp.set(key, value);
    }
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `${basePath}${qs ? `?${qs}` : ""}${anchor ? `#${anchor}` : ""}`;
  };

  const linkClass = (disabled: boolean) =>
    cn(
      buttonVariants({ variant: "outline", size: "sm" }),
      disabled && "pointer-events-none opacity-50"
    );

  return (
    <nav aria-label="Paginación" className="flex items-center justify-end gap-2">
      <span className="text-sm text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      <Link
        href={href(page - 1)}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={linkClass(page <= 1)}
      >
        <ChevronLeft aria-hidden />
        Anterior
      </Link>
      <Link
        href={href(page + 1)}
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={linkClass(page >= totalPages)}
      >
        Siguiente
        <ChevronRight aria-hidden />
      </Link>
    </nav>
  );
}
