import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Award,
  BookOpen,
  CalendarClock,
  CircleCheck,
  Clock,
  Download,
  GraduationCap,
  Mail,
  ShieldX,
} from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { getStudentProfile } from "@/server/services/student-profile";
import { studentAccountPermissions } from "@/server/services/student-scope";
import { ownerNameOf } from "@/server/services/view-context";
import { cn } from "@/lib/utils";
import { VIEW_ALL } from "@/lib/view-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StudentActions } from "@/components/teach/students/student-actions";
import { PortfolioZipButton } from "@/components/teach/students/portfolio-zip-button";
import { BulkEnrollDialog } from "@/components/teach/students/bulk-enroll-dialog";
import { SwitchContextButton } from "@/components/teach/switch-context-button";
import { listTeacherCourses } from "@/server/services/courses";
import { cohortOptionsForUser } from "@/server/services/cohorts";
import { formatDate, formatNumber, formatRelative, formatDuration } from "@/components/teach/format";
import { CourseStatusBadge } from "@/components/teach/course-status-badge";
import { ValidityBadge } from "@/components/validity-badge";

export const metadata: Metadata = { title: "Perfil del estudiante" };

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const ENROLLMENT_LABEL: Record<string, { label: string; className: string }> = {
  completed: { label: "Aprobado", className: "bg-success/10 text-success" },
  active: { label: "En curso", className: "bg-accent text-accent-foreground" },
  dropped: { label: "Baja", className: "bg-secondary text-muted-foreground" },
};

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const { studentId } = await params;
  // Cualquier alumno del pool; cursos y certificados, solo los del contexto
  const profile = getStudentProfile(studentId, scope);
  if (!profile) notFound();

  const { student, courses, certificates, totals, outsideCount } = profile;
  // Su cuenta (contraseña, activar) solo la toca quien lo tiene en sus cursos o el admin
  const { mine, canDeactivate, canResetPassword } = studentAccountPermissions(user, studentId);
  // De quién son los cursos que se muestran (null = todos)
  const whose =
    scope.kind === "all" ? null : scope.kind === "own" ? "tus cursos" : `los cursos de ${ownerNameOf(scope) ?? "—"}`;
  // Cursos del maestro donde se puede matricular (los ya inscritos se excluyen en el diálogo)
  const enrolledIds = new Set(
    courses.filter((c) => c.enrollmentStatus !== "dropped").map((c) => c.courseId)
  );
  const enrollable = listTeacherCourses(scope)
    .filter(({ course }) => course.status !== "archived")
    .map(({ course }) => ({
      id: course.id,
      title: course.title,
      status: course.status,
      enrolled: enrolledIds.has(course.id),
    }));
  // Grupos de mis cursos: los abiertos se sugieren por nombre y los cerrados
  // avisan antes de matricular (el servidor no mete a nadie en un grupo cerrado)
  const existingCohorts = cohortOptionsForUser(scope, { includeClosed: true }).map((c) => ({
    courseId: c.courseId,
    name: c.name,
    status: c.status,
  }));
  const activeCerts = certificates.filter((c) => !c.revoked);

  // Chip de color por métrica: sección para totales, verde para aprobados
  const tiles = [
    { label: "Cursos", value: formatNumber(totals.courses), icon: BookOpen, stagger: "anim-d1", tone: "bg-section-soft text-section-strong" },
    { label: "Aprobados", value: formatNumber(totals.completed), icon: CircleCheck, stagger: "anim-d2", tone: "bg-success/10 text-success" },
    { label: "Certificados", value: formatNumber(totals.certificates), icon: Award, stagger: "anim-d3", tone: "bg-brand-tint text-primary" },
    { label: "Tiempo invertido", value: formatDuration(totals.totalSeconds), icon: Clock, stagger: "anim-d4", tone: "bg-section-soft text-section-strong" },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/teach/students"
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-section-strong transition-colors hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Estudiantes
      </Link>

      {/* ─── Encabezado del expediente ────────────────────────────────────── */}
      <Card className="anim-rise relative overflow-hidden rounded-2xl shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <span aria-hidden className="section-gradient absolute inset-x-0 top-0 h-1" />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-section opacity-[0.12]"
        />
        <CardContent className="relative flex flex-wrap items-center gap-4">
          <Avatar className="size-16 section-glow">
            <AvatarFallback className="section-gradient font-heading text-xl font-bold text-section-fg">
              {initials(student.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[1.75rem]">
                {student.fullName}
              </h1>
              {!student.active && <Badge variant="destructive">Cuenta desactivada</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Mail className="size-3.5" aria-hidden />
                {student.email}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarClock className="size-3.5" aria-hidden />
                Última conexión:{" "}
                {student.lastLoginAt ? formatRelative(student.lastLoginAt) : "nunca"}
              </span>
              <span className="flex items-center gap-1.5">
                <GraduationCap className="size-3.5" aria-hidden />
                Alta: {formatDate(new Date(student.createdAt))}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BulkEnrollDialog
              studentId={student.id}
              studentName={student.fullName}
              courses={enrollable}
              cohorts={existingCohorts}
            />
            <PortfolioZipButton studentId={student.id} disabled={activeCerts.length === 0} />
            {mine && (
              <StudentActions student={student} canDeactivate={canDeactivate} canResetPassword={canResetPassword} />
            )}
          </div>
        </CardContent>
      </Card>

      {outsideCount > 0 && (
        <p className="anim-rise rounded-xl border border-primary/20 bg-brand-tint px-4 py-3 text-sm text-primary">
          {user.role === "admin" ? (
            <>
              Tiene {outsideCount} {outsideCount === 1 ? "curso más" : "cursos más"} fuera de esta vista ·{" "}
              <SwitchContextButton value={VIEW_ALL}>Ver en General</SwitchContextButton>
            </>
          ) : (
            // Del trabajo con otros maestros solo se dice cuánto, no qué
            <>
              Toma {outsideCount} {outsideCount === 1 ? "curso" : "cursos"} con otros maestros.
            </>
          )}
        </p>
      )}

      {/* ─── Totales ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card
            key={tile.label}
            className={cn("anim-rise shadow-[0_1px_2px_rgb(15_23_42/0.05)]", tile.stagger)}
          >
            <CardContent className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">{tile.label}</p>
                <p className="font-heading text-2xl font-bold">{tile.value}</p>
              </div>
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  tile.tone
                )}
              >
                <tile.icon className="size-5" aria-hidden />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Certificados (el portafolio) ─────────────────────────────────── */}
      <Card className="anim-rise anim-d2 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-base">
            <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
              <Award className="size-4" aria-hidden />
            </span>
            Certificados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {certificates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {whose
                ? `Aún no tiene certificados de ${whose}.`
                : "Aún no tiene certificados. Aparecerán aquí al aprobar sus cursos."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Curso</TableHead>
                    <TableHead>Folio</TableHead>
                    <TableHead>Emitido</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead className="w-28 text-right">Descargar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certificates.map((cert) => (
                    <TableRow
                      key={cert.id}
                      className={cn(
                        "transition-colors hover:bg-section-soft/40",
                        cert.revoked && "opacity-60"
                      )}
                    >
                      <TableCell className="font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {cert.courseTitle}
                          {cert.cycle > 1 && (
                            <Badge variant="outline" className="font-normal text-muted-foreground">
                              Ciclo {cert.cycle}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {cert.folio}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(new Date(cert.issuedAt))}
                      </TableCell>
                      <TableCell>
                        {cert.revoked ? (
                          <span className="text-sm text-muted-foreground">
                            <span aria-hidden>—</span>
                            <span className="sr-only">No aplica (revocado)</span>
                          </span>
                        ) : (
                          <ValidityBadge expiresAt={cert.expiresAt} />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {cert.revoked ? (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <ShieldX className="size-3.5" aria-hidden />
                            Revocado
                          </span>
                        ) : (
                          <Button asChild variant="outline" size="sm" className="h-9">
                            <a
                              href={`/api/certificates/${encodeURIComponent(cert.folio)}?download`}
                              target="_blank"
                              rel="noopener"
                              aria-label={`Descargar certificado ${cert.folio}`}
                            >
                              <Download className="size-4" aria-hidden />
                              PDF
                            </a>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Cursos ───────────────────────────────────────────────────────── */}
      <Card className="anim-rise anim-d3 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-base">
            <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
              <BookOpen className="size-4" aria-hidden />
            </span>
            Cursos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {courses.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {whose
                ? `No está matriculado en ${whose}.`
                : "No está matriculado en ningún curso todavía."}
            </p>
          ) : (
            <ul className="space-y-2">
              {courses.map((c) => {
                const meta = ENROLLMENT_LABEL[c.enrollmentStatus] ?? ENROLLMENT_LABEL.active;
                return (
                  <li key={c.courseId}>
                    <Link
                      href={`/teach/reports?course=${c.courseId}&q=${encodeURIComponent(student.email)}`}
                      className="card-lift group flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{c.courseTitle}</span>
                          <CourseStatusBadge
                            status={c.courseStatus as "draft" | "published" | "archived"}
                          />
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Matriculado el {formatDate(new Date(c.enrolledAt))}
                          {c.completedAt ? ` · aprobado el ${formatDate(new Date(c.completedAt))}` : ""}
                        </span>
                      </span>
                      <span className="flex w-44 shrink-0 items-center gap-2">
                        <Progress
                          value={c.percent}
                          className="h-2"
                          aria-label={`Avance: ${c.percent}%`}
                        />
                        <span className="w-10 text-right text-sm text-muted-foreground">
                          {c.percent}%
                        </span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          meta.className
                        )}
                      >
                        {meta.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
