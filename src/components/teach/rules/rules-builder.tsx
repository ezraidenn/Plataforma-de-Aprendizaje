"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  Eye,
  FileQuestion,
  Loader2,
  Plus,
  Target,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import type { Condition } from "@/server/services/rules-engine";
import { saveRulesAction } from "@/server/actions/teacher-rules";
import { cn } from "@/lib/utils";
import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ExamOption = { id: string; title: string };

type Entry = { key: number; condition: Condition };

export function RulesBuilder({
  courseId,
  initialConditions,
  initialOp,
  examOptions,
}: {
  courseId: string;
  initialConditions: Condition[];
  /** Cómo se combinan: Y (todas) u O (al menos una) */
  initialOp: "AND" | "OR";
  examOptions: ExamOption[];
}) {
  const router = useRouter();
  const nextKey = useRef(0);
  const [entries, setEntries] = useState<Entry[]>(() =>
    initialConditions.map((condition) => ({ key: nextKey.current++, condition }))
  );
  const [error, setError] = useState<string | null>(null);
  const [op, setOp] = useState<"AND" | "OR">(initialOp);
  const [saving, startSaving] = useTransition();

  const hasType = (type: Condition["type"]) => entries.some((e) => e.condition.type === type);
  const noExams = examOptions.length === 0;

  function addCondition(condition: Condition) {
    setEntries((prev) => [...prev, { key: nextKey.current++, condition }]);
    setError(null);
  }

  function updateCondition(key: number, condition: Condition) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, condition } : e)));
  }

  function removeCondition(key: number) {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }

  function validate(): string | null {
    if (entries.length === 0) return "Agrega al menos una condición";
    for (const { condition } of entries) {
      if (
        (condition.type === "viewing_completion" ||
          condition.type === "exam_average" ||
          condition.type === "exam_specific") &&
        (!Number.isInteger(condition.min_percent) ||
          condition.min_percent < 1 ||
          condition.min_percent > 100)
      ) {
        return "Los porcentajes deben ser números enteros entre 1 y 100";
      }
      if (condition.type === "exam_specific" && !condition.item_id) {
        return "Elige el examen para la condición de examen específico";
      }
      if (
        condition.type === "exam_average" &&
        condition.scope !== "all" &&
        condition.scope.length === 0
      ) {
        return "Elige al menos un examen para el promedio";
      }
    }
    return null;
  }

  function save() {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveRulesAction(
        courseId,
        entries.map((e) => e.condition),
        op
      );
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(
        "Las reglas se evaluaron de nuevo para todos. Nadie pierde una aprobación ya otorgada."
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <span className="font-medium">Un estudiante aprueba cuando cumple</span>
        <div role="radiogroup" aria-label="Cómo se combinan las condiciones" className="inline-flex rounded-lg bg-muted p-0.5">
          {(["AND", "OR"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={op === v}
              onClick={() => setOp(v)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors duration-150",
                op === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v === "AND" ? "todas (Y)" : "al menos una (O)"}
            </button>
          ))}
        </div>
        <span>estas condiciones</span>
        <HelpTip topic="rules.operator" value={{ op }} />
      </div>
      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-10 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <CircleCheck className="size-8" aria-hidden />
          </span>
          <p className="max-w-sm text-sm text-muted-foreground">
            Sin condiciones, nadie puede aprobar el curso. Agrega al menos una.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map(({ key, condition }) => (
            <li key={key}>
              <ConditionCard
                condition={condition}
                examOptions={examOptions}
                onChange={(c) => updateCondition(key, c)}
                onRemove={() => removeCondition(key)}
              />
            </li>
          ))}
        </ul>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Plus aria-hidden />
            Agregar condición
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem
            disabled={hasType("viewing_completion")}
            onSelect={() => addCondition({ type: "viewing_completion", min_percent: 100 })}
          >
            <Eye aria-hidden />
            Ver todo el contenido requerido
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={hasType("exam_average") || noExams}
            onSelect={() => addCondition({ type: "exam_average", min_percent: 80, scope: "all" })}
          >
            <FileQuestion aria-hidden />
            Promedio de exámenes
            {noExams && <span className="ml-auto text-xs">(sin exámenes)</span>}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={noExams}
            onSelect={() =>
              addCondition({
                type: "exam_specific",
                item_id: examOptions[0]?.id ?? "",
                min_percent: 80,
              })
            }
          >
            <Target aria-hidden />
            Un examen específico
            {noExams && <span className="ml-auto text-xs">(sin exámenes)</span>}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={hasType("all_items_completed")}
            onSelect={() => addCondition({ type: "all_items_completed" })}
          >
            <CircleCheck aria-hidden />
            Completar todos los ítems requeridos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={saving}
          className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
        >
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {saving ? "Guardando…" : "Guardar reglas"}
        </Button>
      </div>
    </div>
  );
}

