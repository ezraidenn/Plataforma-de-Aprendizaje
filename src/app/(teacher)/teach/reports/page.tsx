import type { Metadata } from "next";
import Link from "next/link";
import {
  Award,
  ChartNoAxesCombined,
  CircleCheck,
  FolderPlus,
  Layers,
  Search,
  SearchX,
  Sparkles,
  UserPlus,
} from "lucide-react";
import Form from "next/form";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { listCourseStudents, listTeacherCourses } from "@/server/services/courses";
import { cohortOptions, parseCohortFilter } from "@/server/services/cohorts";
import { courseMatrix, type MatrixFilter } from "@/server/services/reports";
import { ownerNameOf } from "@/server/services/view-context";
import { cn } from "@/lib/utils";
import { contextWords, titleWithOwner, VIEW_ALL } from "@/lib/view-context";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewCourseDialog } from "@/components/teach/new-course-dialog";
import { SwitchContextButton } from "@/components/teach/switch-context-button";
import { Pagination } from "@/components/teach/pagination";
import { formatNumber } from "@/components/teach/format";
import { CohortFilter } from "@/components/teach/cohort-filter";
import { CourseSelect } from "@/components/teach/reports/course-select";
import { FilterTabs } from "@/components/teach/reports/filter-tabs";
import { ExportCsvButton } from "@/components/teach/reports/export-csv-button";
import { MatrixTable } from "@/components/teach/reports/matrix-table";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Reportes" };

