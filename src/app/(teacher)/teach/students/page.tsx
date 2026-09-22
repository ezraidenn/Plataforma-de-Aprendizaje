import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { Search, SearchX, Users } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { listStudents, listTeacherCourses } from "@/server/services/courses";
import { ownerNameOf } from "@/server/services/view-context";
import { contextWords } from "@/lib/view-context";
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

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const w = contextWords(scope.kind, ownerNameOf(scope));
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const { rows, total, pageSize } = listStudents(scope, { search: q, page, pageSize: 50 });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
          w.own
            ? "Registra, importa y administra a las personas que toman tus cursos."
            : `Registra, importa y administra a las personas que toman ${w.courses}.`
        }
        icon={Users}
        actions={
          <>
            <Form action="/teach/students" className="relative">
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

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center">
          {q ? (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <SearchX className="size-8" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">Sin resultados para «{q}»</p>
              <Link href="/teach/students" className={buttonVariants({ variant: "outline" })}>
                Limpiar búsqueda
              </Link>
            </>
          ) : (
            <>
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <Users className="size-8" aria-hidden />
              </span>
              <p className="max-w-sm text-sm text-muted-foreground">
                {w.own
                  ? "Registra a tus estudiantes para poder matricularlos en tus cursos."
                  : "Aún no hay estudiantes en esta vista."}
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
                    Cursos
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
          />
        </>
      )}
    </div>
  );
}
