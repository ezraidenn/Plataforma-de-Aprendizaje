import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/components/teach/format";
import { renewalsHref, type RenewalsQuery, type RenewalsTabValue } from "./href";

const TABS: { value: RenewalsTabValue; label: string }[] = [
  { value: "expiring", label: "Por vencer" },
  { value: "expired", label: "Vencidos" },
];

/**
 * Pestañas por enlaces (?tab=): conservan curso, grupo y búsqueda. Los
 * conteos son globales del maestro, como el del menú (informativos).
 */
export function RenewalsTabs({
  query,
  counts,
}: {
  query: RenewalsQuery;
  counts: Record<RenewalsTabValue, number>;
}) {
  return (
    <nav
      aria-label="Vista de vencimientos"
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
    >
      {TABS.map((tab) => {
        const active = query.tab === tab.value;
        return (
          <Link
            key={tab.value}
            href={renewalsHref({ ...query, tab: tab.value })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
              active
                ? "bg-card text-section-strong shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
                active ? "bg-section-strong text-white" : "bg-background text-muted-foreground"
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
