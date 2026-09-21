"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COHORT_NAME_MAX as NAME_MAX,
  COHORT_NAME_MIN as NAME_MIN,
  cohortNameKey,
} from "@/lib/cohort-name";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listCohortOptionsAction } from "@/server/actions/teacher-cohorts";
import type { CohortChoice } from "@/server/actions/teacher-students";

export type { CohortChoice };

const NONE = "__none__";
const NEW = "__new__";

/** Elección inicial neutra: sin grupo. */
export const NO_COHORT: CohortChoice = { cohortId: null };

/** ¿Se puede enviar? Un grupo nuevo necesita un nombre de 2 a 80 caracteres. */
export function isCohortChoiceReady(choice: CohortChoice): boolean {
  if (typeof choice.newCohortName !== "string") return true;
  const length = choice.newCohortName.trim().length;
  return length >= NAME_MIN && length <= NAME_MAX;
}

type Option = { id: string; name: string };

/**
 * Selector de grupo para formularios de UN curso: «Sin grupo», los grupos
 * ABIERTOS de ese curso y «+ Nuevo grupo…», que muestra un campo para escribir
 * el nombre (el grupo se crea en ese curso). Controlado: devuelve un
 * `CohortChoice` listo para las acciones de matrícula. El segundo argumento de
 * `onChange` es la etiqueta legible (útil para los avisos).
 */
export function CohortPicker({
  courseId,
  value,
  onChange,
  label = "Grupo",
  noneLabel = "Sin grupo",
  hint,
  disabled,
  className,
}: {
  /** Curso cuyos grupos se ofrecen (los grupos son propios de cada curso) */
  courseId: string;
  value: CohortChoice;
  onChange: (next: CohortChoice, label: string) => void;
  label?: string;
  noneLabel?: string;
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [options, setOptions] = useState<Option[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Última elección/callback, para validar la preselección cuando llegan las opciones
  const latest = useRef({ value, onChange, noneLabel });
  useEffect(() => {
    latest.current = { value, onChange, noneLabel };
  });

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setFailed(false);
    listCohortOptionsAction(courseId)
      .then((rows) => {
        if (cancelled) return;
        const opts = rows.map((r) => ({ id: r.id, name: r.name }));
        setOptions(opts);
        // Preselección: si el grupo ya no está abierto vuelve a «Sin grupo»; si
        // sigue abierto, se informa su nombre (para los avisos del formulario).
        const current = latest.current;
        const preset = current.value.cohortId;
        if (typeof current.value.newCohortName !== "string" && preset) {
          const match = opts.find((o) => o.id === preset);
          if (match) current.onChange({ cohortId: preset }, match.name);
          else current.onChange({ cohortId: null }, current.noneLabel);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setOptions([]);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const isNew = typeof value.newCohortName === "string";
  const selectValue = isNew ? NEW : (value.cohortId ?? NONE);
  const newName = value.newCohortName ?? "";

  // El servidor reutiliza el grupo del curso si el nombre ya existe: se avisa aquí
  const existingMatch =
    isNew && newName.trim().length >= NAME_MIN && options
      ? options.find((o) => cohortNameKey(o.name) === cohortNameKey(newName))
      : undefined;

  function handleSelect(next: string) {
    if (next === NEW) {
      onChange({ newCohortName: "" }, "");
    } else if (next === NONE) {
      onChange({ cohortId: null }, noneLabel);
    } else {
      onChange({ cohortId: next }, options?.find((o) => o.id === next)?.name ?? "");
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>

      {options === null ? (
        <div
          id={id}
          role="status"
          className="flex h-11 items-center gap-2 rounded-lg border border-input px-3 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Cargando grupos…
        </div>
      ) : (
        <Select value={selectValue} onValueChange={handleSelect} disabled={disabled}>
          <SelectTrigger id={id} className="w-full data-[size=default]:h-11">
            <SelectValue placeholder={noneLabel} />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-72">
            <SelectItem value={NONE}>{noneLabel}</SelectItem>
            {options.length > 0 && <SelectSeparator />}
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW} className="font-medium text-section-strong">
              + Nuevo grupo…
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {isNew && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-new`} className="sr-only">
            Nombre del grupo nuevo
          </Label>
          <Input
            id={`${id}-new`}
            value={newName}
            onChange={(e) => onChange({ newCohortName: e.target.value }, e.target.value.trim())}
            placeholder="Ej. Ingreso octubre 2026"
            maxLength={NAME_MAX}
            autoFocus
            disabled={disabled}
            aria-describedby={`${id}-new-hint`}
            className="h-11"
          />
          <p id={`${id}-new-hint`} className="text-xs text-muted-foreground">
            {existingMatch ? (
              <span className="inline-flex items-start gap-1">
                <Info className="mt-0.5 size-3.5 shrink-0 text-section-strong" aria-hidden />
                Ya existe «{existingMatch.name}»: se usará ese grupo.
              </span>
            ) : newName.trim().length > 0 && newName.trim().length < NAME_MIN ? (
              "Escribe al menos 2 caracteres."
            ) : (
              "Se crea en este curso al guardar. Usa algo que identifique la oleada: fecha, empresa, turno…"
            )}
          </p>
        </div>
      )}

      {failed && (
        <p className="text-xs text-warning">
          No se pudieron cargar los grupos. Puedes crear uno nuevo o continuar sin grupo.
        </p>
      )}
      {hint && !isNew && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
