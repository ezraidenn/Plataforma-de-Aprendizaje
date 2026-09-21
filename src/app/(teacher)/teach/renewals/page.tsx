import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CalendarClock, CircleCheck, SearchX, type LucideIcon } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { DISMISS_REASONS, listRenewals, type DismissReason } from "@/server/services/renewals";
import { cohortOptionsForUser } from "@/server/services/cohorts";
import { listTeacherCourses } from "@/server/services/courses";
import { cn } from "@/lib/utils";
import { titleWithOwner } from "@/lib/view-context";
import { EXPIRING_WINDOW_DAYS } from "@/lib/validity";
import { calendarDaysFrom, formatShortDate, relativeDaysLabel } from "@/lib/validity-format";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { formatNumber } from "@/components/teach/format";
import { renewalsHref, type RenewalsQuery } from "@/components/teach/renewals/href";
import { RenewalsTabs } from "@/components/teach/renewals/renewals-tabs";
import {
  RenewalsFilters,
  type RenewalsCohortOption,
} from "@/components/teach/renewals/renewals-filters";
import { RenewalsTable, type RenewalItem } from "@/components/teach/renewals/renewals-table";

export const metadata: Metadata = { title: "Vencimientos" };

/** Por vencer en estos días o menos: se resalta en la tabla. */
const URGENT_DAYS = 7;

