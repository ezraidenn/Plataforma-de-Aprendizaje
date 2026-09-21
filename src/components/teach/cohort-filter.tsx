"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CohortFilterOption = { id: string; name: string; status: "open" | "closed" };

/** Valor interno de «Grupos abiertos» (en la URL = sin parámetro). */
const DEFAULT = "__open__";

/**
 * Filtro de grupo (`?grupo=`) para vistas server-side. Conserva los demás
 * parámetros de la URL y reinicia la paginación.
 *  - sin parámetro → grupos abiertos (y matrículas sin grupo)
 *  - `all`         → todos, incluidos grupos cerrados
 *  - `none`        → solo matrículas sin grupo
 *  - `<id>`        → un grupo concreto
 */
export function CohortFilter({
  options,
  value,
  paramName = "grupo",
  className,
}: {
  /** Grupos del curso de la vista (abiertos y cerrados, también los vacíos) */
  options: CohortFilterOption[];
  /** Valor crudo del parámetro en la URL */
  value?: string | null;
  paramName?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = value?.trim() || DEFAULT;
  const open = options.filter((o) => o.status === "open");
  const closed = options.filter((o) => o.status === "closed");
  const known =
    current === DEFAULT ||
    current === "all" ||
    current === "none" ||
    options.some((o) => o.id === current);

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT) params.delete(paramName);
    else params.set(paramName, next);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <Select value={current} onValueChange={change}>
      <SelectTrigger
        className={cn("w-60 max-w-full bg-card data-[size=default]:h-11", className)}
        aria-label="Filtrar por grupo"
        aria-busy={pending || undefined}
      >
        <span className="flex min-w-0 items-center gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-section-strong" aria-hidden />
          ) : (
            <Layers className="size-4 text-muted-foreground" aria-hidden />
          )}
          <span className="truncate">
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="max-h-80">
        <SelectItem value={DEFAULT}>Grupos abiertos</SelectItem>
        <SelectItem value="all">Todos (incl. cerrados)</SelectItem>
        <SelectItem value="none">Sin grupo</SelectItem>
        {open.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Abiertos</SelectLabel>
              {open.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        {closed.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Cerrados</SelectLabel>
              {closed.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} · cerrado
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        {!known && (
          <>
            <SelectSeparator />
            <SelectItem value={current}>Grupo que no es de este curso</SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