const FILTERS: readonly MatrixFilter[] = ["all", "at_risk", "completed"];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    course?: string;
    q?: string;
    filter?: string;
    page?: string;
    grupo?: string;
  }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const {
    course: courseParam,
    q = "",
    filter: filterParam,
    page: pageParam,
    grupo: grupoParam,
  } = await searchParams;
  const grupo = grupoParam?.trim() || "";
  const cohort = parseCohortFilter(grupo);
  const w = contextWords(scope.kind, ownerNameOf(scope));

  // Cursos del contexto (publicados y borradores); listTeacherCourses ya filtra por contexto
  const courses = listTeacherCourses(scope)
    .filter(({ course }) => course.status !== "archived")
    .map(({ course, ownerName }) => ({
      id: course.id,
      title: titleWithOwner(course.title, ownerName, scope.kind === "all"),
      status: course.status,
    }));

  if (courses.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Reportes"
          title="Progreso por estudiante"
          description="Matriz de avance, riesgo y aprobación por curso."
          icon={ChartNoAxesCombined}
        />
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <Sparkles className="size-8" aria-hidden />
          </span>
          <p className="max-w-sm text-sm text-muted-foreground">
            {w.own
              ? "Crea tu primer curso para ver aquí el progreso de tus estudiantes."
              : "Aún no hay cursos en esta vista."}
          </p>
          <NewCourseDialog />
        </div>
      </div>
    );
  }

  const selected = courses.find((c) => c.id === courseParam) ?? courses[0];
  // El curso pedido (p. ej. desde el perfil del alumno) no está en este
  // contexto: el admin puede cambiar a General para verlo
  const courseOutOfContext =
    Boolean(courseParam) &&
    !courses.some((c) => c.id === courseParam) &&
    user.role === "admin" &&
    scope.kind !== "all";
  const filter: MatrixFilter = FILTERS.includes(filterParam as MatrixFilter)
    ? (filterParam as MatrixFilter)
    : "all";

  let page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  let matrix = courseMatrix(selected.id, { page, pageSize: 50, search: q, filter, cohort });
  const totalPages = Math.max(1, Math.ceil(matrix.total / matrix.pageSize));
  if (page > totalPages) {
    page = 1;
    matrix = courseMatrix(selected.id, { page: 1, pageSize: 50, search: q, filter, cohort });
  }
  const { columns, rows, total } = matrix;

  // Grupos del curso (abiertos y cerrados, también los vacíos) para el filtro
  const cohorts = cohortOptions(selected.id, { includeClosed: true });
  const showCohortFilter = cohorts.length > 0 || cohort.kind !== "default";
  // Sin resultados con el filtro por defecto: ¿hay matrículas escondidas en
  // grupos cerrados? Un grupo cerrado ya no basta como pista (puede estar vacío).
  const hiddenInClosed =
    total === 0 &&
    !q &&
    filter === "all" &&
    cohort.kind === "default" &&
    cohorts.some((c) => c.status === "closed") &&
    listCourseStudents(selected.id, { cohort: { kind: "all" } }).length > 0;

  /** Href del reporte conservando curso y grupo (la página se reinicia). */
  const reportHref = (opts: { q?: string; filter?: MatrixFilter; grupo?: string }) => {
    const params = new URLSearchParams({ course: selected.id });
    if (opts.q) params.set("q", opts.q);
    if (opts.filter && opts.filter !== "all") params.set("filter", opts.filter);
    if (opts.grupo) params.set("grupo", opts.grupo);
    return `/teach/reports?${params.toString()}`;
  };
  const clearSearchHref = reportHref({ filter, grupo });
  const allHref = reportHref({ q, grupo });

  return (
    <div className="space-y-6">
      {courseOutOfContext && (
        <p className="rounded-xl border border-primary/20 bg-brand-tint px-4 py-3 text-sm text-primary">
          Ese curso está fuera de esta vista ·{" "}
          <SwitchContextButton value={VIEW_ALL}>Ver en General</SwitchContextButton>
        </p>
      )}
      <PageHeader
        eyebrow="Reportes"
        title="Progreso por estudiante"
        description="Matriz de avance, riesgo y aprobación del curso seleccionado."
        icon={ChartNoAxesCombined}
        actions={
          <>
            <CourseSelect courses={courses} value={selected.id} />
            {showCohortFilter && <CohortFilter options={cohorts} value={grupo} />}
            <Form action="/teach/reports" className="relative">
              <input type="hidden" name="course" value={selected.id} />
              {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
              {grupo && <input type="hidden" name="grupo" value={grupo} />}
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar alumno…"
                className="h-11 w-56 pl-9"
                aria-label="Buscar alumno por nombre o correo"
              />
            </Form>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs courseId={selected.id} q={q} filter={filter} grupo={grupo} />
        <ExportCsvButton
          courseId={selected.id}
          courseTitle={selected.title}
          search={q}
          filter={filter}
          grupo={grupo}
        />
      </div>

      {columns.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <FolderPlus className="size-8" aria-hidden />
          </span>
          <p className="max-w-sm text-sm text-muted-foreground">
            Este curso aún no tiene contenido obligatorio que medir. Agrega lecciones,
            exámenes o tareas marcadas como requeridas.
          </p>
          <Link
            href={`/teach/courses/${selected.id}/content`}
            className={buttonVariants({ variant: "outline" })}
          >
            Ir al contenido
          </Link>
        </div>
      ) : total === 0 ? (
        q ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <SearchX className="size-8" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">Sin resultados para «{q}»</p>
            <Link href={clearSearchHref} className={buttonVariants({ variant: "outline" })}>
              Limpiar búsqueda
            </Link>
          </div>
        ) : filter === "at_risk" ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-success/10 text-progress-ring">
              <CircleCheck className="size-8" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">
              Nadie está en riesgo en este curso. Buen trabajo.
            </p>
            <Link href={allHref} className={buttonVariants({ variant: "outline" })}>
              Ver todos
            </Link>
          </div>
        ) : filter === "completed" ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Award className="size-8" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">
              Aún nadie ha completado este curso.
            </p>
            <Link href={allHref} className={buttonVariants({ variant: "outline" })}>
              Ver todos
            </Link>
          </div>
        ) : cohort.kind !== "default" || hiddenInClosed ? (
          // Hay matrículas, pero el filtro de grupo las deja fuera
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Layers className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              {cohort.kind === "default"
                ? "Nadie de los grupos abiertos está matriculado en este curso."
                : cohort.kind === "none"
                  ? "Todos los estudiantes de este curso tienen grupo."
                  : "Nadie de este curso coincide con el grupo elegido."}
            </p>
            <Link
              href={reportHref({ grupo: cohort.kind === "default" ? "all" : undefined })}
              className={buttonVariants({ variant: "outline" })}
            >
              {cohort.kind === "default" ? "Ver todos (incl. cerrados)" : "Ver grupos abiertos"}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <UserPlus className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              Este curso aún no tiene estudiantes matriculados.
            </p>
            <Link
              href={`/teach/courses/${selected.id}/students`}
              className={cn(
                buttonVariants(),
                "h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90"
              )}
            >
              <UserPlus aria-hidden />
              Matricular estudiantes
            </Link>
          </div>
        )
      ) : (
        <>
          <MatrixTable courseId={selected.id} columns={columns} rows={rows} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {formatNumber(total)} {total === 1 ? "estudiante" : "estudiantes"}
            </p>
            <Pagination
              basePath="/teach/reports"
              page={page}
              totalPages={totalPages}
              params={{
                course: selected.id,
                q: q || undefined,
                filter: filter !== "all" ? filter : undefined,
                grupo: grupo || undefined,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
