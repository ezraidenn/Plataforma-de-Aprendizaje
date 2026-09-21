"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeSearch } from "@/lib/search";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  VIEW_ALL,
  VIEW_OWN,
  contextValue,
  initialsOf,
  type ViewContextInfo,
  type ViewContextOption,
  type ViewContextOptions,
} from "@/lib/view-context";
import { onViewContextBroadcast, useSwitchViewContext } from "./view-context";

/** Con más de 6 maestros aparece el buscador. */
const SEARCH_FROM = 7;

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;
}

/**
 * Selector de contexto del admin, junto a la campana. Solo se ve en el área de
 * maestro (/teach), pero siempre queda montado para seguir a las otras pestañas.
 */
export function ViewContextSwitcher({
  current,
  options,
  selfName,
}: {
  current: ViewContextInfo;
  options: ViewContextOptions;
  selfName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { switchTo, pending } = useSwitchViewContext();
  const value = contextValue(current);
  const valueRef = useRef(value);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(
    () =>
      onViewContextBroadcast((other) => {
        if (other !== valueRef.current) router.refresh();
      }, valueRef.current),
    [router]
  );

  // Volver con «atrás» desde la caché del navegador (bfcache) no pide nada al
  // servidor: se refresca para mostrar el contexto real de la cookie
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [router]);

  if (!pathname.startsWith("/teach")) return null;

  const isOwn = current.kind === "own";
  const label =
    current.kind === "own" ? "Mi contenido" : current.kind === "all" ? "General" : current.ownerName;
  const avatar =
    current.kind === "all" ? "∑" : initialsOf(current.kind === "own" ? selfName : current.ownerName);
  const q = normalizeSearch(query);
  const teachers = q
    ? options.teachers.filter((t) => normalizeSearch(t.name).includes(q))
    : options.teachers;

  function pick(next: string) {
    setOpen(false);
    setQuery("");
    if (next !== value) switchTo(next);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o && pending) return;
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger
        aria-disabled={pending || undefined}
        aria-label={`Viendo: ${label}. Cambiar contexto`}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-disabled:opacity-70",
          isOwn
            ? "border-white/30 bg-section-strong text-white hover:bg-section-strong/85"
            : "border-white bg-white text-section-strong shadow-sm hover:bg-white/90"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-[11px] font-bold",
            isOwn ? "bg-white/25" : "bg-section-soft"
          )}
        >
          {avatar}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{label}</span>
        <ChevronDown className="size-4" aria-hidden />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-72 gap-0 p-1.5"
        aria-label="Cambiar contexto de vista"
        onOpenAutoFocus={(e) => {
          if (searchRef.current) {
            e.preventDefault();
            searchRef.current.focus();
          }
        }}
      >
        <OptionRow option={options.own} avatar={initialsOf(selfName)} selected={value === VIEW_OWN} onPick={pick} />
        <OptionRow option={options.all} avatar="∑" selected={value === VIEW_ALL} onPick={pick} />
        {options.teachers.length > 0 && (
          <>
            <div className="my-1 border-t" />
            <p id="vista-maestros" className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Ver como maestro
            </p>
            {options.teachers.length >= SEARCH_FROM && (
              <div className="relative px-1 pb-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar maestro…"
                  aria-label="Buscar maestro"
                  className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
            <div className="max-h-72 overflow-y-auto" role="group" aria-labelledby="vista-maestros">
              {teachers.map((t) => (
                <OptionRow
                  key={t.value}
                  option={t}
                  avatar={initialsOf(t.name)}
                  selected={value === t.value}
                  onPick={pick}
                />
              ))}
              {teachers.length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">Sin coincidencias</p>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function OptionRow({
  option,
  avatar,
  selected,
  onPick,
}: {
  option: ViewContextOption;
  avatar: string;
  selected: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(option.value)}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        selected && "bg-accent"
      )}
    >
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold"
      >
        {avatar}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {option.name}
          {option.inactive && <span className="font-normal text-muted-foreground"> (inactivo)</span>}
        </span>
        <span className="block text-xs text-muted-foreground">
          {plural(option.courses, "curso", "cursos")} · {plural(option.students, "alumno", "alumnos")}
        </span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}
