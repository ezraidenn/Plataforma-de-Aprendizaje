import Link from "next/link";
import { BookOpen, Layers, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/components/teach/format";
import { CohortActions } from "./cohort-actions";

export type CohortCardData = {
  id: string;
  name: string;
  status: "open" | "closed";
  /** Curso al que pertenece (los grupos son propios de cada curso) */
  courseId: string;
  courseTitle: string;
  createdAt: Date;
  closedAt: Date | null;
  enrollmentCount: number;
  completedCount: number;
};

/** Tarjeta de un grupo: curso, estado, matrículas, aprobados y % de aprobación. */
export function CohortCard({ cohort, index = 0 }: { cohort: CohortCardData; index?: number }) {
  const isOpen = cohort.status === "open";
  const enrolled = Number(cohort.enrollmentCount) || 0;
  const completed = Number(cohort.completedCount) || 0;
  const rate = enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0;
  const studentsHref = `/teach/courses/${encodeURIComponent(cohort.courseId)}/students?grupo=${encodeURIComponent(cohort.id)}`;

  return (
    <article
      aria-labelledby={`cohort-${cohort.id}-title`}
      className={cn(
        "anim-rise card-lift flex flex-col rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]",
        `anim-d${Math.min(index + 1, 5)}`,
        !isOpen && "bg-card/80"
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              isOpen ? "bg-section-soft text-section-strong" : "bg-muted text-muted-foreground"
            )}
          >
            {isOpen ? (
              <Layers className="size-5" aria-hidden />
            ) : (
              <Lock className="size-5" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <h2
              id={`cohort-${cohort.id}-title`}
              className="line-clamp-2 break-words font-heading text-base font-semibold leading-tight"
              title={cohort.name}
            >
              {cohort.name}
            </h2>
            <Link
              href={studentsHref}
              title={`${cohort.courseTitle}: ver los estudiantes de este grupo`}
              className="mt-1 flex min-w-0 items-center gap-1.5 rounded-sm text-sm font-medium text-section-strong transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookOpen className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{cohort.courseTitle}</span>
              <span className="sr-only">: ver los estudiantes de este grupo</span>
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Creado {formatDate(cohort.createdAt)}
              {!isOpen && cohort.closedAt && <> · Cerrado {formatDate(cohort.closedAt)}</>}
            </p>
          </div>
        </div>
        {isOpen ? (
          <Badge variant="secondary" className="shrink-0 bg-success/10 text-success">
            Abierto
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0 text-muted-foreground">
            Cerrado
          </Badge>
        )}
      </header>

      <dl className="mt-5 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-secondary/60 px-2 py-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Matrículas
          </dt>
          <dd className="mt-0.5 font-heading text-xl font-bold tabular-nums">
            {formatNumber(enrolled)}
          </dd>
        </div>
        <div className="rounded-xl bg-secondary/60 px-2 py-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Aprobados
          </dt>
          <dd className="mt-0.5 font-heading text-xl font-bold tabular-nums">
            {formatNumber(completed)}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Aprobación</span>
          <span className="font-semibold tabular-nums text-foreground">
            {enrolled > 0 ? `${rate}%` : "—"}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn("h-full rounded-full", isOpen ? "bg-section" : "bg-locked")}
            style={{ width: `${rate}%` }}
          />
        </div>
        <p className="sr-only">
          {enrolled > 0
            ? `${rate}% de aprobación: ${completed} de ${enrolled} matrículas`
            : "Sin matrículas todavía"}
        </p>
      </div>

      <footer className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <CohortActions
          cohort={{
            id: cohort.id,
            name: cohort.name,
            status: cohort.status,
            enrollmentCount: enrolled,
          }}
        />
      </footer>
    </article>
  );
}
