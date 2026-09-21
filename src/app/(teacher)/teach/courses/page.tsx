import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Search, Sparkles, Users } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { listTeacherCourses } from "@/server/services/courses";
import { ownerNameOf } from "@/server/services/view-context";
import { contextWords } from "@/lib/view-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseCover } from "@/components/course-cover";
import { PageHeader } from "@/components/shell/page-header";
import { LiveSearch } from "@/components/teach/live-search";
import { NewCourseDialog } from "@/components/teach/new-course-dialog";
import { CourseStatusBadge } from "@/components/teach/course-status-badge";
import { OwnerTag } from "@/components/teach/owner-tag";
import { formatNumber } from "@/components/teach/format";

export const metadata: Metadata = { title: "Mis cursos" };

export default async function TeacherCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const { q = "" } = await searchParams;
  const courses = listTeacherCourses(scope, q);
  const showOwner = scope.kind === "all";
  const w = contextWords(scope.kind, ownerNameOf(scope));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cursos"
        title={w.heading}
        description={
          w.own
            ? "Crea, organiza y publica los cursos que impartes."
            : `Crea, organiza y publica ${w.courses}.`
        }
        icon={BookOpen}
        actions={
          <>
            <LiveSearch
              basePath="/teach/courses"
              initialValue={q}
              placeholder="Buscar curso…"
              ariaLabel="Buscar curso por título (filtra al escribir)"
            />
            <NewCourseDialog />
          </>
        }
      />

      {courses.length === 0 && q ? (
        <div className="anim-pop flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <Search className="size-8" aria-hidden />
          </span>
          <p className="font-heading text-lg font-semibold">Sin resultados para «{q}»</p>
          <Button asChild variant="outline" className="h-11">
            <Link href="/teach/courses">Limpiar búsqueda</Link>
          </Button>
        </div>
      ) : courses.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <Sparkles className="size-8" aria-hidden />
          </span>
          <p className="font-heading text-lg font-semibold">
            {w.own ? "Crea tu primer curso" : "Aún no hay cursos en esta vista"}
          </p>
          {w.own && (
            <p className="max-w-sm text-sm text-muted-foreground">
              Un curso reúne carpetas y lecciones que tus estudiantes recorren a su ritmo o en
              orden.
            </p>
          )}
          <NewCourseDialog />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map(({ course, ownerName, enrolled, itemCount }, i) => (
            <Link
              key={course.id}
              href={`/teach/courses/${course.id}/content`}
              className={`anim-rise anim-d${Math.min(i + 1, 5)} group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <Card className="card-lift h-full overflow-hidden pt-0 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
                <div className="h-24 w-full overflow-hidden">
                  <CourseCover
                    courseId={course.id}
                    coverFileId={course.coverFileId}
                    title={course.title}
                    className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.03]"
                  />
                </div>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-2 font-heading text-base">
                      {course.title}
                    </CardTitle>
                    <CourseStatusBadge status={course.status} className="shrink-0" />
                  </div>
                </CardHeader>
                <CardContent>
                  {showOwner && (
                    <div className="mb-2">
                      <OwnerTag name={ownerName} self={course.ownerId === user.id} />
                    </div>
                  )}
                  {course.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                      {course.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-4" aria-hidden />
                      {formatNumber(enrolled)}{" "}
                      {enrolled === 1 ? "inscrito" : "inscritos"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="size-4" aria-hidden />
                      {formatNumber(itemCount)}{" "}
                      {itemCount === 1 ? "lección" : "lecciones"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
