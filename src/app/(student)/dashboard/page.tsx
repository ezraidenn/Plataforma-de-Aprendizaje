import Link from "next/link";
import {
  Award,
  BadgeCheck,
  BookOpen,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  Download,
  House,
  PlayCircle,
} from "lucide-react";
import { requireStudent } from "@/server/auth/guards";
import { listStudentCertificates } from "@/server/services/certificates";
import { listStudentCourses, type Course } from "@/server/services/courses";
import {
  getExam,
  listAttempts,
  computeFinalScorePercent,
} from "@/server/services/exams";
import {
  courseProgress,
  getProgressMap,
  lockStates,
  type CourseProgressSummary,
} from "@/server/services/progress";
import { getItem, linearOrder, type CourseItem } from "@/server/services/tree";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CourseCover } from "@/components/course-cover";
import { Progress } from "@/components/ui/progress";
import { KindChip } from "@/components/kind-meta";
import { PageHeader } from "@/components/shell/page-header";
import { CoverHero } from "@/components/shell/cover-hero";
import { coverImageFor, getBranding } from "@/server/services/branding";
import { ProgressRing } from "@/components/student/progress-ring";
import { ValidityBadge } from "@/components/validity-badge";

export const metadata = { title: "Inicio" };

type CourseEntry = {
  course: Course;
  summary: CourseProgressSummary;
  lastActivity: number;
};

function itemHref(courseId: string, item: CourseItem): string {
  return `/courses/${courseId}/items/${item.id}`;
}

/** "Curso › Carpeta › Ítem" para el hero. */
function itemPath(course: Course, item: CourseItem): string {
  const parent = item.parentId ? getItem(item.parentId) : null;
  return [course.title, parent?.kind === "folder" ? parent.title : null, item.title]
    .filter(Boolean)
    .join(" › ");
}

// ─── Fechas próximas (DISENO-UX §2.2) ────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSE_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const ISSUED_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

type UpcomingExam = {
  courseId: string;
  courseTitle: string;
  itemId: string;
  itemTitle: string;
  closesAtMs: number;
};

function closesText(ms: number, now: number): string {
  // "hoy"/"mañana" por día CALENDARIO, no por delta de 24 h (un examen
  // que cierra mañana a mediodía no "cierra hoy" aunque falten <24 h).
  const startOfDay = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const dayDiff = Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);
  if (dayDiff <= 0) return "cierra hoy";
  if (dayDiff === 1) return "cierra mañana";
  return `cierra en ${dayDiff} días`;
}

/**
 * Exámenes de mis cursos que cierran en ≤ 7 días y aún no están aprobados.
 * Se excluyen los bloqueados por candado y los que ya no tienen intentos.
 */
function upcomingExams(entries: CourseEntry[], studentId: string, now: number): UpcomingExam[] {
  const soon = now + 7 * DAY_MS;
  const out: UpcomingExam[] = [];
  for (const { course } of entries) {
    const locks = lockStates(course.id, studentId);
    for (const item of linearOrder(course.id).filter(
      (i) => i.visible && i.kind === "exam"
    )) {
      const exam = getExam(item.id);
      if (!exam?.closesAt) continue;
      const closes = exam.closesAt.getTime();
      if (closes <= now || closes > soon) continue;
      // Bloqueado por secuencia: no es accionable, no se anuncia
      if (locks.get(item.id)) continue;
      const attempts = listAttempts(item.id, studentId);
      // Sin intentos restantes: tampoco es accionable
      const finished = attempts.filter((a) => a.status !== "in_progress").length;
      if (exam.maxAttempts !== null && finished >= exam.maxAttempts) continue;
      const percent = computeFinalScorePercent(exam, attempts);
      const approved =
        percent !== null && (exam.passScore === null || percent >= exam.passScore);
      if (approved) continue;
      out.push({
        courseId: course.id,
        courseTitle: course.title,
        itemId: item.id,
        itemTitle: item.title,
        closesAtMs: closes,
      });
    }
  }
  return out.sort((a, b) => a.closesAtMs - b.closesAtMs);
}

