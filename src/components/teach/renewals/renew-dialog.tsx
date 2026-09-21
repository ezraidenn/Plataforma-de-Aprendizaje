"use client";

import { useMemo, useState, useTransition } from "react";
import { Info, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { renewCertificatesAction } from "@/server/actions/teacher-renewals";
import { ChoiceOption } from "./choice-option";

/** Grupo abierto con su curso: los grupos son propios de cada curso. */
export type RenewCohortOption = { id: string; name: string; courseId: string };

/** RenewCohort del servidor (keep / none / existing / new). */
type CohortChoice = Parameters<typeof renewCertificatesAction>[1];
type Mode = CohortChoice["mode"];

export type RenewTarget = {
  certificateId: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseTitle: string;
  cohortName: string | null;
  cohortClosed: boolean;
};

/** «Generación 2025 (5) · Sin grupo (2)» — máx. 3 grupos. */
function groupSummary(targets: RenewTarget[]): string {
  const counts = new Map<string, number>();
  for (const t of targets) {
    const key = t.cohortName ?? "Sin grupo";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = entries
    .slice(0, 3)
    .map(([name, n]) => (entries.length === 1 ? name : `${name} (${n})`));
  return shown.join(" · ") + (entries.length > 3 ? " · …" : "");
}

/**
 * Reinscribir en lote: abre el ciclo siguiente (en cero) de cada matrícula en
 * el grupo elegido. El ciclo anterior y su certificado se conservan.
 */
export function RenewDialog({
  open,
  onOpenChange,
  targets,
  cohorts,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: RenewTarget[];
  /** Grupos abiertos de todos los cursos (se filtran por el curso de la selección) */
  cohorts: RenewCohortOption[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("keep");
  const [cohortId, setCohortId] = useState("");
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  const n = targets.length;
  const people = useMemo(() => new Set(targets.map((t) => t.studentId)).size, [targets]);
  const closedGroups = useMemo(
    () => [...new Set(targets.filter((t) => t.cohortClosed).map((t) => t.cohortName ?? ""))],
    [targets]
  );

  // «Pasar a un grupo abierto» solo aplica si todos son del MISMO curso: el
  // grupo destino tiene que ser de ese curso
  const courseIds = useMemo(() => new Set(targets.map((t) => t.courseId)), [targets]);
  const sameCourse = courseIds.size === 1 ? targets[0] : undefined;
  const courseCohorts = useMemo(
    () => (sameCourse ? cohorts.filter((c) => c.courseId === sameCourse.courseId) : []),
    [cohorts, sameCourse]
  );
  const existingDisabled = !sameCourse || courseCohorts.length === 0;
  const existingHint = !sameCourse
    ? "Los seleccionados son de cursos distintos: cada curso tiene sus grupos."
    : courseCohorts.length === 0
      ? `«${sameCourse.courseTitle}» no tiene grupos abiertos: crea uno nuevo.`
      : `Grupos abiertos de «${sameCourse.courseTitle}».`;

  const cleanName = newName.trim().replace(/\s+/g, " ");
  const nameValid = cleanName.length >= 2 && cleanName.length <= 80;
  const ready =
    mode === "keep" ||
    mode === "none" ||
    (mode === "existing" && !existingDisabled && courseCohorts.some((c) => c.id === cohortId)) ||
    (mode === "new" && nameValid);

  function choice(): CohortChoice {
    switch (mode) {
      case "keep":
        return { mode: "keep" };
      case "none":
        return { mode: "none" };
      case "existing":
        return { mode: "existing", cohortId };
      case "new":
        return { mode: "new", name: cleanName };
    }
  }

  function submit() {
    if (!ready || n === 0) return;
    startTransition(async () => {
      const result = await renewCertificatesAction(
        targets.map((t) => t.certificateId),
        choice()
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { renewed, skipped } = result;
      if (renewed > 0) {
        toast.success(
          renewed === 1 ? "Reinscripción lista" : `${renewed} reinscripciones listas`,
          {
            description:
              "Cada ciclo nuevo empieza en cero; los certificados anteriores se conservan.",
          }
        );
      }
      if (skipped > 0) {
        toast.info(
          skipped === 1
            ? "1 ya tenía un ciclo nuevo y se omitió"
            : `${skipped} ya tenían un ciclo nuevo y se omitieron`
        );
      }
      if (renewed === 0 && skipped === 0) {
        toast.info("No había nada que reinscribir: la lista ya estaba al día");
      }
      onOpenChange(false);
      onDone();
    });
  }

  const first = targets[0];
  const title =
    n === 1 && first
      ? `Reinscribir a ${first.studentName}`
      : people === n
        ? `Reinscribir a ${n} personas`
        : `Reinscribir ${n} matrículas`;
  const description =
    n === 1 && first
      ? `En «${first.courseTitle}».`
      : people === n
        ? "Cada una en el curso de su certificado."
        : `${people} personas en varios cursos: cada matrícula en el curso de su certificado.`;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-xl border border-section/30 bg-section-soft/50 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-section-strong" aria-hidden />
          <p>
            Se abre un <strong className="font-semibold">ciclo nuevo en cero</strong>: progreso,
            intentos de examen y entregas empiezan de nuevo. El certificado anterior se conserva y
            sigue siendo verificable.
          </p>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">¿En qué grupo quedan?</legend>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-2">
            <ChoiceOption
              id="renew-keep"
              value="keep"
              active={mode === "keep"}
              title="Mantener su grupo"
              hint={`Ahora: ${groupSummary(targets)}`}
            />
            <ChoiceOption
              id="renew-existing"
              value="existing"
              active={mode === "existing"}
              disabled={existingDisabled}
              title="Pasar a un grupo abierto"
              hint={existingHint}
            >
              <Select value={cohortId} onValueChange={setCohortId}>
                <SelectTrigger
                  className="w-full"
                  aria-label={
                    sameCourse
                      ? `Grupo abierto de ${sameCourse.courseTitle}`
                      : "Grupo abierto"
                  }
                >
                  <SelectValue placeholder="Elige un grupo" />
                </SelectTrigger>
                <SelectContent>
                  {courseCohorts.map((cohort) => (
                    <SelectItem key={cohort.id} value={cohort.id}>
                      {cohort.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ChoiceOption>
            <ChoiceOption
              id="renew-none"
              value="none"
              active={mode === "none"}
              title="Sin grupo"
              hint="El ciclo nuevo no pertenece a ningún grupo."
            />
            <ChoiceOption
              id="renew-new"
              value="new"
              active={mode === "new"}
              title="Crear un grupo nuevo"
              hint="Se crea en el curso de cada certificado; si ya existe uno abierto con ese nombre, se usa ese."
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                placeholder="Ej. Recertificación 2027"
                aria-label="Nombre del grupo nuevo"
                aria-invalid={newName.length > 0 && !nameValid ? true : undefined}
                autoFocus
              />
              {newName.length > 0 && !nameValid && (
                <p className="mt-1 text-xs text-destructive">Entre 2 y 80 caracteres.</p>
              )}
            </ChoiceOption>
          </RadioGroup>
        </fieldset>

        {mode === "keep" && closedGroups.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              {closedGroups.length === 1
                ? `«${closedGroups[0]}» está cerrado`
                : `${closedGroups.map((g) => `«${g}»`).join(", ")} están cerrados`}
              : sus ciclos nuevos no aparecerán en las vistas diarias. Considera pasarlos a un grupo
              abierto o crear uno nuevo.
            </span>
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !ready || n === 0}
            className="bg-section text-white hover:bg-section-strong"
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw aria-hidden />
            )}
            {pending ? "Reinscribiendo…" : n === 1 ? "Reinscribir" : `Reinscribir (${n})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
