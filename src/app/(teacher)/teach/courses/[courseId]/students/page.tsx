import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Layers, Lock, Users } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import {
  getOwnedCourse,
  listCourseStudents,
  listDroppedEnrollments,
} from "@/server/services/courses";
import { cohortOptions, importableCohorts, parseCohortFilter } from "@/server/services/cohorts";
import { courseProgress } from "@/server/services/progress";
import { buttonVariants } from "@/components/ui/button";
import { EnrollDialog } from "@/components/teach/students/enroll-dialog";
import { RosterCsvDialog } from "@/components/teach/bulk/roster-csv-dialog";
import { AiImportStudentsDialog } from "@/components/teach/students/ai-import-students-dialog";
import { getAiSettings } from "@/server/services/ai-settings";
import {
  CourseRosterTable,
  type RosterRow,
} from "@/components/teach/students/course-roster-table";
import { TrashSheet, type TrashRow } from "@/components/teach/students/trash-sheet";
import { CohortFilter } from "@/components/teach/cohort-filter";
import { Pagination } from "@/components/teach/pagination";
import { formatDate, formatDateTime, formatNumber } from "@/components/teach/format";
import { TabHeading } from "@/components/teach/tab-heading";

export const metadata: Metadata = { title: "Estudiantes del curso" };

const PAGE_SIZE = 50;

