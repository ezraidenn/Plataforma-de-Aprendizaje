"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Loader2, Search, SearchX, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { cohortNameKey } from "@/lib/cohort-name";
import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CohortPicker,
  isCohortChoiceReady,
  type CohortChoice,
} from "@/components/teach/cohort-picker";
import { importCohortAction } from "@/server/actions/teacher-cohorts";
import {
  enrollStudentsAction,
  searchStudentsToEnrollAction,
  type StudentSearchRow,
} from "@/server/actions/teacher-students";
import type { CohortOption, ImportableCohort } from "@/server/services/cohorts";
import { ImportCohortPanel } from "./import-cohort-panel";
import { OpenFromUrl } from "@/components/open-from-url";
import { clearUrlParam, useOpenDialogRequest } from "@/lib/open-dialog";

type Mode = "students" | "import";

const fmt = (n: number) => n.toLocaleString("es-MX");

/** Pestaña del selector de modo: admite dos renglones en pantallas angostas. */
const TAB_TRIGGER =
  "h-auto min-h-9 gap-2 whitespace-normal rounded-lg px-3 py-1.5 text-center text-[13.5px] font-semibold leading-tight";

/**
 * Matrícula en un curso, en dos modos:
 *  - «Elegir estudiantes»: búsqueda y selección, con grupo opcional DE ESTE curso.
 *  - «Traer grupo de otro curso»: inscribe de una vez a los alumnos de un grupo
 *    de otro curso del maestro, en un grupo con el mismo nombre en este curso.
 */
