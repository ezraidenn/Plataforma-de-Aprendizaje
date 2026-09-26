"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, FileQuestion, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createQuestionAction,
  deleteQuestionAction,
  duplicateQuestionAction,
  moveQuestionAction,
  updateQuestionAction,
} from "@/server/actions/teacher-exams";
import { fileUrl } from "@/lib/image-questions";
import { QuestionEditor, TYPE_LABEL, type QuestionData, type QuestionType } from "./question-editor";

const QUESTION_TYPES: QuestionType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_text",
  "matching",
  "ordering",
  "open_text",
  "image_drag",
  "image_click",
];

function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

function excerpt(md: string, max = 80): string {
  const plain = md.replace(/[#*_`>\n]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

// ─── Lista de preguntas ──────────────────────────────────────────────────────

export function QuestionList({
  courseId,
  itemId,
  questions,
  drawCount = null,
  hasAttempts = false,
  answeredInProgress = [],
}: {
  courseId: string;
  itemId: string;
  questions: QuestionData[];
  /** Pool aleatorio activo: preguntas sorteadas por intento (null = todas) */
  drawCount?: number | null;
  /** El examen ya tiene intentos enviados: cambiar, recortar o girar la foto de una pregunta pide confirmación. */
  hasAttempts?: boolean;
  /** Preguntas con respuestas guardadas en intentos en curso: cambiar su foto también pide confirmación. */
  answeredInProgress?: string[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<QuestionType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuestionData | null>(null);
  const [busy, startTransition] = useTransition();

  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  function startDraft(type: QuestionType) {
    setEditingId(null);
    setDraftType(type);
  }

  function run(fn: () => Promise<{ error?: string } | { ok: true }>) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    if (editingId === target.id) setEditingId(null);
    startTransition(async () => {
      const result = await deleteQuestionAction(courseId, itemId, target.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Pregunta eliminada");
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">
          {drawCount
            ? `Preguntas (${questions.length} en el banco · ${drawCount} por intento)`
            : `Preguntas (${questions.length} · ${formatPoints(totalPoints)} pts)`}
        </h2>
        <NewQuestionMenu onPick={startDraft} />
      </div>

      {questions.length === 0 && draftType === null ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-12 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-kind-exam-tint text-kind-exam">
            <FileQuestion className="size-8" aria-hidden />
          </span>
          <p className="max-w-sm text-sm text-muted-foreground">
            Este examen aún no tiene preguntas. Agrega la primera con «Nueva pregunta».
          </p>
          <NewQuestionMenu onPick={startDraft} primary />
        </div>
      ) : (
        <ol className="space-y-2">
          {questions.map((question, index) => (
            <li
              key={question.id}
              className={`anim-rise anim-d${Math.min(index + 1, 5)} rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]`}
            >
              {editingId === question.id ? (
                <QuestionEditor
                  type={question.type}
                  initial={question}
                  answered={hasAttempts ? "attempts" : answeredInProgress.includes(question.id) ? "in_progress" : null}
                  onCancel={() => setEditingId(null)}
                  onSave={async (input) => {
                    const result = await updateQuestionAction(courseId, itemId, question.id, input);
                    if ("error" in result) return result.error;
                    setEditingId(null);
                    toast.success("Pregunta guardada");
                    router.refresh();
                    return null;
                  }}
                />
              ) : (
                <div className="flex items-center gap-2 p-3">
                  <span className="w-6 shrink-0 text-right text-sm font-semibold text-muted-foreground">
                    {index + 1}.
                  </span>
                  {question.imageFileId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(question.imageFileId)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-10 w-14 shrink-0 rounded-md bg-muted object-cover ring-1 ring-border"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDraftType(null);
                      setEditingId(question.id);
                    }}
                    className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition-colors hover:text-section-strong"
                  >
                    <span className="flex items-center gap-1.5">
                      {/* Identidad de examen: tinte + color del tipo "exam" */}
                      <span className="inline-flex shrink-0 items-center rounded-md bg-kind-exam-tint px-1.5 py-0.5 text-[11px] font-medium text-kind-exam-strong">
                        {TYPE_LABEL[question.type]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatPoints(question.points)} {question.points === 1 ? "pt" : "pts"}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm">
                      {excerpt(question.promptMd) || "(sin enunciado)"}
                    </span>
                  </button>

                  {question.type === "open_text" && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      Calificación manual
                    </span>
                  )}

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Editar pregunta ${index + 1}`}
                      disabled={busy}
                      onClick={() => {
                        setDraftType(null);
                        setEditingId(question.id);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Duplicar pregunta ${index + 1}`}
                      disabled={busy}
                      onClick={() => run(() => duplicateQuestionAction(courseId, itemId, question.id))}
                    >
                      <Copy aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Subir pregunta ${index + 1}`}
                      disabled={busy || index === 0}
                      onClick={() => run(() => moveQuestionAction(courseId, itemId, question.id, "up"))}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Bajar pregunta ${index + 1}`}
                      disabled={busy || index === questions.length - 1}
                      onClick={() => run(() => moveQuestionAction(courseId, itemId, question.id, "down"))}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Eliminar pregunta ${index + 1}`}
                      disabled={busy}
                      onClick={() => setDeleteTarget(question)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}

          {draftType !== null && (
            <li className="anim-pop rounded-xl border border-section/40 bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
              <QuestionEditor
                // Otro tipo es otro editor: no hereda el estado del anterior
                key={draftType}
                type={draftType}
                initial={null}
                onCancel={() => setDraftType(null)}
                onSave={async (input) => {
                  const result = await createQuestionAction(courseId, itemId, input);
                  if ("error" in result) return result.error;
                  setDraftType(null);
                  toast.success("Pregunta agregada");
                  router.refresh();
                  return null;
                }}
              />
            </li>
          )}
        </ol>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta pregunta?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `«${excerpt(deleteTarget.promptMd, 60) || "(sin enunciado)"}». ` : ""}
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ─── Menú "+ Nueva pregunta" ─────────────────────────────────────────────────

function NewQuestionMenu({
  onPick,
  primary = true,
}: {
  onPick: (type: QuestionType) => void;
  primary?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            primary && "h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90"
          )}
          variant={primary ? "default" : "outline"}
        >
          <Plus aria-hidden />
          Nueva pregunta
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {QUESTION_TYPES.map((type) => (
          <DropdownMenuItem key={type} onSelect={() => onPick(type)}>
            {TYPE_LABEL[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
