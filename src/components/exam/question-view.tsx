"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OrderingControl } from "@/components/student/ordering-control";
import type { RunnerQuestion } from "@/components/student/types";

/**
 * Una pregunta tal como la ve el alumno: enunciado, puntos y el control de su
 * tipo. La comparten el examen real (ExamRunner) y la vista previa «Ver como
 * alumno», para que la vista previa sea idéntica.
 */

/** Negritas **así** sin dependencias; el resto se muestra tal cual. */
export function renderBold(text: string): React.ReactNode[] {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>));
}

export type AnswerState = { selectedOptionIds: string[]; answerText: string };

export const EMPTY_ANSWER: AnswerState = { selectedOptionIds: [], answerText: "" };

/** Valores: token opaco (formato nuevo) o índice numérico (intentos viejos). */
export function parseMatching(text: string): Record<string, string | number> {
  try {
    const parsed = JSON.parse(text || "{}") as Record<string, string | number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** «Ordenar pasos»: lista de tokens en el orden del alumno. */
export function parseOrdering(text: string): string[] {
  try {
    const parsed = JSON.parse(text || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function isAnswered(q: RunnerQuestion, a: AnswerState | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case "single_choice":
    case "true_false":
    case "multiple_choice":
      return a.selectedOptionIds.length > 0;
    case "short_text":
    case "open_text":
      return a.answerText.trim().length > 0;
    case "matching": {
      const total = q.matching?.lefts.length ?? 0;
      if (total === 0) return false;
      const map = parseMatching(a.answerText);
      return q.matching!.lefts.every((_, i) => {
        const v = map[String(i)];
        return typeof v === "string" || typeof v === "number";
      });
    }
    case "ordering":
      // Cuenta como respondida cuando el alumno ya movió algo
      return parseOrdering(a.answerText).length === (q.ordering?.steps.length ?? -1);
    case "image_drag":
    case "image_click":
      // Las preguntas sobre imagen llegan con su propio control, que dirá cuándo están completas
      return false;
  }
}

export function QuestionControls({
  q,
  answer,
  onChange,
}: {
  q: RunnerQuestion;
  answer: AnswerState;
  onChange: (patch: Partial<AnswerState>) => void;
}) {
  switch (q.type) {
    case "single_choice":
    case "true_false":
      return (
        <RadioGroup
          value={answer.selectedOptionIds[0] ?? ""}
          onValueChange={(v) => onChange({ selectedOptionIds: [v] })}
          className="gap-2"
        >
          {q.options.map((o) => (
            <Label
              key={o.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-base font-normal transition-colors duration-150 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem value={o.id} />
              <span>{renderBold(o.text)}</span>
            </Label>
          ))}
        </RadioGroup>
      );

    case "multiple_choice":
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Elige todas las que apliquen.</p>
          {q.options.map((o) => {
            const checked = answer.selectedOptionIds.includes(o.id);
            return (
              <Label
                key={o.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-base font-normal transition-colors duration-150 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) =>
                    onChange({
                      selectedOptionIds:
                        c === true
                          ? [...answer.selectedOptionIds, o.id]
                          : answer.selectedOptionIds.filter((id) => id !== o.id),
                    })
                  }
                />
                <span>{renderBold(o.text)}</span>
              </Label>
            );
          })}
        </div>
      );

    case "short_text":
      return (
        <div className="max-w-md space-y-2">
          <Label htmlFor={`respuesta-${q.id}`}>Tu respuesta</Label>
          <Input
            id={`respuesta-${q.id}`}
            value={answer.answerText}
            onChange={(e) => onChange({ answerText: e.target.value })}
            autoComplete="off"
            className="text-base"
          />
        </div>
      );

    case "open_text":
      return (
        <div className="space-y-2">
          <Label htmlFor={`respuesta-${q.id}`}>Tu respuesta</Label>
          <Textarea
            id={`respuesta-${q.id}`}
            rows={6}
            value={answer.answerText}
            onChange={(e) => onChange({ answerText: e.target.value })}
            className="text-base"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Esta pregunta la calificará tu instructor.
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {answer.answerText.length} caracteres
            </p>
          </div>
        </div>
      );

    case "matching": {
      const map = parseMatching(answer.answerText);
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Relaciona cada elemento con su pareja.
          </p>
          {q.matching?.lefts.map((left, li) => {
            const v = map[String(li)];
            return (
              <div
                key={li}
                className="flex flex-col gap-1.5 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="min-w-0 flex-1 font-medium">{renderBold(left)}</span>
                <Select
                  value={typeof v === "string" ? v : ""}
                  onValueChange={(token) =>
                    onChange({
                      answerText: JSON.stringify({ ...map, [String(li)]: token }),
                    })
                  }
                >
                  <SelectTrigger
                    className="w-full sm:w-64"
                    aria-label={`Pareja para ${left}`}
                  >
                    <SelectValue placeholder="Elige…" />
                  </SelectTrigger>
                  <SelectContent>
                    {q.matching?.rights.map((r) => (
                      <SelectItem key={r.token} value={r.token}>
                        {r.text}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      );
    }

    case "ordering":
      return (
        <OrderingControl
          steps={q.ordering?.steps ?? []}
          order={parseOrdering(answer.answerText)}
          onChange={(order) => onChange({ answerText: JSON.stringify(order) })}
        />
      );
  }
}

/** Enunciado, puntos y control: el cuerpo de una pregunta del examen. */
export function QuestionCard({
  q,
  answer,
  onChange,
}: {
  q: RunnerQuestion;
  answer: AnswerState;
  onChange: (patch: Partial<AnswerState>) => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 font-heading text-lg font-semibold">
          {renderBold(q.promptMd)}
        </h3>
        <span className="shrink-0 text-sm text-muted-foreground">
          ({q.points} {q.points === 1 ? "pt" : "pts"})
        </span>
      </div>
      <QuestionControls key={q.id} q={q} answer={answer} onChange={onChange} />
    </>
  );
}
