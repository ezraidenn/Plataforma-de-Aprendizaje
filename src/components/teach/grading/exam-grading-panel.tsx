"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Check, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  gradeExamAnswersAction,
  type ExamGradingDetail,
} from "@/server/actions/teacher-grading";
import { formatRelative } from "@/components/teach/format";

type GradeState = { points: string; feedback: string };

export function ExamGradingPanel({
  detail,
  onDone,
}: {
  detail: ExamGradingDetail;
  onDone: (message: string) => void;
}) {
  const [grades, setGrades] = useState<Record<string, GradeState>>(() =>
    Object.fromEntries(
      detail.openAnswers.map((o) => [
        o.questionId,
        {
          points: o.manualPoints === null ? "" : String(o.manualPoints),
          feedback: o.feedbackMd ?? "",
        },
      ])
    )
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [autoOpen, setAutoOpen] = useState(false);
  const [saving, startSaving] = useTransition();

  function setGrade(questionId: string, patch: Partial<GradeState>) {
    setGrades((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));
    setErrors((prev) => {
      if (!prev[questionId]) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }

  function submit() {
    const nextErrors: Record<string, string> = {};
    const payload: { questionId: string; points: number; feedbackMd: string }[] = [];

    for (const open of detail.openAnswers) {
      const state = grades[open.questionId] ?? { points: "", feedback: "" };
      const raw = state.points.trim();
      const points = Number(raw);
      if (raw === "" || !Number.isFinite(points) || points < 0 || points > open.maxPoints) {
        nextErrors[open.questionId] = `Captura puntos entre 0 y ${open.maxPoints}`;
        continue;
      }
      payload.push({ questionId: open.questionId, points, feedbackMd: state.feedback });
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    startSaving(async () => {
      const result = await gradeExamAnswersAction({
        attemptId: detail.attemptId,
        grades: payload,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onDone(result.finalized ? "Calificación publicada" : "Calificación guardada");
    });
  }

  return (
    <div className="anim-rise space-y-4 rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <div className="space-y-2">
        <h2 className="font-heading text-xl font-semibold">{detail.studentName}</h2>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex max-w-64 items-center gap-1 rounded-full bg-kind-exam-tint px-2.5 py-0.5 font-medium text-kind-exam-strong">
            <span className="truncate">{detail.itemTitle}</span>
          </span>
          <span className="inline-flex items-center rounded-full border bg-secondary/60 px-2.5 py-0.5 text-muted-foreground">
            Intento {detail.attemptNumber}
          </span>
          <span className="inline-flex max-w-64 items-center rounded-full border bg-secondary/60 px-2.5 py-0.5 text-muted-foreground">
            <span className="truncate">{detail.courseTitle}</span>
          </span>
          {detail.submittedAtMs !== null && (
            <span
              className="inline-flex items-center rounded-full border bg-secondary/60 px-2.5 py-0.5 text-muted-foreground"
              suppressHydrationWarning
            >
              enviado {formatRelative(detail.submittedAtMs)}
            </span>
          )}
        </div>
      </div>

      {/* Resumen de la parte automática (colapsado, expandible) */}
      {detail.autoMax > 0 && (
        <div className="rounded-xl border">
          <button
            type="button"
            onClick={() => setAutoOpen((o) => !o)}
            aria-expanded={autoOpen}
            className="flex w-full items-center gap-2 rounded-xl p-3 text-left text-sm transition-colors hover:bg-secondary/40"
          >
            <Check className="size-4 shrink-0 text-success" aria-hidden />
            <span className="flex-1 font-medium">
              Autocalificado: {detail.autoScore}/{detail.autoMax} pts
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                autoOpen && "rotate-180"
              )}
              aria-hidden
            />
          </button>
          {autoOpen && (
            <ul className="space-y-3 border-t p-3">
              {detail.autoAnswers.map((auto, i) => (
                <li key={auto.questionId} className="text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1">
                      <span className="font-medium">P{i + 1}.</span>{" "}
                      <span className="whitespace-pre-wrap">{auto.prompt}</span>
                    </p>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        auto.points >= auto.maxPoints
                          ? "text-success"
                          : auto.points === 0
                            ? "text-destructive"
                            : "text-warning"
                      )}
                    >
                      {auto.points}/{auto.maxPoints} pts
                    </span>
                  </div>
                  <p className="mt-1 rounded-lg bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                    {auto.answerDisplay}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Preguntas abiertas por calificar */}
      {detail.openAnswers.map((open, i) => {
        const state = grades[open.questionId] ?? { points: "", feedback: "" };
        const error = errors[open.questionId];
        return (
          <div key={open.questionId} className="space-y-3">
            {i > 0 && <Separator />}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
                Pregunta abierta · {open.maxPoints} {open.maxPoints === 1 ? "pt" : "pts"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium">{open.prompt}</p>
            </div>

            {open.answerText?.trim() ? (
              <div className="rounded-xl border bg-muted/40 p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Respuesta de {detail.studentName}
                </p>
                <p className="whitespace-pre-wrap">{open.answerText}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-3 text-sm italic text-muted-foreground">
                — Sin respuesta —
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div className="grid gap-1.5">
                <Label htmlFor={`points-${open.questionId}`}>Puntos</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`points-${open.questionId}`}
                    type="number"
                    min={0}
                    max={open.maxPoints}
                    step="any"
                    value={state.points}
                    onChange={(e) => setGrade(open.questionId, { points: e.target.value })}
                    className={cn("w-20", error && "border-destructive")}
                    aria-invalid={error ? true : undefined}
                  />
                  <span className="text-sm text-muted-foreground">/{open.maxPoints}</span>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`feedback-${open.questionId}`}>Retroalimentación (opcional)</Label>
                <Textarea
                  id={`feedback-${open.questionId}`}
                  value={state.feedback}
                  onChange={(e) => setGrade(open.questionId, { feedback: e.target.value })}
                  rows={2}
                  placeholder="El estudiante la verá con su calificación…"
                />
              </div>
            </div>
            {error && (
              <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}
          </div>
        );
      })}

      {detail.openAnswers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Este intento no tiene preguntas abiertas pendientes.
        </p>
      )}

      <div className="flex justify-end pt-1">
        <Button
          onClick={submit}
          disabled={saving || detail.openAnswers.length === 0}
          className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {saving ? "Guardando…" : "Guardar y siguiente"}
          {!saving && <ArrowRight aria-hidden />}
        </Button>
      </div>
    </div>
  );
}
