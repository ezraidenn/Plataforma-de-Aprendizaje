import type { Metadata } from "next";
import {
  Database,
  DatabaseBackup,
  FileBadge,
  Files,
  GraduationCap,
  Globe,
  HardDrive,
  Library,
  RefreshCw,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import { requireAdmin } from "@/server/auth/guards";
import { storageRootInfo } from "@/server/services/storage";
import { appUrlInfo } from "@/server/services/app-url";
import { StorageCard } from "@/components/admin/storage-card";
import { AiCard } from "@/components/admin/settings/ai-card";
import { getAiSettings } from "@/server/services/ai-settings";
import {
  adminListJobs,
  auditEntities,
  listAuditLog,
  platformStats,
} from "@/server/services/admin";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime, formatNumber, formatRelative } from "@/components/teach/format";
import { AdminPagination } from "@/components/admin/admin-pagination";
import {
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  auditActionLabel,
  auditEntityLabel,
  formatBytes,
} from "@/components/admin/format";
import { AuditEntityFilter } from "@/components/admin/settings/audit-entity-filter";
import { RetryJobButton } from "@/components/admin/settings/retry-job-button";
import { BrandingCard } from "@/components/admin/settings/branding-card";
import { getBranding } from "@/server/services/branding";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Configuración" };

function JobStatusBadge({ status }: { status: "pending" | "running" | "done" | "error" }) {
  if (status === "error") return <Badge variant="destructive">{JOB_STATUS_LABEL.error}</Badge>;
  if (status === "done") {
    return (
      <Badge variant="secondary" className="bg-success/10 text-success">
        {JOB_STATUS_LABEL.done}
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge variant="secondary" className="bg-section-soft text-section-strong">
        {JOB_STATUS_LABEL.running}
      </Badge>
    );
  }
  return <Badge variant="secondary">{JOB_STATUS_LABEL.pending}</Badge>;
}