export function EnrollDialog({
  courseId,
  defaultCohortId = null,
  courseCohorts = [],
  importable = [],
  urlTrigger = false,
}: {
  courseId: string;
  /** Grupo preseleccionado (p. ej. el que se está filtrando en la lista) */
  defaultCohortId?: string | null;
  /** Grupos de ESTE curso (abiertos y cerrados): avisan si el grupo a traer ya existe aquí */
  courseCohorts?: CohortOption[];
  /** Grupos con alumnos de los otros cursos del maestro */
  importable?: ImportableCohort[];
  /** Se abre solo con ?matricular=1 (guía de primeros pasos). Una por página. */
  urlTrigger?: boolean;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("students");
  // «Elegir estudiantes»
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<StudentSearchRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cohort, setCohort] = useState<CohortChoice>({ cohortId: defaultCohortId });
  const [cohortLabel, setCohortLabel] = useState("");
  // «Traer grupo de otro curso»
  const [importQuery, setImportQuery] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [enrolling, startEnroll] = useTransition();
  const [importing, startImport] = useTransition();
  const busy = enrolling || importing;

  const source = importable.find((c) => c.id === sourceId) ?? null;
  // El servidor reutiliza el grupo de este curso con el mismo nombre; si está cerrado, rechaza
  const existingTarget = source
    ? (courseCohorts.find((c) => cohortNameKey(c.name) === cohortNameKey(source.name)) ?? null)
    : null;
  const importBlocked = existingTarget?.status === "closed";

  // Búsqueda server-side con debounce
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const result = await searchStudentsToEnrollAction(courseId, query);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setRows(result.rows);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [open, query, courseId]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function confirm() {
    if (!isCohortChoiceReady(cohort)) return;
    startEnroll(async () => {
      const result = await enrollStudentsAction(courseId, [...selected], cohort);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const base =
        result.count === 1 ? "1 estudiante matriculado" : `${result.count} estudiantes matriculados`;
      const inCohort = cohort.cohortId || cohort.newCohortName?.trim();
      toast.success(inCohort && cohortLabel ? `${base} en «${cohortLabel}»` : base);
      closeAfterWork();
      router.refresh();
    });
  }

  function importGroup() {
    if (!source || importBlocked) return;
    const sourceCohortId = source.id;
    startImport(async () => {
      const result = await importCohortAction(courseId, sourceCohortId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { cohortId, cohortName, enrolled, alreadyEnrolled } = result;
      if (enrolled > 0) {
        const already =
          alreadyEnrolled > 0
            ? ` · ${fmt(alreadyEnrolled)} ya ${alreadyEnrolled === 1 ? "estaba" : "estaban"}`
            : "";
        const who = `${fmt(enrolled)} ${enrolled === 1 ? "inscrito" : "inscritos"}`;
        toast.success(`${who} en «${cohortName}»${already}`, {
          action: cohortId
            ? {
                label: "Ver grupo",
                onClick: () =>
                  router.push(`/teach/courses/${courseId}/students?grupo=${encodeURIComponent(cohortId)}`),
              }
            : undefined,
        });
      } else if (alreadyEnrolled > 0) {
        toast.info(
          alreadyEnrolled === 1
            ? `Nadie nuevo: el alumno de «${cohortName}» ya estaba en este curso`
            : `Nadie nuevo: los ${fmt(alreadyEnrolled)} alumnos de «${cohortName}» ya estaban en este curso`
        );
      } else {
        toast.info(`«${cohortName}» ya no tiene alumnos que inscribir`);
      }
      closeAfterWork();
      router.refresh();
    });
  }

  function resetForm() {
    setMode("students");
    setQuery("");
    setRows([]);
    setSelected(new Set());
    setCohort({ cohortId: defaultCohortId });
    setCohortLabel("");
    setImportQuery("");
    setSourceId(null);
  }

  /** Cierre tras matricular/importar: `handleOpenChange` aún vería `busy` */
  function closeAfterWork() {
    setOpen(false);
    resetForm();
    clearUrlParam("matricular");
  }

  function handleOpenChange(next: boolean) {
    if (!next && busy) return;
    setOpen(next);
    if (next) setCohort({ cohortId: defaultCohortId });
    else {
      resetForm();
      clearUrlParam("matricular");
    }
  }

  function openSelf() {
    if (urlTrigger) handleOpenChange(true);
  }
  useOpenDialogRequest("enroll", openSelf);

  return (
    <>
    {urlTrigger && <OpenFromUrl param="matricular" onOpen={openSelf} />}
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90">
          <UserPlus aria-hidden />
          Matricular estudiantes
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        // Al abrir, el foco va a la búsqueda (no a las pestañas)
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Matricular estudiantes</DialogTitle>
          <DialogDescription>
            Elige a quiénes matricular en este curso o trae de una vez un grupo de otro de tus
            cursos.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-4">
          <TabsList
            aria-label="Forma de matricular"
            className="w-full items-stretch rounded-xl p-1 group-data-horizontal/tabs:h-auto"
          >
            {/* Mientras se envía no se puede cambiar de modo */}
            <TabsTrigger
              value="students"
              disabled={busy && mode !== "students"}
              className={TAB_TRIGGER}
            >
              <Users aria-hidden />
              Elegir estudiantes
            </TabsTrigger>
            <TabsTrigger value="import" disabled={busy && mode !== "import"} className={TAB_TRIGGER}>
              <FolderInput aria-hidden />
              Traer grupo de otro curso
            </TabsTrigger>
          </TabsList>

          {/* Montadas siempre: cambiar de pestaña no pierde búsqueda, selección ni grupos cargados */}
          <TabsContent value="students" forceMount className="grid gap-4 data-[state=inactive]:hidden">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre o correo…"
                className="pl-9"
                aria-label="Buscar estudiantes"
              />
            </div>

            <ScrollArea className="h-64 rounded-lg border">
              {searching && rows.length === 0 ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
                  <span className="sr-only">Buscando…</span>
                </div>
              ) : rows.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 p-4 text-center">
                  <SearchX className="size-8 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">
                    {query ? `Sin resultados para «${query}»` : "No hay estudiantes registrados aún"}
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50 ${
                          row.enrolled ? "cursor-default opacity-60" : ""
                        }`}
                      >
                        <Checkbox
                          checked={row.enrolled || selected.has(row.id)}
                          disabled={row.enrolled}
                          onCheckedChange={(checked) => toggle(row.id, checked === true)}
                          aria-label={`Seleccionar a ${row.fullName}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{row.fullName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.email}
                          </span>
                        </span>
                        {row.enrolled && (
                          <Badge variant="secondary" className="shrink-0 text-[11px]">
                            Ya matriculado
                          </Badge>
                        )}
                        {!row.active && (
                          <Badge variant="secondary" className="shrink-0 text-[11px]">
                            Inactivo
                          </Badge>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>

            <CohortPicker
              courseId={courseId}
              value={cohort}
              onChange={(next, label) => {
                setCohort(next);
                setCohortLabel(label);
              }}
              disabled={busy}
              hint="Opcional. Aquí están los grupos de este curso: sirven para separar oleadas y filtrar después listas y reportes."
            />
          </TabsContent>

          <TabsContent value="import" forceMount className="data-[state=inactive]:hidden">
            <ImportCohortPanel
              cohorts={importable}
              query={importQuery}
              onQueryChange={setImportQuery}
              value={sourceId}
              onValueChange={setSourceId}
              existing={existingTarget}
              disabled={busy}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          {mode === "students" ? (
            <Button
              className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
              disabled={selected.size === 0 || busy || !isCohortChoiceReady(cohort)}
              onClick={confirm}
            >
              {enrolling && <Loader2 className="animate-spin" aria-hidden />}
              {selected.size === 0
                ? "Matricular"
                : selected.size === 1
                  ? "Matricular 1 estudiante"
                  : `Matricular ${selected.size} estudiantes`}
            </Button>
          ) : (
            <Button
              className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
              disabled={!source || busy || importBlocked}
              onClick={importGroup}
            >
              {importing ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <FolderInput aria-hidden />
              )}
              Inscribir grupo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