// ─── Card de una condición ───────────────────────────────────────────────────

function ConditionCard({
  condition,
  examOptions,
  onChange,
  onRemove,
}: {
  condition: Condition;
  examOptions: ExamOption[];
  onChange: (condition: Condition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="anim-rise flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      {condition.type === "viewing_completion" && (
        <>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <Eye className="size-5" aria-hidden />
          </span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Ver todo el contenido requerido
            <HelpTip topic="rules.viewing" value={{ min: helpPercent(condition.min_percent, 100) }} />
          </span>
          <span className="flex items-center gap-1.5 text-sm">
            al
            <PercentInput
              value={condition.min_percent}
              onChange={(v) => onChange({ ...condition, min_percent: v })}
              label="Porcentaje de contenido visto"
            />
            %
          </span>
        </>
      )}

      {condition.type === "exam_average" && (
        <>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <FileQuestion className="size-5" aria-hidden />
          </span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Promedio de exámenes
            <HelpTip topic="rules.examAverage" value={{ min: helpPercent(condition.min_percent, 80) }} />
          </span>
          <span className="flex items-center gap-1.5 text-sm">
            mínimo
            <PercentInput
              value={condition.min_percent}
              onChange={(v) => onChange({ ...condition, min_percent: v })}
              label="Promedio mínimo de exámenes"
            />
            %
          </span>
          <div className="basis-full pl-12">
            <RadioGroup
              value={condition.scope === "all" ? "all" : "some"}
              onValueChange={(v) =>
                onChange({ ...condition, scope: v === "all" ? "all" : [] })
              }
              className="flex flex-wrap gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="all" /> Todos los exámenes
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="some" /> Elegir…
              </label>
            </RadioGroup>
            {condition.scope !== "all" && (
              <ul className="mt-2 grid gap-1.5">
                {examOptions.map((exam) => {
                  const scope = condition.scope as string[];
                  const checked = scope.includes(exam.id);
                  return (
                    <li key={exam.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            onChange({
                              ...condition,
                              scope:
                                value === true
                                  ? [...scope, exam.id]
                                  : scope.filter((id) => id !== exam.id),
                            })
                          }
                        />
                        <span className="truncate">{exam.title}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {condition.type === "exam_specific" && (
        <>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <Target className="size-5" aria-hidden />
          </span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Un examen específico
            <HelpTip topic="rules.examSpecific" value={{ min: helpPercent(condition.min_percent, 80) }} />
          </span>
          <Select
            value={condition.item_id || undefined}
            onValueChange={(v) => onChange({ ...condition, item_id: v })}
          >
            <SelectTrigger className="w-56" aria-label="Examen de la condición">
              <SelectValue placeholder="Elige un examen" />
            </SelectTrigger>
            <SelectContent>
              {examOptions.map((exam) => (
                <SelectItem key={exam.id} value={exam.id}>
                  {exam.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="flex items-center gap-1.5 text-sm">
            mínimo
            <PercentInput
              value={condition.min_percent}
              onChange={(v) => onChange({ ...condition, min_percent: v })}
              label="Calificación mínima del examen"
            />
            %
          </span>
        </>
      )}

      {condition.type === "all_items_completed" && (
        <>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <CircleCheck className="size-5" aria-hidden />
          </span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Completar todos los ítems requeridos
            <HelpTip topic="rules.allItems" />
          </span>
          <span className="text-sm text-muted-foreground">
            (documentos, videos, lecturas y exámenes marcados como requeridos)
          </span>
        </>
      )}

      <Button
        size="icon-sm"
        variant="ghost"
        className="ml-auto shrink-0 text-destructive hover:text-destructive"
        aria-label="Quitar condición"
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

function PercentInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <Input
      type="number"
      min={1}
      max={100}
      value={Number.isFinite(value) ? String(value) : ""}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      className="h-8 w-20"
      aria-label={label}
    />
  );
}

/** Porcentaje válido para la ayuda visual mientras se escribe (vacío o fuera de rango → ajustado). */
function helpPercent(n: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : fallback;
}