/** Texto truncado con tooltip accesible (hover y foco) para ver el contenido completo. */
function TruncatedCell({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("block cursor-default truncate rounded-sm", className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-all">{text}</TooltipContent>
    </Tooltip>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  stagger,
  tone = "bg-section-soft text-section-strong",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
  stagger?: string;
  /** Clases del chip de icono según la métrica */
  tone?: string;
}) {
  return (
    <Card className={cn("anim-rise", "shadow-[0_1px_2px_rgb(15_23_42/0.05)]", stagger)}>
      <CardContent className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="font-heading text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="size-5" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; page?: string }>;
}) {
  await requireAdmin();
  const { entity: entityParam = "", page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const stats = platformStats();
  const storage = storageRootInfo();
  const address = await appUrlInfo();
  const jobRows = adminListJobs(50);
  const entities = auditEntities();
  const entity = entities.includes(entityParam) ? entityParam : "";
  const auditData = listAuditLog({ page, pageSize: 50, entity: entity || undefined });
  const auditPages = Math.max(1, Math.ceil(auditData.total / auditData.pageSize));

  const branding = getBranding();

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Administración"
          title="Configuración"
          description="Identidad, estado del sistema, trabajos en segundo plano y registro de actividad."
          icon={Settings}
        />

        {/* Identidad de la empresa */}
        <BrandingCard platformName={branding.platformName} logoFileId={branding.logoFileId} />

        {/* Resumen */}
        <section aria-label="Resumen" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={Users}
            label="Usuarios"
            value={formatNumber(stats.users.total)}
            hint={`${formatNumber(stats.users.admins)} admin · ${formatNumber(stats.users.teachers)} maestros · ${formatNumber(stats.users.students)} estudiantes`}
            stagger="anim-d1"
          />
          <StatCard
            icon={Library}
            label="Cursos"
            value={formatNumber(stats.courses.total)}
            hint={`${formatNumber(stats.courses.published)} publicados`}
            stagger="anim-d2"
          />
          <StatCard
            icon={GraduationCap}
            label="Matrículas"
            value={formatNumber(stats.enrollments.total)}
            hint={`${formatNumber(stats.enrollments.completed)} completadas`}
            stagger="anim-d3"
            tone="bg-success/10 text-success"
          />
          <StatCard
            icon={FileBadge}
            label="Certificados"
            value={formatNumber(stats.certificates)}
            hint="emitidos"
            stagger="anim-d4"
            tone="bg-brand-tint text-primary"
          />
        </section>

        {/* Almacenamiento */}
        <Card className="shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <CardHeader>
            <CardTitle>Almacenamiento</CardTitle>
            <CardDescription>Espacio que ocupa la plataforma en el servidor.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
                  <Database className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm text-muted-foreground">Base de datos</p>
                  <p className="font-heading text-xl font-semibold">
                    {formatBytes(stats.dbSizeBytes)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
                  <HardDrive className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm text-muted-foreground">Archivos en disco</p>
                  <p className="font-heading text-xl font-semibold">
                    {formatBytes(stats.storageSizeBytes)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
                  <Files className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm text-muted-foreground">Archivos</p>
                  <p className="font-heading text-xl font-semibold">
                    {formatNumber(stats.files.count)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(stats.files.totalBytes)} registrados
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dirección con la que entran los demás equipos (y que lleva el QR) */}
        <Card className="shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base">
              <Globe className="size-4 text-section-strong" aria-hidden />
              Dirección en la red
            </CardTitle>
            <CardDescription>
              La que usan los demás equipos para entrar y la que llevan impresa los códigos QR de
              los certificados nuevos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="break-all font-mono text-sm font-medium">{address.url}</p>
            <p className="text-xs text-muted-foreground">
              Origen: {address.source}
              {address.source === "detectada automáticamente"
                ? " · si el equipo cambia de red, la dirección se actualiza sola"
                : " · fijada con APP_URL en el archivo .env"}
            </p>
          </CardContent>
        </Card>

        {/* Carpeta de almacenamiento (disco local o NAS) */}
        <StorageCard
          root={storage.root}
          source={storage.source}
          isUnc={storage.isUnc}
          fileCount={stats.files.count}
          sizeLabel={formatBytes(stats.files.totalBytes)}
        />

        {/* Inteligencia artificial: la clave de OpenAI para «Importar con IA» */}
        <AiCard {...getAiSettings()} />

        {/* Trabajos en segundo plano */}
        <Card className="shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <CardHeader>
            <CardTitle>Trabajos en segundo plano</CardTitle>
            <CardDescription>
              Últimos 50 trabajos. Las conversiones de PPT requieren LibreOffice instalado en el
              servidor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {jobRows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border py-12 text-center">
                <span className="anim-pop flex size-14 items-center justify-center rounded-full bg-section-soft text-section-strong">
                  <RefreshCw className="size-7" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground">
                  Aún no hay trabajos en segundo plano.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <Table>
                  <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                    <TableRow className="hover:bg-transparent">
                      <TableHead scope="col">Tipo</TableHead>
                      <TableHead scope="col">Estado</TableHead>
                      <TableHead scope="col" className="text-center">
                        Intentos
                      </TableHead>
                      <TableHead scope="col">Error</TableHead>
                      <TableHead scope="col">Fecha</TableHead>
                      <TableHead scope="col" className="w-28">
                        <span className="sr-only">Acciones</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
                    {jobRows.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-medium">
                          {JOB_TYPE_LABEL[job.type] ?? job.type}
                        </TableCell>
                        <TableCell>
                          <JobStatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{job.attempts}</TableCell>
                        <TableCell className="max-w-56">
                          {job.errorMessage ? (
                            <TruncatedCell
                              text={job.errorMessage}
                              className="text-destructive"
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground"
                          title={formatDateTime(job.createdAt)}
                        >
                          {formatRelative(job.createdAt)}
                        </TableCell>
                        <TableCell>
                          {job.status === "error" && <RetryJobButton jobId={job.id} />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Auditoría */}
        <section id="auditoria" className="scroll-mt-20">
          <Card className="shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Auditoría</CardTitle>
                  <CardDescription>
                    Quién hizo qué y cuándo. Este registro es de solo lectura.
                  </CardDescription>
                </div>
                {entities.length > 0 && <AuditEntityFilter entities={entities} value={entity} />}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {auditData.rows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border py-12 text-center">
                  <span className="anim-pop flex size-14 items-center justify-center rounded-full bg-section-soft text-section-strong">
                    <ScrollText className="size-7" aria-hidden />
                  </span>
                  <p className="text-sm text-muted-foreground">
                    {entity
                      ? "No hay actividad registrada para esta entidad."
                      : "Aún no hay actividad registrada."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                        <TableRow className="hover:bg-transparent">
                          <TableHead scope="col">Fecha</TableHead>
                          <TableHead scope="col">Usuario</TableHead>
                          <TableHead scope="col">Acción</TableHead>
                          <TableHead scope="col">Entidad</TableHead>
                          <TableHead scope="col">Detalle</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
                        {auditData.rows.map((row) => {
                          const detail = row.detail ? JSON.stringify(row.detail) : null;
                          return (
                            <TableRow key={row.id}>
                              <TableCell
                                className="whitespace-nowrap text-muted-foreground"
                                title={formatDateTime(row.createdAt)}
                              >
                                {formatRelative(row.createdAt)}
                              </TableCell>
                              <TableCell className="font-medium">
                                {row.userName ?? "Sistema"}
                              </TableCell>
                              <TableCell>{auditActionLabel(row.action)}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {auditEntityLabel(row.entity)}
                              </TableCell>
                              <TableCell className="max-w-56">
                                {detail ? (
                                  <TruncatedCell
                                    text={detail}
                                    className="text-xs text-muted-foreground"
                                  />
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <AdminPagination
                    basePath="/admin/settings"
                    page={auditData.page}
                    totalPages={auditPages}
                    params={{ entity }}
                    anchor="auditoria"
                  />
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Respaldo */}
        <Card className="shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
                <DatabaseBackup className="size-4" aria-hidden />
              </span>
              Respaldo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              El respaldo se ejecuta con{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                pnpm backup
              </code>{" "}
              — copia <code className="font-mono text-xs">data.db</code> y la carpeta{" "}
              <code className="font-mono text-xs">storage/</code> a la carpeta configurada.
            </p>
            <p>
              Prográmalo para que corra solo con el Programador de tareas de Windows — consulta{" "}
              <code className="font-mono text-xs">INSTALACION.md</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
