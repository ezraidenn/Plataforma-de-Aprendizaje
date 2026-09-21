import type { Metadata } from "next";
import Link from "next/link";
import { Award, Download, FileBadge } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { scopeOwnerId } from "@/server/auth/view-scope";
import {
  listTemplates,
  listGeneralTemplates,
  listTeacherCertificates,
  listCertificateCourses,
  templateUsage,
} from "@/server/services/certificates";
import { listTeacherCourses } from "@/server/services/courses";
import { ownerNameOf, staffNameMap } from "@/server/services/view-context";
import { contextWords, titleWithOwner } from "@/lib/view-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewTemplateDialog } from "@/components/teach/templates/new-template-dialog";
import { TemplateCardMenu } from "@/components/teach/templates/template-card-menu";
import { OwnerTag } from "@/components/teach/owner-tag";
import { RevokeCertificateDialog } from "@/components/teach/templates/revoke-certificate-dialog";
import { CertificatesZipToolbar } from "@/components/teach/bulk/certificates-zip-toolbar";
import { formatDate } from "@/components/teach/format";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Certificados" };

const SIZE_LABEL = { letter: "Carta", a4: "A4" } as const;
const ORIENTATION_LABEL = { landscape: "Horizontal", portrait: "Vertical" } as const;

export default async function TemplatesPage() {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const templates = listTemplates(scope);
  // Plantillas del admin: generales, cualquier maestro las asigna en Ajustes.
  // Fuera de «General» van en su sección de solo lectura (sin las del dueño
  // de la vista, que ya están arriba)
  const ownerId = scopeOwnerId(scope);
  const allGenerals = listGeneralTemplates();
  const generalIds = new Set(allGenerals.map((t) => t.id));
  const generals = scope.kind !== "all" ? allGenerals.filter((t) => t.ownerId !== ownerId) : [];
  const usage = templateUsage();
  const certificates = listTeacherCertificates(scope, 200);
  const w = contextWords(scope.kind, ownerNameOf(scope));
  const ownerNames = scope.kind === "all" ? staffNameMap() : null;
  // En «General», el curso también lleva a su dueño: «NOM-035 · Maestro A»
  const ownerByCourse =
    scope.kind === "all"
      ? new Map(listTeacherCourses(scope).map((r) => [r.course.id, r.ownerName]))
      : null;
  const withOwner = (courseId: string, title: string) =>
    ownerByCourse ? titleWithOwner(title, ownerByCourse.get(courseId), true) : title;

  // El select del ZIP se deriva con consulta propia SIN tope: con más de 200
  // emitidos, los cursos con certificados antiguos también deben aparecer
  const zipCourses = listCertificateCourses(scope).map((c) => ({
    id: c.courseId,
    title: withOwner(c.courseId, c.courseTitle),
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Certificados"
        title="Plantillas de certificado"
        description="Diseña el diploma una vez; cada estudiante recibe el suyo al aprobar."
        icon={FileBadge}
        actions={<NewTemplateDialog />}
      />

      {/* Plantillas */}
      <section className="space-y-3">

        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-14 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <FileBadge className="size-8" aria-hidden />
            </span>
            <p className="font-heading text-lg font-semibold">
              {w.own ? "Crea tu primera plantilla de certificado" : "Aún no hay plantillas en esta vista"}
            </p>
            {w.own && (
              <p className="max-w-sm text-sm text-muted-foreground">
                Diseña el diploma una sola vez: al aprobar un curso, cada estudiante recibe el suyo
                con su nombre, folio y código QR de verificación.
              </p>
            )}
            <NewTemplateDialog />
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template, i) => (
              <li key={template.id} className={`anim-rise anim-d${Math.min(i + 1, 5)} relative`}>
                <Link
                  href={`/teach/templates/${template.id}`}
                  className="card-lift flex h-full flex-col gap-2 rounded-xl border bg-card p-4 pr-12 shadow-[0_1px_2px_rgb(15_23_42/0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-section-soft text-section-strong">
                    <FileBadge className="size-5" aria-hidden />
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{template.name}</span>
                    {generalIds.has(template.id) && (
                      <Badge
                        variant="secondary"
                        className="bg-section-soft text-section-strong"
                        title="Cualquier maestro puede elegirla en los Ajustes de su curso"
                      >
                        General
                      </Badge>
                    )}
                  </span>
                  {ownerNames && (
                    <OwnerTag
                      name={ownerNames.get(template.ownerId) ?? "—"}
                      self={template.ownerId === user.id}
                    />
                  )}
                  <span className="text-sm text-muted-foreground">
                    {SIZE_LABEL[template.pageSize]} · {ORIENTATION_LABEL[template.orientation]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Actualizada {formatDate(template.updatedAt)}
                  </span>
                </Link>
                <TemplateCardMenu
                  templateId={template.id}
                  name={template.name}
                  usedBy={usage.get(template.id) ?? 0}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Plantillas generales (del admin): solo lectura, se eligen en Ajustes del curso */}
      {generals.length > 0 && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="font-heading text-lg font-semibold">Plantillas generales</h2>
            <p className="text-sm text-muted-foreground">
              Las diseña el administrador. Elígelas en los Ajustes de cada curso.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {generals.map((template, i) => (
              <li key={template.id} className={`anim-rise anim-d${Math.min(i + 1, 5)}`}>
                <div className="flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-section-soft text-section-strong">
                    <FileBadge className="size-5" aria-hidden />
                  </span>
                  <span className="truncate font-medium">{template.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {SIZE_LABEL[template.pageSize]} · {ORIENTATION_LABEL[template.orientation]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Actualizada {formatDate(template.updatedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Certificados emitidos */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">Certificados emitidos</h2>
          <CertificatesZipToolbar courses={zipCourses} disabled={zipCourses.length === 0} />
        </div>

        {certificates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border bg-card py-10 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <span className="anim-pop flex size-14 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Award className="size-7" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              Aún no se emiten certificados. Asigna una plantilla en los Ajustes del curso y se
              generarán solos cuando los estudiantes aprueben.
            </p>
          </div>
        ) : (
          <div className="anim-rise overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <Table>
              <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Folio</TableHead>
                  <TableHead scope="col">Estudiante</TableHead>
                  <TableHead scope="col">Curso</TableHead>
                  <TableHead scope="col">Fecha</TableHead>
                  <TableHead scope="col">Estado</TableHead>
                  <TableHead scope="col" className="w-36">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
                {certificates.map(({ cert, courseTitle, studentName }) => (
                  <TableRow key={cert.id} className={cert.revoked ? "opacity-60" : undefined}>
                    <TableCell className="font-mono text-xs">{cert.folio}</TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/teach/students/${cert.studentId}`}
                        className="rounded-sm transition-colors hover:text-section-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {studentName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {withOwner(cert.courseId, courseTitle)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(cert.issuedAt)}
                    </TableCell>
                    <TableCell>
                      {cert.revoked ? (
                        <Badge variant="destructive">Revocado</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-success/10 text-success">
                          Vigente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!cert.revoked && (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-section-strong"
                          >
                            <a
                              href={`/api/certificates/${encodeURIComponent(cert.folio)}?download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Descargar PDF del certificado ${cert.folio}`}
                            >
                              <Download aria-hidden />
                            </a>
                          </Button>
                        )}
                        {!cert.revoked && (
                          <RevokeCertificateDialog
                            certificateId={cert.id}
                            folio={cert.folio}
                            studentName={studentName}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
