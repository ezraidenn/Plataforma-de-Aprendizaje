import Link from "next/link";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "at_risk", label: "En riesgo" },
  { value: "completed", label: "Completados" },
] as const;

export type MatrixFilterValue = (typeof OPTIONS)[number]["value"];

/** Filtro server-side por links: preserva curso, búsqueda y grupo; resetea la página. */
export function FilterTabs({
  courseId,
  q,
  filter,
  grupo,
}: {
  courseId: string;
  q: string;
  filter: MatrixFilterValue;
  /** Valor crudo de `?grupo=` (se conserva al cambiar de pestaña) */
  grupo?: string;
}) {
  const href = (value: MatrixFilterValue) => {
    const params = new URLSearchParams({ course: courseId });
    if (q) params.set("q", q);
    if (value !== "all") params.set("filter", value);
    if (grupo) params.set("grupo", grupo);
    return `/teach/reports?${params.toString()}`;
  };

  return (
    <nav
      aria-label="Filtro de estudiantes"
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
    >
      {OPTIONS.map((option) => {
        const active = filter === option.value;
        return (
          <Link
            key={option.value}
            href={href(option.value)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
              active
                ? "bg-card text-section-strong shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
