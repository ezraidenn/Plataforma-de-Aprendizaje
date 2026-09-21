"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookPlus, Info, Loader2, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CourseStatusBadge } from "@/components/teach/course-status-badge";
import {
  COHORT_NAME_MAX,
  COHORT_NAME_MIN,
  cleanCohortName,
  cohortNameKey,
} from "@/lib/cohort-name";
import { matchesAllWords } from "@/lib/search";
import { enrollStudentInCoursesAction } from "@/server/actions/teacher-students";

export type EnrollableCourse = {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  /** Ya matriculado (activo o completado) */
  enrolled: boolean;
};

/** Grupo existente en alguno de los cursos del maestro (para sugerir y avisar). */
export type ExistingCohort = {
  courseId: string;
  name: string;
  status: "open" | "closed";
};

const listFormat = new Intl.ListFormat("es-MX", { style: "long", type: "conjunction" });
const coursesLabel = (n: number) => `${n} ${n === 1 ? "curso" : "cursos"}`;

/**
 * Matrícula masiva desde el perfil: elige varios cursos y se inscribe de una
 * vez. Se abre solo si la URL trae ?matricular=1 (flujo "alumno recién creado").
 * Como cada curso tiene sus propios grupos, el grupo va por NOMBRE: en cada
 * curso se usa el grupo con ese nombre o se crea.
 */
export function BulkEnrollDialog({
  studentId,
  studentName,
  courses,
  cohorts = [],
}: {
  studentId: string;
  studentName: string;
  courses: EnrollableCourse[];
  /** Grupos de los cursos del maestro (abiertos y cerrados) */
  cohorts?: ExistingCohort[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cohortName, setCohortName] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (params.get("matricular") === "1") setOpen(true);
  }, [params]);

  const available = useMemo(() => courses.filter((c) => !c.enrolled), [courses]);
  const visible = useMemo(() => {
    return query.trim() ? available.filter((c) => matchesAllWords(query, c.title)) : available;
  }, [available, query]);

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  // Sugerencias: nombres de grupos ABIERTOS, sin repetir (el mismo nombre suele
  // ser la misma oleada en varios cursos)
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const c of cohorts) {
      const key = cohortNameKey(c.name);
      if (c.status !== "open" || seen.has(key)) continue;
      seen.add(key);
      names.push(c.name);
    }
    return names.sort((a, b) => a.localeCompare(b, "es-MX"));
  }, [cohorts]);

  const name = cleanCohortName(cohortName);
  const nameTooShort = name.length > 0 && name.length < COHORT_NAME_MIN;

  // Qué pasará con ese nombre en cada curso elegido: se usa, se crea o choca con uno cerrado
  const plan = useMemo(() => {
    if (name.length < COHORT_NAME_MIN) return null;
    const chosen = available.filter((c) => selected.has(c.id));
    if (chosen.length === 0) return null;
    const key = cohortNameKey(name);
    let reuse = 0;
    const closedIn: string[] = [];
    for (const course of chosen) {
      const match = cohorts.find((c) => c.courseId === course.id && cohortNameKey(c.name) === key);
      if (match?.status === "closed") closedIn.push(`«${course.title}»`);
      else if (match) reuse++;
    }
    return { reuse, create: chosen.length - reuse - closedIn.length, closedIn };
  }, [name, available, selected, cohorts]);

  const blocked = (plan?.closedIn.length ?? 0) > 0;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of visible) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }

  function submit() {
    if (nameTooShort || blocked) return;
    startTransition(async () => {
      const result = await enrollStudentInCoursesAction(studentId, Array.from(selected), name || null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const base =
        result.count === 1 ? "Matriculado en 1 curso" : `Matriculado en ${result.count} cursos`;
      toast.success(name ? `${base} · grupo «${name}»` : base);
      setSelected(new Set());
      setCohortName("");
      setOpen(false);
      router.replace(`/teach/students/${studentId}`);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        setOpen(next);
        if (!next) setCohortName("");
      }}
    >
      <DialogTrigger asChild>
        <Button className="bg-section text-white hover:bg-section-strong">
          <BookPlus className="size-4" aria-hidden />
          Matricular en cursos
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Matricular a {studentName}</DialogTitle>
          <DialogDescription>
            Elige uno o varios de tus cursos. Los cursos donde ya está inscrito no aparecen.
          </DialogDescription>
        </DialogHeader>

        {available.length === 0 ? (
          <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            Ya está matriculado en todos tus cursos.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar curso…"
                className="pl-9"
                aria-label="Buscar curso"
              />
            </div>
            <label className="flex items-center gap-2 px-1 text-sm">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label="Seleccionar todos los cursos visibles"
              />
              Seleccionar todos ({visible.length})
            </label>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border">
              {visible.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-accent/50">
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={(v) => toggle(c.id, v === true)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                    <CourseStatusBadge status={c.status} />
                  </label>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                  Sin resultados
                </li>
              )}
            </ul>

            <div className="grid gap-2">
              <Label htmlFor={fieldId}>Grupo (opcional)</Label>
              <Input
                id={fieldId}
                list={`${fieldId}-suggestions`}
                value={cohortName}
                onChange={(e) => setCohortName(e.target.value)}
                placeholder="Ej. Generación agosto 2026"
                maxLength={COHORT_NAME_MAX}
                autoComplete="off"
                disabled={pending}
                aria-invalid={nameTooShort || undefined}
                aria-describedby={`${fieldId}-hint ${fieldId}-plan`}
                className="h-11"
              />
              <datalist id={`${fieldId}-suggestions`}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
                {nameTooShort
                  ? `Escribe al menos ${COHORT_NAME_MIN} caracteres.`
                  : "En cada curso se usa el grupo con ese nombre o se crea uno nuevo. Déjalo vacío para no asignar grupo."}
              </p>
              <div id={`${fieldId}-plan`} aria-live="polite">
                {plan && blocked ? (
                  <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    <span>
                      «{name}» está cerrado en {listFormat.format(plan.closedIn)}. Reábrelo en
                      Grupos, quita {plan.closedIn.length === 1 ? "ese curso" : "esos cursos"} o
                      usa otro nombre.
                    </span>
                  </p>
                ) : plan ? (
                  <p className="flex items-start gap-1.5 text-xs text-section-strong">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {plan.reuse === 0
                      ? plan.create === 1
                        ? "Se creará en el curso elegido."
                        : `Se creará en los ${plan.create} cursos elegidos.`
                      : plan.create === 0
                        ? plan.reuse === 1
                          ? "Ya existe en el curso elegido: se usará ese."
                          : `Ya existe en los ${plan.reuse} cursos elegidos: se usará en cada uno.`
                        : `Ya existe en ${coursesLabel(plan.reuse)} (se usará) y se creará en ${coursesLabel(plan.create)}.`}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || selected.size === 0 || nameTooShort || blocked}
            className="bg-section text-white hover:bg-section-strong"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BookPlus className="size-4" aria-hidden />}
            Matricular en {selected.size} {selected.size === 1 ? "curso" : "cursos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
