import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { Search, SearchX, Users } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { listStudents, listTeacherCourses } from "@/server/services/courses";
import { ownerNameOf } from "@/server/services/view-context";
import { contextWords } from "@/lib/view-context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ImportCsvDialog } from "@/components/teach/students/import-csv-dialog";
import { AiImportStudentsDialog } from "@/components/teach/students/ai-import-students-dialog";
import { getAiSettings } from "@/server/services/ai-settings";
import { NewStudentDialog } from "@/components/teach/students/new-student-dialog";
import { StudentActions } from "@/components/teach/students/student-actions";
import { Pagination } from "@/components/teach/pagination";
import { formatDateTime, formatNumber } from "@/components/teach/format";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Estudiantes" };

/** Pestaña de la lista: el pool completo (por defecto) o solo los del maestro. */
type ListTab = "todos" | "mios";

function listHref(tab: ListTab, q: string): string {
  const sp = new URLSearchParams();
  if (tab === "mios") sp.set("lista", "mios");
  if (q) sp.set("q", q);
  const qs = sp.toString();
  return qs ? `/teach/students?${qs}` : "/teach/students";
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; lista?: string }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const w = contextWords(scope.kind, ownerNameOf(scope));
  const { q = "", page: pageParam, lista } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  // La base de alumnos es una sola: se abre en el pool completo, para encontrar
  // y matricular a quien haya registrado cualquier maestro. En «General» las
  // dos listas coinciden y no hay pestañas.
  const showTabs = scope.kind !== "all";
  const tab: ListTab = showTabs && lista === "mios" ? "mios" : "todos";
  const { rows, total, pageSize } = listStudents(scope, {
    search: q,
    page,
    pageSize: 50,
    pool: tab === "todos",
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Conteo de la otra pestaña, con la misma búsqueda
  const otherTotal = showTabs
    ? listStudents(scope, { search: q, page: 1, pageSize: 1, pool: tab !== "todos" }).total
    : 0;
  const tabs: { value: ListTab; label: string; count: number }[] = [
    { value: "todos", label: "Todos los alumnos", count: tab === "todos" ? total : otherTotal },
    {
      value: "mios",
      label: w.own ? "Mis alumnos" : `Alumnos de ${ownerNameOf(scope) ?? "—"}`,
      count: tab === "mios" ? total : otherTotal,
    },
  ];

  // Cursos propios (no archivados) para "Matricular a todos en…" del asistente
  // «Importar con IA» solo si el administrador guardó la clave de OpenAI
  const aiEnabled = getAiSettings().configured;
  const courses = listTeacherCourses(scope)
    .filter(({ course }) => course.status !== "archived")
    .map(({ course }) => ({ id: course.id, title: course.title }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Estudiantes"
        title={total > 0 ? `Estudiantes (${formatNumber(total)})` : "Estudiantes"}
        description={
          showTabs
            ? "La base de alumnos es una sola para todos los maestros: encuentra a cualquiera y matricúlalo en tus cursos."
            : "Registra, importa y administra a todos los alumnos de la plataforma."
        }
        icon={Users}
        actions={
          <>
            <Form action="/teach/students" className="relative">
              {tab === "mios" && <input type="hidden" name="lista" value="mios" />}
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar por nombre o correo…"
                className="h-11 w-64 pl-9"
                aria-label="Buscar estudiantes"
              />
            </Form>
            <ImportCsvDialog courses={courses} />
            {aiEnabled && <AiImportStudentsDialog courses={courses} />}
            <NewStudentDialog urlTrigger />
          </>
        }
      />

      {showTabs && (
        <nav
          aria-label="Qué alumnos mostrar"
          className="inline-flex w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
        >
          {tabs.map((t) => (
            <Link
              key={t.value}
              href={listHref(t.value, q)}
              aria-current={t.value === tab ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                t.value === tab && "bg-background text-foreground shadow-sm"
              )}
            >
              {t.label}
              <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums text-muted-foreground">
                {formatNumber(t.count)}
              </span>
            </Link>
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center">
          {q ? (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <SearchX className="size-8" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">Sin resultados para «{q}»</p>
              <Link href={listHref(tab, "")} className={buttonVariants({ variant: "outline" })}>
                Limpiar búsqueda
              </Link>
            </>
          ) : (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <Users className="size-8" aria-hidden />
              </span>
              <p className="max-w-sm text-sm text-muted-foreground">
                {tab === "mios"
                  ? w.own
                    ? "Aún no tienes alumnos propios. Búscalos en «Todos los alumnos» o regístralos para matricularlos en tus cursos."
                    : "Aún no hay estudiantes en esta vista."
                  : "Aún no hay alumnos en la plataforma. Regístralos para poder matricularlos."}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <ImportCsvDialog courses={courses} />
                {aiEnabled && <AiImportStudentsDialog courses={courses} />}
                <NewStudentDialog />
              </div>
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
                  <TableHead scope="col" className="text-center">
                    {showTabs ? (w.own ? "Tus cursos" : "Sus cursos") : "Cursos"}
                  </TableHead>
                  <TableHead scope="col">Último acceso</TableHead>
                  <TableHead scope="col">Estado</TableHead>
                  <TableHead scope="col" className="w-12">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
                {rows.map((student) => (
                  <TableRow key={student.id} className={!student.active ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/teach/students/${student.id}`}
                        className="rounded-sm transition-colors hover:text-section-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {student.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{student.email}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatNumber(student.courseCount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(student.lastLoginAt)}
                    </TableCell>
                    <TableCell>
                      {student.active ? (
                        <Badge variant="secondary" className="bg-success/10 text-success">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Su cuenta solo la toca quien lo tiene (misma regla que studentAccountPermissions) */}
                      {(user.role === "admin" || student.mine === 1) && (
                        <StudentActions
                          student={{
                            id: student.id,
                            fullName: student.fullName,
                            email: student.email,
                            active: student.active,
                          }}
                          canDeactivate={user.role === "admin" || !student.sharedElsewhere}
                          canResetPassword={user.role === "admin" || !student.sharedElsewhere}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination
            basePath="/teach/students"
            page={page}
            totalPages={totalPages}
            searchParam={{ key: "q", value: q }}
            params={{ lista: tab === "mios" ? "mios" : undefined }}
          />
        </>
      )}
    </div>
  );
}
