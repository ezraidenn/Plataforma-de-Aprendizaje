"use client";

import { useState, useTransition } from "react";
import {
  ArrowRight,
  Download,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareText,
  Paperclip,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fileIconFor, formatBytes } from "@/lib/file-meta";
import { RichContent } from "@/components/rich-content";
import { PdfPreview } from "@/components/pdf-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  gradeSubmissionAction,
  type SubmissionGradingDetail,
} from "@/server/actions/teacher-grading";
import { formatDateTime, formatRelative, gradeSavedMessage } from "@/components/teach/format";
import type { GradingMode } from "./exam-grading-panel";

export function AssignmentGradingPanel({
  detail,
  mode = "grade",
  onDone,
}: {
  detail: SubmissionGradingDetail;
  /** «regrade» al abrir desde Calificadas: el botón guarda la corrección. */
  mode?: GradingMode;
  onDone: (outcome: { message: string; warning?: string }) => void;
}) {
  const [score, setScore] = useState(detail.score === null ? "" : String(detail.score));
  const [feedback, setFeedback] = useState(detail.feedbackMd ?? "");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function grade() {
    setScoreError(null);
    const raw = score.trim();
    const points = Number(raw);
    if (raw === "" || !Number.isFinite(points) || points < 0 || points > detail.maxScore) {
      setScoreError(`Captura puntos entre 0 y ${detail.maxScore}`);
      return;
    }
    startSaving(async () => {
      const result = await gradeSubmissionAction({
        submissionId: detail.submissionId,
        score: points,
        feedbackMd: feedback,
        action: "grade",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onDone({
        message: gradeSavedMessage(result, "Calificación publicada"),
        warning: result.warning,
      });
    });
  }

  function returnForCorrection() {
    startSaving(async () => {
      const result = await gradeSubmissionAction({
        submissionId: detail.submissionId,
        score: 0,
        feedbackMd: feedback,
        action: "return",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onDone({ message: "Entrega devuelta para corrección" });
    });
  }

  const isImage = (n: string) => /\.(png|jpe?g|webp|gif)$/i.test(n);
  const viewable = detail.files.filter((f) => f.isPdf || isImage(f.name));
  // Colapsada por defecto: solo se despliega al pulsar "Ver"
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = viewable.find((f) => f.fileId === previewId) ?? null;
  const hasAnswer = detail.answerText.replace(/<[^>]*>/g, "").trim() !== "";

  return (
    <div className="anim-rise space-y-4 rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <div className="space-y-2">
        <h2 className="font-heading text-xl font-semibold">{detail.studentName}</h2>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex max-w-64 items-center gap-1 rounded-full bg-kind-assignment-tint px-2.5 py-0.5 font-medium text-kind-assignment-strong">
            <span className="truncate">Tarea: {detail.itemTitle}</span>
          </span>
          <span className="inline-flex max-w-64 items-center rounded-full border bg-secondary/60 px-2.5 py-0.5 text-muted-foreground">
            <span className="truncate">{detail.courseTitle}</span>
          </span>
          <span
            className="inline-flex items-center rounded-full border bg-secondary/60 px-2.5 py-0.5 text-muted-foreground"
            suppressHydrationWarning
          >
            entregada {formatDateTime(new Date(detail.submittedAtMs))} (
            {formatRelative(detail.submittedAtMs)})
          </span>
          {detail.isLate && (
            <Badge variant="destructive" className="shrink-0">
              Tardía
            </Badge>
          )}
        </div>
        {detail.isLate && detail.dueAtMs !== null && (
          <p className="mt-0.5 text-xs text-destructive">
            La fecha límite era {formatDateTime(new Date(detail.dueAtMs))}.
          </p>
        )}
      </div>

      {/* Respuesta escrita del alumno */}
      {hasAnswer && (
        <div className="rounded-xl border p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Respuesta del alumno</p>
          <RichContent content={detail.answerText} className="text-sm" />
        </div>
      )}

      {/* Archivos entregados */}
      {detail.files.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {detail.files.map((f) => {
            const Icon = fileIconFor("", f.name);
            return (
              <li key={f.fileId} className="flex items-center gap-3 px-3 py-2">
                <Icon className="size-5 shrink-0 text-section-strong" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatBytes(f.sizeBytes)}
                  </span>
                </span>
                {(f.isPdf || isImage(f.name)) && (
                  <Button
                    type="button"
                    size="sm"
                    variant={previewId === f.fileId ? "default" : "outline"}
                    className="shrink-0"
                    aria-expanded={previewId === f.fileId}
                    onClick={() => setPreviewId((cur) => (cur === f.fileId ? null : f.fileId))}
                  >
                    {previewId === f.fileId ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    {previewId === f.fileId ? "Ocultar" : "Ver"}
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost" className="shrink-0" title="Descargar">
                  <a href={`/api/files/${f.fileId}?download=1`} download={f.name}>
                    <Download aria-hidden />
                    <span className="sr-only">Descargar</span>
                  </a>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {!hasAnswer && detail.files.length === 0 && (
        <p className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Paperclip className="size-4" aria-hidden />
          Esta entrega no tiene texto ni archivos.
        </p>
      )}

      {preview && preview.isPdf && (
        <PdfPreview url={`/api/files/${preview.fileId}`} maxHeight={620} />
      )}
      {preview && !preview.isPdf && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${preview.fileId}`}
          alt={preview.name}
          className="max-h-[560px] w-full rounded-xl border bg-muted/30 object-contain"
        />
      )}

      {/* Comentario del alumno */}
      {detail.comment.trim() && (
        <div className="rounded-xl border bg-muted/40 p-3 text-sm">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MessageSquareText className="size-3.5" aria-hidden />
            Comentario de {detail.studentName}
          </p>
          <p className="whitespace-pre-wrap">{detail.comment}</p>
        </div>
      )}

      {/* Calificación */}
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor="submission-score">Puntos</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="submission-score"
              type="number"
              min={0}
              max={detail.maxScore}
              step="any"
              value={score}
              onChange={(e) => {
                setScore(e.target.value);
                setScoreError(null);
              }}
              className={cn("w-24", scoreError && "border-destructive")}
              aria-invalid={scoreError ? true : undefined}
            />
            <span className="text-sm text-muted-foreground">/{detail.maxScore}</span>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="submission-feedback">Retroalimentación (opcional)</Label>
          <Textarea
            id="submission-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="El estudiante la verá con su calificación…"
          />
        </div>
      </div>
      {scoreError && (
        <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {scoreError}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="h-11" disabled={saving}>
              <Undo2 aria-hidden />
              Devolver para corrección
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                ¿Devolver la entrega de {detail.studentName}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                La tarea regresará al estudiante sin calificación para que suba una nueva
                versión. Se le enviará tu retroalimentación tal como está escrita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={returnForCorrection}>Devolver</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button
          onClick={grade}
          disabled={saving}
          className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {saving ? "Guardando…" : mode === "regrade" ? "Guardar corrección" : "Calificar y siguiente"}
          {!saving && mode === "grade" && <ArrowRight aria-hidden />}
        </Button>
      </div>
    </div>
  );
}
