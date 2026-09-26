"use client";

import { useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PreviewQuestion } from "@/lib/preview-question";
import { AnswerReview } from "./answer-review";
import { ImageSolution } from "./image-review";
import { EMPTY_ANSWER, QuestionCard, isAnswered, type AnswerState } from "./question-view";

/**
 * «Ver como alumno»: el examen con los MISMOS componentes que ve el alumno,
 * pero todo local. Se puede pasar sin responder, elegir, escribir, relacionar,
 * ordenar, colocar y señalar; no hay reloj, no se guarda nada y nada se
 * califica. El maestro puede encender «Mostrar respuestas correctas» para
 * revisar la clave (en las preguntas sobre imagen, de clasificar y de
 * completar, dibujada).
 */
export function ExamPreview({
  questions,
  onClose,
}: {
  questions: PreviewQuestion[];
  onClose?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [showAnswers, setShowAnswers] = useState(false);

  const total = questions.length;
  if (total === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No hay preguntas para mostrar.
      </p>
    );
  }
  const q = questions[Math.min(index, total - 1)];
  const answer = answers[q.id] ?? EMPTY_ANSWER;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background">
      {/* Aviso: es una vista previa */}
      <p className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-[13px] font-medium text-amber-900">
        <Eye className="size-4 shrink-0" aria-hidden />
        Vista previa: nada se guarda ni se califica.
      </p>

      {/* Encabezado: posición y respuestas correctas */}
      <div className="space-y-2 border-b bg-card px-4 py-2">
        {/* En pantallas angostas el interruptor baja de línea en vez de cortar «Pregunta N de M» */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="font-heading text-sm font-semibold whitespace-nowrap">
            Pregunta {index + 1} de {total}
          </p>
          <div className="flex items-center gap-2">
            <Switch id="preview-answers" checked={showAnswers} onCheckedChange={setShowAnswers} />
            <Label htmlFor="preview-answers" className="text-[13px] font-normal">
              Mostrar respuestas correctas
            </Label>
          </div>
        </div>
        <div className="flex gap-px" role="group" aria-label="Ir a una pregunta">
          {questions.map((qq, i) => {
            const done = isAnswered(qq, answers[qq.id]);
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Pregunta ${i + 1}${done ? " — respondida" : " — sin responder"}`}
                aria-current={i === index ? "true" : undefined}
                className="group flex h-6 min-w-0 flex-1 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors duration-200",
                    done ? "bg-progress-ring" : "bg-muted",
                    i === index && "outline outline-2 outline-offset-1 outline-primary"
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Pregunta actual */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div key={q.id} className="anim-pop mx-auto max-w-2xl space-y-5 p-6 md:p-8">
          <QuestionCard
            q={q}
            answer={answer}
            onChange={(patch) => setAnswers((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] ?? EMPTY_ANSWER), ...patch } }))}
          />
          {showAnswers &&
            (q.solution ? (
              // Preguntas sobre imagen: la solución se dibuja
              <div
                data-preview-answer
                className="space-y-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"
              >
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                  <b>Respuesta correcta:</b>
                </p>
                <ImageSolution board={q.solution} />
              </div>
            ) : q.answerBoard ? (
              // Clasificar y completar: cada tarjeta en su grupo, cada hueco con su respuesta
              <div
                data-preview-answer
                className="space-y-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"
              >
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                  <b>Respuesta correcta:</b>
                </p>
                <div className="rounded-md bg-card p-2 text-foreground">
                  <AnswerReview board={q.answerBoard} solution />
                </div>
              </div>
            ) : (
              <p
                data-preview-answer
                className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <b>Respuesta correcta:</b>{" "}
                  {q.answerText ?? "La califica el instructor (pregunta abierta)."}
                </span>
              </p>
            ))}
        </div>
      </div>

      {/* Navegación: libre, sin exigir respuesta */}
      <div className="flex items-center justify-between gap-3 border-t bg-card px-4 py-2">
        <Button
          variant="outline"
          className="h-11 min-w-28"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft aria-hidden />
          Anterior
        </Button>
        {index < total - 1 ? (
          <Button
            className="h-11 min-w-28"
            variant="outline"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            Siguiente
            <ChevronRight aria-hidden />
          </Button>
        ) : onClose ? (
          <Button className="h-11 min-w-28" onClick={onClose}>
            Cerrar vista previa
          </Button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
