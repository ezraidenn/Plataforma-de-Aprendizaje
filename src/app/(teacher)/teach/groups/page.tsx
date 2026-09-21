import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Layers, Lock, SearchX } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { listCohorts } from "@/server/services/cohorts";
import { listTeacherCourses } from "@/server/services/courses";
import { ownerNameOf } from "@/server/services/view-context";
import { contextWords, titleWithOwner } from "@/lib/view-context";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { LiveSearch } from "@/components/teach/live-search";
import { formatNumber } from "@/components/teach/format";
import { NewCohortDialog } from "@/components/teach/groups/new-cohort-dialog";
import { CohortCard } from "@/components/teach/groups/cohort-card";
import { CourseFilter } from "@/components/teach/groups/course-filter";
import { StatusTabs } from "@/components/teach/groups/status-tabs";
import {
  GROUPS_PATH,
  groupsHref,
  parseStatusTab,
  type CohortStatusTab,
  type GroupsQuery,
} from "@/components/teach/groups/href";

export const metadata: Metadata = { title: "Grupos" };

const EMPTY_BOX =
  "anim-rise flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]";
const OUTLINE_BTN = buttonVariants({ variant: "outline", className: "h-11 px-4" });

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/**
 * Grupos de los cursos del contexto (maestro: los suyos; admin: según la
 * vista elegida). Cada grupo es propio de un curso. Filtros por URL
 * (?estado=, ?curso=, ?q=) resueltos en el servidor.
 */
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string; curso?: string }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const { estado, q = "", curso: cursoParam } = await searchParams;
  const tab = parseStatusTab(estado);
  const search = q.trim();
  const w = contextWords(scope.kind, ownerNameOf(scope));
  const showOwner = scope.kind === "all";
  const scoped = listTeacherCourses(scope);
  // En «General», cada curso lleva a su dueño: «NOM-035 · Maestro A»
  const ownerByCourse = showOwner
    ? new Map(scoped.map((r) => [r.course.id, r.ownerName]))
    : new Map<string, string>();
  const withOwner = (courseId: string, title: string) =>
    titleWithOwner(title, ownerByCourse.get(courseId), showOwner);

  // Cursos del contexto para el filtro, en orden alfabético
  const courses = scoped
    .map(({ course }) => ({
      id: course.id,
      title: withOwner(course.id, course.title),
      archived: course.status === "archived",
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));
  const course = courses.find((c) => c.id === cursoParam);
  const curso = course?.id;
  // Solo se crean grupos en cursos activos: en uno archivado ya no se inscribe
  const creatable = courses.filter((c) => !c.archived).map(({ id, title }) => ({ id, title }));
  const newCohort =
    creatable.length > 0 ? <NewCohortDialog courses={creatable} defaultCourseId={curso} /> : null;

  // Una sola consulta (con la búsqueda, en todos los cursos) y el reparto por
  // curso y estado en memoria: cada pestaña muestra cuántos coinciden en el
  // curso filtrado, y el estado vacío sabe si hay coincidencias en otros cursos.
  const searched = listCohorts(scope, { status: "all", search }).map((c) => ({
    ...c,
    courseTitle: withOwner(c.courseId, c.courseTitle),
  }));
  const matching = curso ? searched.filter((c) => c.courseId === curso) : searched;
  const counts: Record<CohortStatusTab, number> = {
    open: matching.filter((c) => c.status === "open").length,
    closed: matching.filter((c) => c.status === "closed").length,
    all: matching.length,
  };
  const inTab = (status: "open" | "closed") => tab === "all" || status === tab;
  // Abiertos primero (en «Todos»); dentro de cada estado, el orden del servidor
  const visible = matching
    .filter((c) => inTab(c.status))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));
  const elsewhere = curso
    ? searched.filter((c) => c.courseId !== curso && inTab(c.status)).length
    : 0;
  // ¿Existe algún grupo? (para distinguir «primer uso» de «sin resultados»)
  const anyCohort = search ? listCohorts(scope, { status: "all" }).length > 0 : searched.length > 0;

  const query: GroupsQuery = { tab, curso, q: search || undefined };
  // La búsqueda en vivo conserva pestaña y curso
  const keepParams: Record<string, string> = {};
  if (tab !== "open") keepParams.estado = tab;
  if (curso) keepParams.curso = curso;
  const inCourse = course ? ` en «${course.title}»` : "";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Estudiantes"
        title="Grupos"
        description="Oleadas de alumnos de cada curso. Cerrar un grupo lo saca de las vistas diarias; nada se borra."
        icon={Layers}
        actions={
          anyCohort ? (
            <>
              {(courses.length > 1 || curso) && <CourseFilter query={query} courses={courses} />}
              <LiveSearch
                basePath={GROUPS_PATH}
                initialValue={q}
                placeholder="Buscar grupo o curso…"
                ariaLabel="Buscar grupo por nombre o por curso (filtra al escribir)"
                extraParams={keepParams}
              />
              {newCohort}
            </>
          ) : undefined
        }
      />

      {!anyCohort ? (
        newCohort ? (
          <div className={`${EMPTY_BOX} py-16`}>
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Layers className="size-8" aria-hidden />
            </span>
            <p className="font-heading text-lg font-semibold">
              {w.own ? "Crea tu primer grupo" : "Aún no hay grupos en esta vista"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Cada curso tiene sus grupos: separan oleadas de alumnos, por ejemplo «Ingreso octubre
              2026». Así las listas, reportes y estadísticas del curso muestran solo a quienes
              atiendes ahora, sin borrar a nadie.
            </p>
            {newCohort}
          </div>
        ) : (
          <div className={`${EMPTY_BOX} py-16`}>
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <BookOpen className="size-8" aria-hidden />
            </span>
            <p className="font-heading text-lg font-semibold">
              {courses.length === 0
                ? "Primero crea un curso"
                : w.own
                  ? "No tienes cursos activos"
                  : "No hay cursos activos en esta vista"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {courses.length === 0
                ? "Cada grupo pertenece a un curso y separa sus oleadas de alumnos. Crea tu primer curso y después sus grupos."
                : "Los grupos se crean dentro de un curso activo. Crea un curso nuevo o saca uno del archivo desde «Mis cursos»."}
            </p>
            <Link href="/teach/courses" className={OUTLINE_BTN}>
              {w.own ? "Ir a Mis cursos" : "Ir a Cursos"}
            </Link>
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusTabs query={query} counts={counts} />
            <p className="text-sm text-muted-foreground">
              {search
                ? `${plural(visible.length, "coincidencia", "coincidencias")} para «${search}»${inCourse}`
                : `${plural(visible.length, "grupo", "grupos")}${inCourse}`}
            </p>
          </div>

          {visible.length === 0 ? (
            <div className={`${EMPTY_BOX} py-14`}>
              {search ? (
                <>
                  <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                    <SearchX className="size-8" aria-hidden />
                  </span>
                  <p className="font-heading text-lg font-semibold">
                    Sin resultados para «{search}»{inCourse}
                  </p>
                  {(counts.all > 0 && tab !== "all") || elsewhere > 0 ? (
                    <p className="max-w-sm text-sm text-muted-foreground">
                      {counts.all > 0 && tab !== "all" && (
                        <>Hay {plural(counts.all, "coincidencia", "coincidencias")} en otra pestaña. </>
                      )}
                      {elsewhere > 0 && (
                        <>Hay {plural(elsewhere, "coincidencia", "coincidencias")} en otros cursos.</>
                      )}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {counts.all > 0 && tab !== "all" && (
                      <Link href={groupsHref({ ...query, tab: "all" })} className={OUTLINE_BTN}>
                        Ver en «Todos»
                      </Link>
                    )}
                    {elsewhere > 0 && (
                      <Link href={groupsHref({ ...query, curso: undefined })} className={OUTLINE_BTN}>
                        Buscar en todos los cursos
                      </Link>
                    )}
                    <Link href={groupsHref({ ...query, q: undefined })} className={OUTLINE_BTN}>
                      Limpiar búsqueda
                    </Link>
                  </div>
                </>
              ) : tab === "closed" ? (
                <>
                  <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Lock className="size-8" aria-hidden />
                  </span>
                  <p className="font-heading text-lg font-semibold">
                    {course ? "Este curso no tiene grupos cerrados" : "No hay grupos cerrados"}
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Cuando una oleada termine, ciérrala para despejar las vistas diarias. Sus
                    alumnos, avances y certificados se conservan.
                  </p>
                </>
              ) : (
                <>
                  <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                    <Layers className="size-8" aria-hidden />
                  </span>
                  <p className="font-heading text-lg font-semibold">
                    {!course
                      ? "No hay grupos abiertos"
                      : counts.all === 0
                        ? "Este curso aún no tiene grupos"
                        : "Este curso no tiene grupos abiertos"}
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {course?.archived
                      ? "El curso está archivado: ya no se inscriben alumnos, así que no se le crean grupos."
                      : counts.closed > 0
                        ? "Crea uno para la próxima oleada o reabre alguno desde «Cerrados»."
                        : "Crea uno para separar a la próxima oleada de alumnos del curso."}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {!course?.archived && newCohort}
                    {counts.closed > 0 && (
                      <Link href={groupsHref({ ...query, tab: "closed" })} className={OUTLINE_BTN}>
                        Ver cerrados ({formatNumber(counts.closed)})
                      </Link>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((cohort, i) => (
                <CohortCard
                  key={cohort.id}
                  index={i}
                  cohort={{
                    id: cohort.id,
                    name: cohort.name,
                    status: cohort.status,
                    courseId: cohort.courseId,
                    courseTitle: cohort.courseTitle,
                    createdAt: cohort.createdAt,
                    closedAt: cohort.closedAt,
                    enrollmentCount: cohort.enrollmentCount,
                    completedCount: cohort.completedCount,
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
