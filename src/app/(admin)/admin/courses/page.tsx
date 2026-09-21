import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { Library, Search, SearchX } from "lucide-react";
import { requireAdmin } from "@/server/auth/guards";
import { adminListCourses, adminListUsers } from "@/server/services/admin";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CourseStatusBadge } from "@/components/teach/course-status-badge";
import { formatNumber, formatRelative } from "@/components/teach/format";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { CourseActions, type OwnerOption } from "@/components/admin/courses/course-actions";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Todos los cursos" };

/** Maestros y administradores activos que pueden ser dueños de un curso. */
function listEligibleOwners(): OwnerOption[] {
  const teachers = adminListUsers({ role: "teacher", page: 1, pageSize: 100 }).rows;
  const admins = adminListUsers({ role: "admin", page: 1, pageSize: 100 }).rows;
  return [...teachers, ...admins]
    .filter((u) => u.active)
    .map((u) => ({ id: u.id, fullName: u.fullName, role: u.role as "admin" | "teacher" }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
}

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { rows, total, pageSize } = adminListCourses({ search: q, page, pageSize: 50 });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const owners = rows.length > 0 ? listEligibleOwners() : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administración"
        title={total > 0 ? `Todos los cursos (${formatNumber(total)})` : "Todos los cursos"}
        description="Todos los cursos de la plataforma: cambia propietario, estado o elimínalos."
        icon={Library}
        actions={
          <Form action="/admin/courses" className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar por título…"
              className="h-11 w-64 pl-9"
              aria-label="Buscar cursos"
            />
          </Form>
        }
      />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          {q ? (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <SearchX className="size-8" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">Sin resultados para «{q}»</p>
              <Link href="/admin/courses" className={buttonVariants({ variant: "outline" })}>
                Limpiar búsqueda
              </Link>
            </>
          ) : (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <Library className="size-8" aria-hidden />
              </span>
              <p className="max-w-sm text-sm text-muted-foreground">
                Aún no hay cursos en la plataforma. Los maestros los crean desde «Mis cursos».
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="anim-rise overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <Table>
              <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Título</TableHead>
                  <TableHead scope="col">Propietario</TableHead>
                  <TableHead scope="col">Estado</TableHead>
                  <TableHead scope="col" className="text-center">
                    Inscritos
                  </TableHead>
                  <TableHead scope="col" className="text-center">
                    Completados
                  </TableHead>
                  <TableHead scope="col">Actualizado</TableHead>
                  <TableHead scope="col" className="w-12">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
                {rows.map(({ course, ownerName, enrolled, completed }) => (
                  <TableRow key={course.id}>
                    <TableCell className="max-w-72 font-medium">
                      <Link
                        href={`/teach/courses/${course.id}/content`}
                        className="block truncate rounded-sm outline-none hover:text-section-strong focus-visible:ring-2 focus-visible:ring-ring"
                        title={course.title}
                      >
                        {course.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{ownerName}</TableCell>
                    <TableCell>
                      <CourseStatusBadge status={course.status} />
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatNumber(enrolled)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatNumber(completed)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(course.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <CourseActions
                        course={{
                          id: course.id,
                          title: course.title,
                          status: course.status,
                          ownerId: course.ownerId,
                          ownerName,
                        }}
                        owners={owners}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <AdminPagination
            basePath="/admin/courses"
            page={page}
            totalPages={totalPages}
            params={{ q }}
          />
        </>
      )}
    </div>
  );
}
