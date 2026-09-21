import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/components/teach/format";
import { groupsHref, type CohortStatusTab, type GroupsQuery } from "./href";

const TABS: { value: CohortStatusTab; label: string }[] = [
  { value: "open", label: "Abiertos" },
  { value: "closed", label: "Cerrados" },
  { value: "all", label: "Todos" },
];

/** Pestañas Abiertos / Cerrados / Todos por links (server-side), con conteo. */
export function StatusTabs({
  query,
  counts,
}: {
  /** Pestaña actual; curso y búsqueda se conservan al cambiar de pestaña */
  query: GroupsQuery;
  counts: Record<CohortStatusTab, number>;
}) {
  return (
    <nav
      aria-label="Estado de los grupos"
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
    >
      {TABS.map((tab) => {
        const active = query.tab === tab.value;
        return (
          <Link
            key={tab.value}
            href={groupsHref({ ...query, tab: tab.value })}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-section-strong shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                active ? "bg-section-soft text-section-strong" : "bg-background/70"
              )}
            >
              {formatNumber(counts[tab.value])}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