/** YYYY-MM-DD en hora local del servidor (columna de fecha del CSV). */
function isoDay(value: Date | number): string {
  const d = typeof value === "number" ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function EmptyState({
  icon: Icon,
  tone,
  title,
  text,
  children,
}: {
  icon: LucideIcon;
  tone: "success" | "section";
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="anim-rise anim-d2 flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <span
        className={cn(
          "anim-pop flex size-16 items-center justify-center rounded-full",
          tone === "success" ? "bg-success/10 text-success" : "bg-section-soft text-section-strong"
        )}
      >
        <Icon className="size-8" aria-hidden />
      </span>
      <p className="font-heading text-lg font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * Panel de vencimientos (/teach/renewals). Sin avisos ni reinscripciones
 * automáticas: el maestro decide caso por caso. Filtros por URL (?tab=,
 * ?course=, ?grupo=, ?q=) resueltos en el servidor.
 */
export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; course?: string; grupo?: string; q?: string }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const showOwner = scope.kind === "all";
  const scoped = listTeacherCourses(scope);
  // En «General», cada curso lleva a su dueño: «NOM-035 · Maestro A»
  const ownerByCourse = showOwner
    ? new Map(scoped.map((r) => [r.course.id, r.ownerName]))
    : new Map<string, string>();
  const withOwner = (courseId: string, title: string) =>
    titleWithOwner(title, ownerByCourse.get(courseId), showOwner);

  // Listas completas de ambas pestañas: dan los conteos (iguales a los del
  // menú solo en «Mi contenido») y los grupos cerrados que tienen
  // certificados en el panel
  const unfiltered = {
    expired: listRenewals(scope, { tab: "expired" }),
    expiring: listRenewals(scope, { tab: "expiring" }),
  };
  const counts = { expired: unfiltered.expired.length, expiring: unfiltered.expiring.length };
  const tab: RenewalsQuery["tab"] =
    sp.tab === "expired" || sp.tab === "expiring"
      ? sp.tab
      : counts.expired > 0
        ? "expired"
        : "expiring";

  // Cursos del contexto para el filtro, en orden alfabético
  const courses = scoped
    .map(({ course }) => ({
      id: course.id,
      title: withOwner(course.id, course.title),
      archived: course.status === "archived",
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));
  const course = courses.some((c) => c.id === sp.course) ? sp.course : undefined;

  // Grupos del selector (de los cursos del maestro, cada uno con su curso): los
  // abiertos y, además, los CERRADOS que tienen certificados en el panel (la
  // oleada que vence suele estar ya cerrada). Sin filtro = todos, incl. cerrados.
  const allCohorts = cohortOptionsForUser(scope, { includeClosed: true });
  const closedIds = new Set(allCohorts.filter((c) => c.status === "closed").map((c) => c.id));
  // Un grupo que no es del curso filtrado no aplica (los grupos son de cada curso)
  const grupoCohort = allCohorts.find((c) => c.id === sp.grupo);
  const grupo =
    sp.grupo === "none"
      ? "none"
      : grupoCohort && (!course || grupoCohort.courseId === course)
        ? grupoCohort.id
        : undefined;
  const panelCohortIds = new Set(
    [...unfiltered.expired, ...unfiltered.expiring]
      .map((r) => r.cohortId)
      .filter((id): id is string => id !== null)
  );
  const filterCohorts: RenewalsCohortOption[] = allCohorts
    .filter((c) => c.status === "open" || panelCohortIds.has(c.id) || c.id === grupo)
    .map((c) => ({
      id: c.id,
      name: c.name,
      closed: c.status === "closed",
      courseId: c.courseId,
      courseTitle: withOwner(c.courseId, c.courseTitle),
    }));
  // Para «Reinscribir»: grupos abiertos con su curso (el diálogo ofrece los del
  // curso de la selección)
  const openCohorts = allCohorts
    .filter((c) => c.status === "open")
    .map((c) => ({ id: c.id, name: c.name, courseId: c.courseId }));

  const query: RenewalsQuery = { tab, course, grupo, q: q || undefined };
  const filtered = Boolean(course || grupo || q);

  const rows = filtered
    ? listRenewals(scope, { tab, courseId: course, cohortId: grupo, search: q })
    : unfiltered[tab];

  const now = Date.now();
  const items: RenewalItem[] = rows.map((r) => ({
    certificateId: r.certificateId,
    folio: r.folio,
    studentId: r.studentId,
    studentName: r.studentName,
    email: r.email,
    studentActive: r.studentActive,
    courseId: r.courseId,
    courseTitle: withOwner(r.courseId, r.courseTitle),
    cycle: r.cycle,
    cohortName: r.cohortName,
    cohortClosed: r.cohortId ? closedIds.has(r.cohortId) : false,
    expiresLabel: formatShortDate(r.expiresAt),
    relativeLabel: relativeDaysLabel(r.expiresAt, now),
    urgent: tab === "expiring" && calendarDaysFrom(now, r.expiresAt) <= URGENT_DAYS,
    expiresIso: isoDay(r.expiresAt),
    issuedIso: isoDay(r.issuedAt),
  }));

  const reasons = (Object.entries(DISMISS_REASONS) as [DismissReason, string][]).map(
    ([value, label]) => ({ value, label })
  );

  const otherTab = tab === "expired" ? "expiring" : "expired";
  const otherCount = counts[otherTab];
  const nothingAtAll = counts.expired === 0 && counts.expiring === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Certificados"
        title="Vencimientos"
        description="Certificados por vencer y vencidos. Tú decides a quién reinscribir: nada se hace automáticamente."
        icon={CalendarClock}
      />

      <div className="anim-rise anim-d1 flex flex-wrap items-center justify-between gap-3">
        <RenewalsTabs query={query} counts={counts} />
        <RenewalsFilters query={query} courses={courses} cohorts={filterCohorts} />
      </div>

      {items.length > 0 ? (
        <RenewalsTable
          key={`${tab}|${course ?? ""}|${grupo ?? ""}|${q}`}
          tab={tab}
          items={items}
          filtered={filtered}
          cohorts={openCohorts}
          reasons={reasons}
        />
      ) : filtered ? (
        <EmptyState
          icon={SearchX}
          tone="section"
          title="Sin resultados"
          text={
            q
              ? `No hay coincidencias para «${q}» en ${tab === "expired" ? "Vencidos" : "Por vencer"}.`
              : `Nadie coincide con estos filtros en ${tab === "expired" ? "Vencidos" : "Por vencer"}.`
          }
        >
          <Link href={renewalsHref({ tab })} className={buttonVariants({ variant: "outline" })}>
            Limpiar filtros
          </Link>
        </EmptyState>
      ) : (
        <EmptyState
          icon={tab === "expired" ? CircleCheck : CalendarCheck}
          tone="success"
          title={
            tab === "expired"
              ? "No hay certificados vencidos por atender"
              : `Nada vence en los próximos ${EXPIRING_WINDOW_DAYS} días`
          }
          text={
            nothingAtAll
              ? "Cuando un certificado con vigencia se acerque a su fecha aparecerá aquí. La vigencia se configura en los Ajustes de cada curso."
              : tab === "expired"
                ? "Todo al día. Cuando un certificado venza aparecerá aquí para que decidas si reinscribir o descartar."
                : "Aquí verás con anticipación los certificados que están por vencer."
          }
        >
          {otherCount > 0 && (
            <Link
              href={renewalsHref({ tab: otherTab })}
              className={buttonVariants({ variant: "outline" })}
            >
              Ver {otherTab === "expired" ? "vencidos" : "por vencer"} ({formatNumber(otherCount)})
            </Link>
          )}
        </EmptyState>
      )}
    </div>
  );
}