export default async function CourseStudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ page?: string; grupo?: string }>;
}) {
  const user = await requireTeacher();
  const { courseId } = await params;
  const { page: pageParam, grupo } = await searchParams;
  const course = getOwnedCourse(courseId, user);
  if (!course) notFound();

  // Grupos de este curso (abiertos y cerrados, también los vacíos) para filtro e insignias
  const cohortFilter = parseCohortFilter(grupo);
  const cohorts = cohortOptions(courseId, { includeClosed: true });
  // Grupos con alumnos de mis otros cursos, para «Traer grupo de otro curso»
  const importable = importableCohorts(user, courseId);
  const closedIds = new Set(cohorts.filter((c) => c.status === "closed").map((c) => c.id));
  const cohortNames = new Map(cohorts.map((c) => [c.id, c.name]));

  const all = listCourseStudents(courseId, { cohort: cohortFilter });
  // Con el filtro por defecto, los de grupos cerrados no se ven: se avisa cuántos son
  const hiddenInClosed =
    cohortFilter.kind === "default" && closedIds.size > 0
      ? listCourseStudents(courseId, { cohort: { kind: "all" } }).length - all.length
      : 0;

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(pageParam ?? "1", 10) || 1));
  const pageRows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // El % de progreso solo se calcula para la página visible
  const rows: RosterRow[] = pageRows.map((row) => ({
    enrollmentId: row.enrollmentId,
    studentId: row.studentId,
    fullName: row.fullName,
    email: row.email,
    completed: row.status === "completed",
    enrolledLabel: formatDate(row.enrolledAt),
    cycle: row.cycle,
    cohortName: row.cohortName,
    cohortClosed: row.cohortId ? closedIds.has(row.cohortId) : false,
    percent: courseProgress(courseId, row.studentId).percent,
  }));

  // Papelera: bajas reversibles del ciclo vigente
  const trash: TrashRow[] = listDroppedEnrollments(courseId).map((row) => ({
    enrollmentId: row.enrollmentId,
    studentId: row.studentId,
    fullName: row.fullName,
    email: row.email,
    cycle: row.cycle,
    droppedAtMs: row.droppedAt ? row.droppedAt.getTime() : null,
    droppedAtLabel: row.droppedAt ? formatDateTime(row.droppedAt) : "",
    droppedFrom: row.droppedFrom,
    droppedByName: row.droppedByName,
    cohortName: row.cohortId ? (cohortNames.get(row.cohortId) ?? null) : null,
    certificateFolio: row.certificateFolio,
  }));

  const basePath = `/teach/courses/${courseId}/students`;
  const selectedCohortName =
    cohortFilter.kind === "one" ? (cohortNames.get(cohortFilter.id) ?? null) : null;
  // Al matricular desde un grupo abierto filtrado, se preselecciona ese grupo
  const defaultCohortId =
    cohortFilter.kind === "one" && !closedIds.has(cohortFilter.id) ? cohortFilter.id : null;
  const showFilter = cohorts.length > 0 || cohortFilter.kind !== "default";
  const filterEl = showFilter ? <CohortFilter options={cohorts} value={grupo} /> : null;

  const n = all.length;
  const countText = `${formatNumber(n)} ${n === 1 ? "estudiante" : "estudiantes"}`;
  const description =
    cohortFilter.kind === "one" ? (
      `${countText} en «${selectedCohortName ?? "este grupo"}»`
    ) : cohortFilter.kind === "none" ? (
      `${countText} sin grupo`
    ) : cohortFilter.kind === "all" ? (
      `${countText} ${n === 1 ? "matriculado" : "matriculados"} (incluye grupos cerrados)`
    ) : n === 0 && hiddenInClosed === 0 ? (
      "Nadie está matriculado todavía"
    ) : (
      <>
        {countText} {n === 1 ? "matriculado" : "matriculados"}
        {hiddenInClosed > 0 && (
          <>
            {" · "}
            <Link
              href={`${basePath}?grupo=all`}
              className="font-medium text-section-strong underline-offset-2 hover:underline"
            >
              {formatNumber(hiddenInClosed)} más en grupos cerrados
            </Link>
          </>
        )}
      </>
    );

  return (
    <div className="space-y-4">
      <TabHeading
        title="Estudiantes"
        icon={Users}
        description={description}
        actions={
          <>
            <TrashSheet courseId={courseId} rows={trash} />
            <RosterCsvDialog courseId={courseId} />
            {getAiSettings().configured && course.status !== "archived" && (
              <AiImportStudentsDialog
                courses={[{ id: course.id, title: course.title }]}
                defaultCourseId={course.id}
              />
            )}
            <EnrollDialog
              courseId={courseId}
              defaultCohortId={defaultCohortId}
              courseCohorts={cohorts}
              importable={importable}
              urlTrigger
            />
          </>
        }
      />

      {n === 0 ? (
        <>
          {filterEl && <div className="flex flex-wrap items-center gap-2">{filterEl}</div>}
          <div className="anim-rise flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-16 text-center">
            {cohortFilter.kind !== "default" ? (
              <>
                <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                  <Layers className="size-8" aria-hidden />
                </span>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {cohortFilter.kind === "none"
                    ? "Todos los estudiantes de este curso tienen grupo."
                    : "Nadie de este curso está en ese grupo."}
                </p>
                <Link href={basePath} className={buttonVariants({ variant: "outline", className: "h-11 px-4" })}>
                  Ver grupos abiertos
                </Link>
              </>
            ) : hiddenInClosed > 0 ? (
              <>
                <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Lock className="size-8" aria-hidden />
                </span>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Los {formatNumber(hiddenInClosed)} estudiantes de este curso están en grupos
                  cerrados. Siguen aquí: solo están fuera de la vista diaria.
                </p>
                <Link
                  href={`${basePath}?grupo=all`}
                  className={buttonVariants({ variant: "outline", className: "h-11 px-4" })}
                >
                  Ver todos (incl. cerrados)
                </Link>
              </>
            ) : (
              <>
                <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                  <Users className="size-8" aria-hidden />
                </span>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Matricula estudiantes para que puedan ver este curso cuando lo publiques.
                </p>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <CourseRosterTable
            key={`${page}|${grupo ?? ""}`}
            courseId={courseId}
            rows={rows}
            allEnrollmentIds={totalPages > 1 ? all.map((r) => r.enrollmentId) : undefined}
            toolbar={filterEl}
          />

          <Pagination
            basePath={basePath}
            page={page}
            totalPages={totalPages}
            params={{ grupo: grupo || undefined }}
          />
        </>
      )}
    </div>
  );
}
