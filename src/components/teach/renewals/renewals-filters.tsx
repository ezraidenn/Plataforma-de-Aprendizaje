"use client";

import { Fragment, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { LiveSearch } from "@/components/teach/live-search";
import { RENEWALS_PATH, renewalsHref, type RenewalsQuery } from "./href";

const ALL = "all";
const NONE = "none";

export type RenewalsCourseOption = { id: string; title: string; archived: boolean };
export type RenewalsCohortOption = {
  id: string;
  name: string;
  closed: boolean;
  /** Curso al que pertenece (los grupos son propios de cada curso) */
  courseId: string;
  courseTitle: string;
};

type CourseBucket = { courseId: string; courseTitle: string; cohorts: RenewalsCohortOption[] };

/** Abiertos primero; dentro de cada estado se respeta el orden recibido. */
function openFirst(list: RenewalsCohortOption[]): RenewalsCohortOption[] {
  return [...list.filter((c) => !c.closed), ...list.filter((c) => c.closed)];
}

/** Grupos repartidos por curso, cursos en orden alfabético. */
function byCourse(list: RenewalsCohortOption[]): CourseBucket[] {
  const buckets = new Map<string, CourseBucket>();
  for (const cohort of list) {
    const bucket = buckets.get(cohort.courseId) ?? {
      courseId: cohort.courseId,
      courseTitle: cohort.courseTitle,
      cohorts: [],
    };
    bucket.cohorts.push(cohort);
    buckets.set(cohort.courseId, bucket);
  }
  return [...buckets.values()]
    .map((b) => ({ ...b, cohorts: openFirst(b.cohorts) }))
    .sort((a, b) => a.courseTitle.localeCompare(b.courseTitle, "es"));
}

function cohortLabel(cohort: RenewalsCohortOption): string {
  return cohort.closed ? `${cohort.name} (cerrado)` : cohort.name;
}

/** Filtros del panel: curso, grupo y búsqueda en vivo (todo por URL). */
export function RenewalsFilters({
  query,
  courses,
  cohorts,
}: {
  query: RenewalsQuery;
  courses: RenewalsCourseOption[];
  /** Grupos abiertos + los cerrados con certificados en el panel, de todos los cursos */
  cohorts: RenewalsCohortOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Con curso elegido solo se ofrecen SUS grupos; sin curso, todos agrupados por curso
  const courseCohorts = query.course
    ? openFirst(cohorts.filter((c) => c.courseId === query.course))
    : [];
  const openCohorts = courseCohorts.filter((c) => !c.closed);
  const closedCohorts = courseCohorts.filter((c) => c.closed);
  const buckets = query.course ? [] : byCourse(cohorts);

  const selected =
    query.grupo && query.grupo !== NONE ? cohorts.find((c) => c.id === query.grupo) : undefined;
  // Sin curso elegido, el nombre solo no basta (varios cursos pueden tener
  // un grupo con el mismo nombre): se añade el curso
  const grupoLabel = !query.grupo
    ? "Todos los grupos"
    : query.grupo === NONE
      ? "Sin grupo"
      : selected
        ? query.course
          ? cohortLabel(selected)
          : `${cohortLabel(selected)} · ${selected.courseTitle}`
        : "Grupo";

  function go(patch: Partial<RenewalsQuery>) {
    startTransition(() => {
      router.replace(renewalsHref({ ...query, ...patch }), { scroll: false });
    });
  }

  function changeCourse(value: string) {
    const course = value === ALL ? undefined : value;
    // Si el grupo elegido no es del curso nuevo, se limpia
    const keepGrupo =
      !query.grupo || query.grupo === NONE || !course || selected?.courseId === course;
    go({ course, grupo: keepGrupo ? query.grupo : undefined });
  }

  const extraParams: Record<string, string> = { tab: query.tab };
  if (query.course) extraParams.course = query.course;
  if (query.grupo) extraParams.grupo = query.grupo;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      <Select value={query.course || ALL} onValueChange={changeCourse}>
        <SelectTrigger
          className="w-60 max-w-full data-[size=default]:h-11"
          aria-label="Filtrar por curso"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los cursos</SelectItem>
          {courses.map((course) => (
            <SelectItem key={course.id} value={course.id}>
              {course.title}
              {course.archived ? " (archivado)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.grupo || ALL}
        onValueChange={(v) => go({ grupo: v === ALL ? undefined : v })}
      >
        <SelectTrigger
          className="w-60 max-w-full data-[size=default]:h-11"
          aria-label="Filtrar por grupo"
          title={grupoLabel}
        >
          <SelectValue>{grupoLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los grupos</SelectItem>
          <SelectItem value={NONE}>Sin grupo</SelectItem>
          {query.course ? (
            <>
              {openCohorts.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Abiertos</SelectLabel>
                    {openCohorts.map((cohort) => (
                      <SelectItem key={cohort.id} value={cohort.id}>
                        {cohort.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
              {closedCohorts.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Cerrados</SelectLabel>
                    {closedCohorts.map((cohort) => (
                      <SelectItem key={cohort.id} value={cohort.id}>
                        {cohortLabel(cohort)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </>
          ) : (
            buckets.map((bucket) => (
              <Fragment key={bucket.courseId}>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="font-semibold">{bucket.courseTitle}</SelectLabel>
                  {bucket.cohorts.map((cohort) => (
                    <SelectItem key={cohort.id} value={cohort.id}>
                      {cohortLabel(cohort)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </Fragment>
            ))
          )}
        </SelectContent>
      </Select>

      <LiveSearch
        basePath={RENEWALS_PATH}
        initialValue={query.q ?? ""}
        placeholder="Buscar persona o curso…"
        ariaLabel="Buscar por nombre, correo o curso"
        extraParams={extraParams}
      />

      {pending && (
        <span className="inline-flex items-center">
          <Loader2 className="size-4 animate-spin text-section-strong" aria-hidden />
          <span className="sr-only">Actualizando…</span>
        </span>
      )}
    </div>
  );
}
