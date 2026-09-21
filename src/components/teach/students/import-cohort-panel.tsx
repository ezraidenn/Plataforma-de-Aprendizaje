"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { Info, Layers, Lock, Search, SearchX, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchesAllWords } from "@/lib/search";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CohortOption, ImportableCohort } from "@/server/services/cohorts";
import { HelpTip } from "@/components/help/help-tip";

const fmt = (n: number) => n.toLocaleString("es-MX");
const studentsLabel = (n: number) => `${fmt(n)} ${n === 1 ? "alumno" : "alumnos"}`;

type CourseSection = { courseId: string; courseTitle: string; items: ImportableCohort[] };

/**
 * «Traer grupo de otro curso»: grupos con alumnos de los OTROS cursos del
 * maestro, agrupados por curso y con búsqueda local, más un resumen de lo que
 * pasará al inscribir el elegido. Controlado: el diálogo guarda la elección y
 * hace el envío.
 */
export function ImportCohortPanel({
  cohorts,
  query,
  onQueryChange,
  value,
  onValueChange,
  existing,
  disabled,
}: {
  cohorts: ImportableCohort[];
  query: string;
  onQueryChange: (query: string) => void;
  value: string | null;
  onValueChange: (cohortId: string) => void;
  /** Grupo de ESTE curso con el mismo nombre que el elegido, si existe */
  existing: CohortOption | null;
  disabled?: boolean;
}) {
  const id = useId();

  // Secciones por curso (en el orden del servidor); dentro de cada una, los
  // abiertos primero sin perder el orden de llegada (sort estable)
  const sections = useMemo(() => {
    const term = query.trim();
    const byCourse = new Map<string, CourseSection>();
    for (const c of cohorts) {
      if (term && !matchesAllWords(term, `${c.name} ${c.courseTitle}`)) continue;
      const section = byCourse.get(c.courseId);
      if (section) section.items.push(c);
      else byCourse.set(c.courseId, { courseId: c.courseId, courseTitle: c.courseTitle, items: [c] });
    }
    const rank = (c: ImportableCohort) => (c.status === "open" ? 0 : 1);
    return [...byCourse.values()].map((s) => ({ ...s, items: s.items.sort((a, b) => rank(a) - rank(b)) }));
  }, [cohorts, query]);

  const selected = cohorts.find((c) => c.id === value) ?? null;

  if (cohorts.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
        <span className="anim-pop flex size-12 items-center justify-center rounded-full bg-section-soft text-section-strong">
          <Layers className="size-6" aria-hidden />
        </span>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          Tus otros cursos aún no tienen grupos
          <HelpTip topic="groups.import" />
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Cuando un grupo de otro de tus cursos tenga alumnos, aparecerá aquí para inscribirlo en
          este curso de una sola vez.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        Grupos de tus otros cursos
        <HelpTip topic="groups.import" />
      </p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar grupo o curso…"
          className="pl-9"
          aria-label="Buscar entre los grupos de tus otros cursos"
          aria-controls={`${id}-list`}
        />
      </div>

      <div id={`${id}-list`} className="h-56 overflow-y-auto rounded-lg border">
        {sections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <SearchX className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Sin resultados para «{query.trim()}»</p>
          </div>
        ) : (
          <RadioGroup
            value={value ?? ""}
            onValueChange={onValueChange}
            disabled={disabled}
            aria-label="Grupos de tus otros cursos"
            className="gap-0"
          >
            {sections.map((section) => (
              <div key={section.courseId}>
                <p className="sticky top-0 z-10 truncate border-b bg-muted px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.courseTitle}
                </p>
                {section.items.map((c) => {
                  const itemId = `${id}-${c.id}`;
                  const checked = c.id === value;
                  return (
                    <label
                      key={c.id}
                      htmlFor={itemId}
                      className={cn(
                        "flex items-center gap-3 border-b px-3 py-2.5 transition-colors last:border-b-0",
                        checked ? "bg-section-soft/60" : "hover:bg-muted/50",
                        disabled ? "cursor-default opacity-60" : "cursor-pointer"
                      )}
                    >
                      <RadioGroupItem id={itemId} value={c.id} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.courseTitle} · {studentsLabel(c.memberCount)}
                        </span>
                      </span>
                      {c.status === "closed" && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 bg-muted text-[11px] text-muted-foreground"
                        >
                          <Lock aria-hidden />
                          Cerrado
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
          </RadioGroup>
        )}
      </div>

      <div aria-live="polite">
        {!selected ? (
          <p className="text-xs text-muted-foreground">
            Elige un grupo: sus alumnos se inscriben en este curso, en un grupo con el mismo nombre.
          </p>
        ) : existing?.status === "closed" ? (
          // El servidor no mete matrículas nuevas en un grupo cerrado: se avisa antes
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              Este curso ya tiene un grupo «{existing.name}» y está cerrado.{" "}
              <Link
                href={`/teach/groups?estado=closed&q=${encodeURIComponent(existing.name)}`}
                className="font-medium text-section-strong underline underline-offset-2"
              >
                Reábrelo en Grupos
              </Link>{" "}
              para inscribir aquí a sus alumnos.
            </span>
          </p>
        ) : (
          <div className="grid gap-1.5 rounded-lg border border-section/30 bg-section-soft/50 p-3 text-sm">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-section-strong" aria-hidden />
              <span>
                {selected.memberCount === 1
                  ? `Se inscribirá al único alumno de «${selected.name}»`
                  : `Se inscribirán los ${fmt(selected.memberCount)} alumnos de «${selected.name}»`}{" "}
                en un grupo «{selected.name}» de este curso. Quien ya esté inscrito aquí se queda como
                está. El grupo original no cambia.
              </span>
            </p>
            {existing && (
              <p className="pl-6 text-xs text-muted-foreground">
                Este curso ya tiene el grupo «{existing.name}»: se usará ese.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
