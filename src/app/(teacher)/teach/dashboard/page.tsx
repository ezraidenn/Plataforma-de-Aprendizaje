import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  FileBadge,
  LayoutDashboard,
  Sparkles,
  Users,
} from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { listStudents, listTeacherCourses } from "@/server/services/courses";
import { onboardingFacts } from "@/server/services/onboarding";
import { onboardingSteps } from "@/lib/onboarding";
import { ownerNameOf } from "@/server/services/view-context";
import { gradingQueue } from "@/server/services/grading";
import { listTeacherCertificates } from "@/server/services/certificates";
import { cn } from "@/lib/utils";
import { contextWords, titleWithOwner } from "@/lib/view-context";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { CoverHero } from "@/components/shell/cover-hero";
import { coverImageFor, getBranding } from "@/server/services/branding";
import { NewCourseDialog } from "@/components/teach/new-course-dialog";
import { OnboardingBand } from "@/components/teach/onboarding-band";
import { CourseStatusBadge } from "@/components/teach/course-status-badge";
import { formatNumber } from "@/components/teach/format";

export const metadata: Metadata = { title: "Inicio" };

export default async function TeacherDashboard() {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const w = contextWords(scope.kind, ownerNameOf(scope));
  const courses = listTeacherCourses(scope);
  const { total: studentTotal } = listStudents(scope, { page: 1, pageSize: 1 });
  const publishedCount = courses.filter((c) => c.course.status === "published").length;

  // Exámenes con preguntas abiertas + tareas entregadas, pendientes en MIS cursos
  const pendingGrading = gradingQueue(scope).length;
  const certificateCount = listTeacherCertificates(scope, 100_000).length;
  const branding = getBranding();
  const coverUrl = coverImageFor(branding, "dashboard");

  const kpis: {
    label: string;
    value: string;
    hint: string;
    icon: typeof Users;
    warning?: boolean;
    href?: string;
    /** Color del chip según la métrica */
    tone: string;
  }[] = [
    {
      label: "Estudiantes",
      value: formatNumber(studentTotal),
      hint: "registrados",
      icon: Users,
      tone: "bg-success/10 text-success",
    },
    {
      label: "Cursos",
      value: formatNumber(publishedCount),
      hint: publishedCount === 1 ? "publicado" : "publicados",
      icon: BookOpen,
      tone: "bg-section-soft text-section-strong",
    },
    {
      label: "Por calificar",
      value: formatNumber(pendingGrading),
      hint: "en la cola",
      icon: ClipboardCheck,
      warning: pendingGrading > 0,
      href: "/teach/grading",
      tone: "bg-warning/10 text-warning",
    },
    {
      label: "Certificados",
      value: formatNumber(certificateCount),
      hint: "emitidos",
      icon: FileBadge,
      tone: "bg-brand-tint text-primary",
    },
  ];

  return (
    <div className="space-y-6">
      <CoverHero
        coverUrl={coverUrl}
        platformName={branding.platformName}
        logoFileId={branding.logoFileId}
        greeting={`Hola, ${user.fullName.split(" ")[0]}`}
        subtitle="Panel del maestro"
      />

      <PageHeader
        eyebrow="Bienvenido"
        title={user.fullName}
        description={
          w.own
            ? "Resumen de tus cursos, estudiantes y pendientes de hoy."
            : `Resumen de ${w.courses}: estudiantes y pendientes de hoy.`
        }
        icon={LayoutDashboard}
        actions={<NewCourseDialog urlTrigger />}
      />

      {/* Primeros pasos: solo sobre el contenido propio */}
      {scope.kind === "own" && (
        <OnboardingBand userId={user.id} data={onboardingSteps(onboardingFacts(user.id))} />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi, i) => {
          const card = (
            <Card
              className={cn(
                "h-full shadow-[0_1px_2px_rgb(15_23_42/0.05)]",
                kpi.href && "card-lift"
              )}
            >
              <CardContent className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p
                    className={cn(
                      "font-heading text-2xl font-bold",
                      kpi.warning && "text-warning"
                    )}
                  >
                    {kpi.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{kpi.hint}</p>
                </div>
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    kpi.tone
                  )}
                >
                  <kpi.icon className="size-5" aria-hidden />
                </span>
              </CardContent>
            </Card>
          );
          const stagger = ["anim-d1", "anim-d2", "anim-d3", "anim-d4"][i] ?? "anim-d4";
          return kpi.href ? (
            <Link
              key={kpi.label}
              href={kpi.href}
              className={cn(
                "anim-rise rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                stagger
              )}
            >
              {card}
            </Link>
          ) : (
            <div key={kpi.label} className={cn("anim-rise", stagger)}>
              {card}
            </div>
          );
        })}
      </div>

      {/* Mis cursos */}
      <section className="anim-rise anim-d5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">{w.heading}</h2>
        </div>

        {courses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-14 text-center">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Sparkles className="size-8" aria-hidden />
            </span>
            <p className="font-heading text-lg font-semibold">
              {w.own ? "Crea tu primer curso" : "Aún no hay cursos en esta vista"}
            </p>
            {w.own && (
              <p className="max-w-sm text-sm text-muted-foreground">
                Agrega carpetas, documentos y lecturas; matricula estudiantes y publica cuando esté
                listo.
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {courses.map(({ course, ownerName, enrolled, itemCount }) => (
              <li key={course.id}>
                <Link
                  href={`/teach/courses/${course.id}/content`}
                  className="card-lift group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {titleWithOwner(course.title, ownerName, scope.kind === "all")}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {formatNumber(enrolled)} {enrolled === 1 ? "inscrito" : "inscritos"} ·{" "}
                      {formatNumber(itemCount)} {itemCount === 1 ? "lección" : "lecciones"}
                    </span>
                  </span>
                  <CourseStatusBadge status={course.status} className="shrink-0" />
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-section-strong"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