export default async function StudentDashboard() {
  const user = await requireStudent();
  const firstName = user.fullName.split(" ")[0];

  const entries: CourseEntry[] = listStudentCourses(user.id).map(
    ({ course, enrollment }) => {
      const summary = courseProgress(course.id, user.id);
      let lastActivity = 0;
      for (const p of getProgressMap(enrollment.id).values()) {
        if (p.status === "in_progress") {
          lastActivity = Math.max(lastActivity, p.lastActivityAt?.getTime() ?? 0);
        }
      }
      return { course, summary, lastActivity };
    }
  );

  // Hero: curso con actividad en progreso más reciente; si no hay, el primer
  // curso incompleto con su siguiente lección; si todo está completo, "al día".
  const inProgress = entries
    .filter((e) => e.summary.lastInProgress !== null)
    .sort((a, b) => b.lastActivity - a.lastActivity)[0];
  const toStart = entries.find((e) => e.summary.percent < 100 && e.summary.nextItem);
  const hero = inProgress ?? toStart ?? null;
  const heroItem = hero
    ? (hero.summary.lastInProgress ?? hero.summary.nextItem)
    : null;
  const allDone = entries.length > 0 && !hero;

  const now = Date.now();
  const upcoming = upcomingExams(entries, user.id, now);
  const certificates = listStudentCertificates(user.id);
  const branding = getBranding();
  const coverUrl = coverImageFor(branding, "dashboard");

  return (
    <div className="space-y-8">
      <CoverHero
        coverUrl={coverUrl}
        platformName={branding.platformName}
        logoFileId={branding.logoFileId}
        greeting={`Hola, ${firstName}`}
        subtitle="Bienvenido a tu espacio de capacitación"
      />
      <PageHeader
        icon={House}
        eyebrow="Inicio"
        title={`Hola, ${firstName}`}
        description={
          entries.length === 0
            ? "Aquí verás tus cursos en cuanto te matriculen."
            : allDone
              ? "Completaste todos tus cursos. ¡Buen trabajo!"
              : "Retoma tu aprendizaje donde lo dejaste."
        }
      />

      {/* ─── Hero: continuar donde te quedaste ─────────────────────────────── */}
      {entries.length === 0 ? (
        <div className="anim-rise anim-d1 flex flex-col items-center gap-3 rounded-2xl border bg-card py-16 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <BookOpen className="size-8" aria-hidden />
          </span>
          <p className="max-w-sm text-muted-foreground">
            Aún no tienes cursos asignados. Tu instructor te matriculará pronto.
          </p>
        </div>
      ) : allDone ? (
        <Card className="anim-rise anim-d1 card-lift relative overflow-hidden border-l-4 border-l-success">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CircleCheck className="size-10 shrink-0 fill-progress-ring stroke-white" aria-hidden />
              <div>
                <p className="font-heading text-lg font-semibold">¡Todo al día!</p>
                <p className="text-sm text-muted-foreground">
                  Completaste todos tus cursos. Revisa tus certificados.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="h-11">
              <Link href="#certificados">Ver mis certificados</Link>
            </Button>
          </CardContent>
        </Card>
      ) : hero && heroItem ? (
        <section
          aria-labelledby="continuar-titulo"
          className="anim-rise anim-d1 section-gradient section-glow relative overflow-hidden rounded-2xl p-6 text-white md:p-8"
        >
          {/* Adornos: halos blancos muy suaves */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-white/10"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-28 right-24 size-56 rounded-full bg-white/10"
          />
          <div className="relative space-y-4">
            <p
              id="continuar-titulo"
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/80"
            >
              <PlayCircle className="size-4" aria-hidden />
              {hero.summary.lastInProgress
                ? "Continuar donde te quedaste"
                : "Empieza tu siguiente curso"}
            </p>
            <p className="max-w-2xl font-heading text-xl font-bold leading-snug md:text-2xl">
              {itemPath(hero.course, heroItem)}
            </p>
            <div className="flex items-center gap-3">
              <Progress
                value={hero.summary.percent}
                className="h-2 max-w-md bg-white/25 [&>[data-slot=progress-indicator]]:bg-white"
                aria-label={`Progreso del curso: ${hero.summary.percent}%`}
              />
              <span className="shrink-0 text-sm font-medium text-white/90">
                {hero.summary.percent}% del curso
              </span>
            </div>
            <div>
              <Button
                asChild
                className="h-11 min-w-36 bg-white text-primary shadow-sm hover:bg-white/90"
              >
                <Link href={itemHref(hero.course.id, heroItem)}>
                  {hero.summary.lastInProgress ? "Continuar" : "Empezar"}
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ─── Fechas próximas (solo si hay cierres en ≤ 7 días) ─────────────── */}
      {upcoming.length > 0 && (
        <section aria-labelledby="fechas-titulo" className="space-y-3">
          <h2
            id="fechas-titulo"
            className="flex items-center gap-2.5 font-heading text-xl font-semibold"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-warning/15 text-warning">
              <CalendarClock className="size-4" aria-hidden />
            </span>
            Fechas próximas
          </h2>
          <ul className="space-y-2">
            {upcoming.map((u) => (
              <li key={u.itemId}>
                <Link
                  href={`/courses/${u.courseId}/items/${u.itemId}`}
                  className="card-lift flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
                >
                  {/* Tipo (examen) a la izquierda; la urgencia (ámbar) va con su icono */}
                  <KindChip kind="exam" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">Examen «{u.itemTitle}»</span> de{" "}
                    {u.courseTitle}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-warning">
                    <CalendarClock className="size-4 shrink-0" aria-hidden />
                    {closesText(u.closesAtMs, now)} ·{" "}
                    {CLOSE_FMT.format(new Date(u.closesAtMs))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Mis cursos ────────────────────────────────────────────────────── */}
      <section id="cursos" aria-labelledby="cursos-titulo" className="scroll-mt-20 space-y-4">
        <h2
          id="cursos-titulo"
          className="flex items-center gap-2.5 font-heading text-xl font-semibold"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <BookOpen className="size-4" aria-hidden />
          </span>
          Mis cursos
        </h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cuando tu instructor te matricule, tus cursos aparecerán aquí.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map(({ course, summary }, i) => {
              const done = summary.percent >= 100;
              const started = summary.percent > 0 || summary.lastInProgress !== null;
              const target =
                !done && summary.nextItem
                  ? itemHref(course.id, summary.nextItem)
                  : `/courses/${course.id}`;
              return (
                <Card
                  key={course.id}
                  className={cn(
                    "card-lift anim-rise group/card overflow-hidden pt-0",
                    i < 5 ? `anim-d${i + 1}` : "anim-d5"
                  )}
                >
                  <div className="h-28 w-full overflow-hidden">
                    <CourseCover
                      courseId={course.id}
                      coverFileId={course.coverFileId}
                      title={course.title}
                      className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover/card:scale-[1.02]"
                    />
                  </div>
                  <CardContent className="space-y-3">
                    <h3 className="line-clamp-2 font-heading font-semibold">
                      <Link href={`/courses/${course.id}`} className="hover:underline">
                        {course.title}
                      </Link>
                    </h3>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <ProgressRing percent={summary.percent} />
                        <span className="text-sm text-muted-foreground">
                          {summary.percent}%
                        </span>
                      </span>
                      {done ? (
                        <Button asChild variant="outline" className="h-11">
                          <Link href={`/courses/${course.id}`}>Repasar</Link>
                        </Button>
                      ) : (
                        <Button
                          asChild
                          className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                        >
                          <Link href={target}>{started ? "Continuar" : "Empezar"}</Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Mis certificados ──────────────────────────────────────────────── */}
      <section
        id="certificados"
        aria-labelledby="certificados-titulo"
        className="scroll-mt-20 space-y-4"
      >
        <h2
          id="certificados-titulo"
          className="flex items-center gap-2.5 font-heading text-xl font-semibold"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <Award className="size-4" aria-hidden />
          </span>
          Mis certificados
        </h2>
        {certificates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card py-12 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Award className="size-8" aria-hidden />
            </span>
            <p className="max-w-sm text-muted-foreground">
              Tus certificados aparecerán aquí al aprobar un curso.
            </p>
            {entries.length > 0 && (
              <Button asChild variant="outline" className="h-11">
                <Link href="#cursos">Ver mis cursos</Link>
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {certificates.map(({ cert, courseTitle }) => (
              <li
                key={cert.id}
                className="card-lift flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-section-soft text-section-strong">
                  <Award className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading font-semibold">{courseTitle}</p>
                  <p className="text-sm text-muted-foreground">
                    {cert.folio} · Emitido el {ISSUED_FMT.format(cert.issuedAt)}
                  </p>
                  <ValidityBadge expiresAt={cert.expiresAt} now={now} className="mt-1.5" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {!cert.revoked && (
                    <Button asChild variant="outline" className="h-11">
                      <a
                        href={`/api/certificates/${encodeURIComponent(cert.folio)}?download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download aria-hidden />
                        Descargar PDF
                      </a>
                    </Button>
                  )}
                  <Button asChild variant="outline" className="h-11">
                    <a
                      href={`/verify/${cert.folio}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <BadgeCheck aria-hidden />
                      Ver verificación
                    </a>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
