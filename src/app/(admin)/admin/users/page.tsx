import type { Metadata } from "next";
import Link from "next/link";
import { SearchX, UserCog } from "lucide-react";
import { requireAdmin } from "@/server/auth/guards";
import { adminListUsers, type Role } from "@/server/services/admin";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatRelative } from "@/components/teach/format";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { RoleBadge } from "@/components/admin/role-badge";
import { UserFilters } from "@/components/admin/users/user-filters";
import { NewUserDialog } from "@/components/admin/users/new-user-dialog";
import { UserActions } from "@/components/admin/users/user-actions";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Usuarios" };

const VALID_ROLES = ["admin", "teacher", "student"] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; page?: string }>;
}) {
  const actor = await requireAdmin();
  const { q = "", role: roleParam, page: pageParam } = await searchParams;
  const role: Role | "all" = (VALID_ROLES as readonly string[]).includes(roleParam ?? "")
    ? (roleParam as Role)
    : "all";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { rows, total, pageSize } = adminListUsers({ search: q, role, page, pageSize: 50 });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(q || role !== "all");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administración"
        title={total > 0 ? `Usuarios (${formatNumber(total)})` : "Usuarios"}
        description="Cuentas de administradores, maestros y estudiantes de la plataforma."
        icon={UserCog}
        actions={
          <>
            <UserFilters q={q} role={role} />
            <NewUserDialog />
          </>
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
              <Link href="/admin/users" className={buttonVariants({ variant: "outline" })}>
                Limpiar búsqueda
              </Link>
            </>
          ) : filtered ? (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <UserCog className="size-8" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">No hay usuarios con este rol.</p>
              <Link href="/admin/users" className={buttonVariants({ variant: "outline" })}>
                Ver todos los usuarios
              </Link>
            </>
          ) : (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <UserCog className="size-8" aria-hidden />
              </span>
              <p className="max-w-sm text-sm text-muted-foreground">
                Crea las cuentas de administradores, maestros y estudiantes de la plataforma.
              </p>
              <NewUserDialog />
            </>
          )}
        </div>
      ) : (
        <>
          <div className="anim-rise overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <Table>
              <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Nombre</TableHead>
                  <TableHead scope="col">Correo</TableHead>
                  <TableHead scope="col">Rol</TableHead>
                  <TableHead scope="col">Último acceso</TableHead>
                  <TableHead scope="col">Estado</TableHead>
                  <TableHead scope="col" className="w-12">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
                {rows.map((user) => (
                  <TableRow key={user.id} className={!user.active ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">
                      {user.fullName}
                      {user.id === actor.id && (
                        <span className="ml-1.5 text-xs text-muted-foreground">(tú)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <RoleBadge role={user.role} />
                        {user.role === "teacher" && user.canEditBranding && (
                          <Badge
                            variant="secondary"
                            className="bg-section-soft text-section-strong"
                            title="Puede editar la identidad de la empresa"
                          >
                            Identidad
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Nunca"}
                    </TableCell>
                    <TableCell>
                      {user.active ? (
                        <Badge variant="secondary" className="bg-success/10 text-success">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <UserActions
                        user={{
                          id: user.id,
                          fullName: user.fullName,
                          email: user.email,
                          role: user.role,
                          active: user.active,
                          canEditBranding: user.canEditBranding,
                        }}
                        isSelf={user.id === actor.id}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <AdminPagination
            basePath="/admin/users"
            page={page}
            totalPages={totalPages}
            params={{ q, role: role === "all" ? undefined : role }}
          />
        </>
      )}
    </div>
  );
}
