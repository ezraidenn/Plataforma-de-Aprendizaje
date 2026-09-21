"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Búsqueda EN VIVO: filtra con cada tecla (debounce 300 ms) navegando con el
 * parámetro ?q= — el filtrado real es server-side, sin botón ni Enter.
 */
export function LiveSearch({
  basePath,
  initialValue,
  placeholder,
  ariaLabel,
  extraParams,
}: {
  basePath: string;
  initialValue: string;
  placeholder: string;
  ariaLabel: string;
  /** Parámetros que deben conservarse al buscar (ej. curso seleccionado) */
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(extraParams);
      const q = value.trim();
      if (q) params.set("q", q);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
      });
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      {pending ? (
        <Loader2
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-section-strong"
          aria-hidden
        />
      ) : (
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      )}
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-11 w-56 pl-9"
      />
    </div>
  );
}
