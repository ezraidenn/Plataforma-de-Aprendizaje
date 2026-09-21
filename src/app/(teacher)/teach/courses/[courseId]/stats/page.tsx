import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartColumn, Layers, UserPlus } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse, listCourseStudents } from "@/server/services/courses";
import { cohortOptions, parseCohortFilter } from "@/server/services/cohorts";
import { courseStats } from "@/server/services/stats";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { StatTiles } from "@/components/teach/stats/stat-tiles";
import { ProgressBucketsCard } from "@/components/teach/stats/progress-buckets-card";
import { ItemCompletionCard } from "@/components/teach/stats/item-completion-card";
import { ExamStatsCard } from "@/components/teach/stats/exam-stats-card";
import { CohortFilter } from "@/components/teach/cohort-filter";
import { TabHeading } from "@/components/teach/tab-heading";

export const metadata: Metadata = { title: "Estadísticas" };

/**
 * Estadísticas del curso para el maestro. Formas según la guía de dataviz:
 * stat tiles para KPIs, barras horizontales de UN solo matiz (la identidad de
 * cada fila la dan etiqueta + icono de tipo), verde solo como estado y línea
 * de referencia en la calificación mínima. El CSV por estudiante vive en
 * Reportes — aquí no se duplica. El selector de grupo (`?grupo=`) acota todo.
 */
export default async function CourseStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ grupo?: string }>;
}) {
  const user = await requireTeacher();
  const { courseId } = await params;
  const { grupo: grupoParam } = await searchParams;
  const course = getOwnedCourse(courseId, user);
  if (!course) notFound();

  const grupo = grupoParam?.trim() || "";
  const cohort = parseCohortFilter(grupo);
  // Grupos del curso (abiertos y cerrados, también los vacíos) para el filtro
  const cohorts = cohortOptions(courseId, { includeClosed: true });
  const showFilter = cohorts.length > 0 || cohort.kind !== "default";
  const filterEl = showFilter ? <CohortFilter options={cohorts} value={grupo} /> : undefined;

  const stats = courseStats(courseId, { cohort });
  const basePath = `/teach/courses/${courseId}/stats`;
  const reportsHref = `/teach/reports?course=${courseId}${
    grupo ? `&grupo=${encodeURIComponent(grupo)}` : ""
  }`;

  // Estado vacío
  if (stats.enrolled === 0) {
    // Con matrículas fuera del filtro de grupo: no es «curso vacío». Un grupo
    // cerrado no basta como pista (puede estar vacío): se cuenta de verdad.
    const filteredOut =
      cohort.kind !== "default" ||
      (cohorts.some((c) => c.status === "closed") &&
        listCourseStudents(courseId, { cohort: { kind: "all" } }).length > 0);
    return (
      <div className="space-y-4">
        <TabHeading title="Estadísticas" icon={ChartColumn} actions={filterEl} />
        {filteredOut ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Layers className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              {cohort.kind === "default"
                ? "Nadie de los grupos abiertos está matriculado en este curso."
                : cohort.kind === "none"
                  ? "Todos los estudiantes de este curso tienen grupo."
                  : "Nadie de este curso está en el grupo elegido."}
            </p>
            <Link
              href={cohort.kind === "default" ? `${basePath}?grupo=all` : basePath}
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
              Este curso aún no tiene estudiantes matriculados. Las estadísticas
              aparecerán con la primera matrícula.
            </p>
            <Link
              href={`/teach/courses/${courseId}/students`}
              className={cn(
                buttonVariants(),
                "h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90"
              )}
            >
              <UserPlus aria-hidden />
              Matricular estudiantes
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TabHeading
        title="Estadísticas"
        icon={ChartColumn}
        description={
          <>
            Avance del grupo en este curso. El detalle por estudiante (y el CSV) está en{" "}
            <Link
              href={reportsHref}
              className="font-medium text-section-strong underline-offset-2 hover:underline"
            >
              Reportes
            </Link>
            .
          </>
        }
        actions={filterEl}
      />

      <StatTiles
        enrolled={stats.enrolled}
        started={stats.started}
        completed={stats.completed}
        completionRate={stats.completionRate}
        avgProgress={stats.avgProgress}
        avgTotalSeconds={stats.avgTotalSeconds}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ProgressBucketsCard buckets={stats.progressBuckets} enrolled={stats.enrolled} />
        <ItemCompletionCard
          items={stats.itemCompletion}
          enrolled={stats.enrolled}
          courseId={courseId}
        />
      </div>

      {stats.exams.length > 0 && <ExamStatsCard exams={stats.exams} />}
    </div>
  );
}
