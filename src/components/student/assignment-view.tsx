"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  CircleCheck,
  Clock,
  Loader2,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fileIconFor, formatBytes } from "@/lib/file-meta";
import { uploadFile } from "@/lib/upload-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { KindChip } from "@/components/kind-meta";
import { FileDropzone } from "@/components/file-dropzone";
import { RichTextEditor } from "@/components/rich-text-editor";
import { RichContent } from "@/components/rich-content";
import { submitAssignmentAction } from "@/server/actions/student-assignments";
import { parseAllowedTypes, typesLabel } from "@/lib/file-types";
import { DownloadList } from "./download-list";
import type { AssignmentLessonData, SubmissionDto } from "./types";

const MAX_BYTES = 25 * 1024 * 1024; // mismo límite que /api/uploads (submission)
const MAX_FILES = 10;

const DATE_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fmtDate = (ms: number) => DATE_FMT.format(new Date(ms));

/** HTML del editor sin contenido real (solo etiquetas vacías). */
function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

// ─── Badges de estado (léxico §2.6 / §3.1) ───────────────────────────────────

function StatusBadge({ status }: { status: SubmissionDto["status"] }) {
  if (status === "graded") {
    return (
      <Badge className="bg-success/10 text-success">
        <CircleCheck aria-hidden />
        Calificada
      </Badge>
    );
  }
  if (status === "returned") {
    return (
      <Badge className="bg-warning/10 text-warning">
        <RotateCcw aria-hidden />
        Devuelta para corrección
      </Badge>
    );
  }
  return (
    <Badge className="bg-primary/10 text-primary">
      <Clock aria-hidden />
      Entregada — en revisión
    </Badge>
  );
}

function LateBadge() {
  return (
    <Badge className="bg-destructive/10 text-destructive">
      <TriangleAlert aria-hidden />
      Entregada con retraso
    </Badge>
  );
}

/** Card con la entrega: respuesta escrita, archivos, fecha y comentario. */
function SubmissionCard({ submission }: { submission: SubmissionDto }) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">
        Entregada el {fmtDate(submission.submittedAtMs)}
      </p>
      {submission.answerText.trim() && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Tu respuesta</p>
          <RichContent content={submission.answerText} className="text-sm" />
        </div>
      )}
      {submission.files.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {submission.files.length === 1 ? "Archivo entregado" : "Archivos entregados"}
          </p>
          <DownloadList
            files={submission.files.map((f) => ({ ...f, mimeType: "" }))}
            ariaLabel="Archivos de tu entrega"
          />
        </div>
      )}
      {submission.comment.trim() && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="whitespace-pre-line">{submission.comment}</span>
        </p>
      )}
    </div>
  );
}

/** Retroalimentación del maestro en su propia card. */
function FeedbackCard({ feedbackMd }: { feedbackMd: string }) {
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Retroalimentación de tu instructor</h3>
      <RichContent content={feedbackMd} className="text-sm" />
    </div>
  );
}

// ─── Archivos pendientes de la entrega (ya subidos, aún no enviados) ─────────

type PendingFile = {
  localId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  status: "uploading" | "ready" | "error";
  fileId: string | null;
  error?: string;
};

function PendingFileRow({
  file,
  disabled,
  onRemove,
}: {
  file: PendingFile;
  disabled: boolean;
  onRemove: () => void;
}) {
  const Icon = fileIconFor(file.mimeType, file.name);
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-background px-3 py-2",
        file.status === "error" && "border-destructive/40 bg-destructive/5"
      )}
    >
      {file.status === "uploading" ? (
        <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
      ) : file.status === "error" ? (
        <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
      ) : (
        <Icon className="size-5 shrink-0 text-primary" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span
          className={cn(
            "block text-xs",
            file.status === "error" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {file.status === "uploading"
            ? "Subiendo…"
            : file.status === "error"
              ? file.error ?? "No se pudo subir"
              : formatBytes(file.sizeBytes)}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Quitar «${file.name}»`}
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/**
 * Entrega de tarea estilo Teams (DISENO-UX §2.6): instrucciones + material de
 * apoyo del maestro, y formulario con respuesta escrita y/o varios archivos.
 * El servidor valida fechas, política de reentrega y propiedad de archivos.
 */
export function AssignmentView({
  courseId,
  itemId,
  title,
  data,
  onSubmitted,
}: {
  courseId: string;
  itemId: string;
  title: string;
  data: AssignmentLessonData;
  onSubmitted: () => void;
}) {
  const [latest, setLatest] = useState<SubmissionDto | null>(data.latest);
  const [replacing, setReplacing] = useState(false);
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  const allowedTypes = parseAllowedTypes(data.allowedFileTypes);
  const pastDue = data.dueAtMs !== null && data.serverNowMs > data.dueAtMs;
  const closedForLate = pastDue && !data.allowLate;

  // La zona de entrega se muestra sin entrega previa, al reemplazar o cuando
  // la última fue devuelta para corrección.
  const showForm = latest === null || replacing || latest.status === "returned";

  const readyFiles = pending.filter((p) => p.status === "ready" && p.fileId);
  const uploading = pending.some((p) => p.status === "uploading");
  const hasAnswer = !isBlankHtml(answer);
  const canSubmit = (hasAnswer || readyFiles.length > 0) && !uploading && !sending;

  // ─── Selección, validación y subida inmediata de archivos ─────────────────

  const addFiles = (picked: File[]) => {
    const room = MAX_FILES - pending.length;
    if (room <= 0) {
      toast.error(`Máximo ${MAX_FILES} archivos por entrega.`);
      return;
    }
    if (picked.length > room) {
      toast.error(`Solo puedes agregar ${room} ${room === 1 ? "archivo más" : "archivos más"}.`);
    }
    for (const candidate of picked.slice(0, room)) {
      if (allowedTypes.length > 0) {
        const ext = candidate.name.split(".").pop()?.toLowerCase() ?? "";
        if (!allowedTypes.includes(ext)) {
          toast.error(
            `«${candidate.name}» no se acepta en esta tarea. Sube un archivo ${typesLabel(allowedTypes)}.`
          );
          continue;
        }
      }
      if (candidate.size > MAX_BYTES) {
        toast.error(`«${candidate.name}» pesa más de 25 MB. Reduce su tamaño e intenta de nuevo.`);
        continue;
      }
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPending((prev) => [
        ...prev,
        {
          localId,
          name: candidate.name,
          sizeBytes: candidate.size,
          mimeType: candidate.type,
          status: "uploading",
          fileId: null,
        },
      ]);
      void uploadFile(candidate, "submission")
        .then((fileId) =>
          setPending((prev) =>
            prev.map((p) => (p.localId === localId ? { ...p, status: "ready", fileId } : p))
          )
        )
        .catch((err: unknown) =>
          setPending((prev) =>
            prev.map((p) =>
              p.localId === localId
                ? {
                    ...p,
                    status: "error",
                    error: err instanceof Error ? err.message : "No se pudo subir",
                  }
                : p
            )
          )
        );
    }
  };

  const removePending = (localId: string) =>
    setPending((prev) => prev.filter((p) => p.localId !== localId));

  const resetForm = () => {
    setAnswer("");
    setPending([]);
    setComment("");
  };

  // ─── Entregar ─────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!hasAnswer && readyFiles.length === 0) {
      toast.error("Escribe una respuesta o adjunta al menos un archivo.");
      return;
    }
    setSending(true);
    try {
      const res = await submitAssignmentAction({
        courseId,
        itemId,
        fileIds: readyFiles.map((f) => f.fileId!),
        answerText: hasAnswer ? answer : undefined,
        comment: comment.trim() || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setLatest(res.submission);
      setReplacing(false);
      resetForm();
      toast.success("Tarea entregada");
      onSubmitted();
    } catch {
      toast.error("No se pudo entregar la tarea. Revisa tu conexión con el servidor.");
    } finally {
      setSending(false);
    }
  };

  const formDisabled = closedForLate || sending;

  return (
    <div className="h-full overflow-auto">
      <div className="anim-rise mx-auto max-w-2xl space-y-6 p-6 md:p-8">
        {/* ─── Encabezado ──────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <h2 className="flex items-center gap-3 font-heading text-xl font-semibold">
            <KindChip kind="assignment" size="lg" />
            {title}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {data.dueAtMs !== null ? (
              <span className={cn("flex items-center gap-1", pastDue && "text-destructive")}>
                <CalendarClock className="size-3.5" aria-hidden />
                Entrega: {fmtDate(data.dueAtMs)}
              </span>
            ) : (
              <span>Sin fecha límite</span>
            )}
            <span aria-hidden>·</span>
            <span>{data.maxScore} pts</span>
          </p>
        </div>

        {/* ─── Instrucciones ───────────────────────────────────────────────── */}
        {data.instructionsMd.trim() && (
          <div className="rounded-xl border bg-card p-4">
            <RichContent content={data.instructionsMd} />
          </div>
        )}

        {/* ─── Material de apoyo ───────────────────────────────────────────── */}
        {data.attachments.length > 0 && (
          <section aria-labelledby="material-titulo" className="space-y-2">
            <h3
              id="material-titulo"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <Paperclip className="size-4 text-muted-foreground" aria-hidden />
              Material de apoyo
            </h3>
            <DownloadList files={data.attachments} ariaLabel="Material de apoyo" />
          </section>
        )}

        {/* ─── Tu entrega ──────────────────────────────────────────────────── */}
        <section aria-labelledby="entrega-titulo" className="space-y-4">
          <h3 id="entrega-titulo" className="font-heading text-lg font-semibold">
            Tu entrega
          </h3>

          {/* Calificada: score grande + feedback */}
          {latest && latest.status === "graded" && (
            <div className="space-y-4">
              <div className="space-y-3 rounded-xl border bg-card p-6 text-center">
                <p className="font-heading text-4xl font-semibold">
                  {latest.score ?? "—"}
                  <span className="text-xl font-normal text-muted-foreground">
                    {" "}
                    / {data.maxScore}
                  </span>
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <StatusBadge status="graded" />
                  {latest.isLate && <LateBadge />}
                </div>
              </div>
              {latest.feedbackMd?.trim() && <FeedbackCard feedbackMd={latest.feedbackMd} />}
              <SubmissionCard submission={latest} />
            </div>
          )}

          {/* Devuelta: aviso ámbar + feedback + re-entrega activa (abajo) */}
          {latest && latest.status === "returned" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status="returned" />
                {latest.isLate && <LateBadge />}
              </div>
              {latest.feedbackMd?.trim() && <FeedbackCard feedbackMd={latest.feedbackMd} />}
              <SubmissionCard submission={latest} />
              <p className="text-sm text-muted-foreground">
                Corrige tu trabajo y vuelve a entregarlo aquí abajo.
              </p>
            </div>
          )}

          {/* Entregada — en revisión */}
          {latest && latest.status === "submitted" && !replacing && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status="submitted" />
                {latest.isLate && <LateBadge />}
              </div>
              <SubmissionCard submission={latest} />
              {data.allowResubmission && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="h-11">
                      <RotateCcw aria-hidden />
                      Reemplazar entrega
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogMedia>
                        <RotateCcw aria-hidden />
                      </AlertDialogMedia>
                      <AlertDialogTitle>¿Reemplazar tu entrega?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Harás una entrega nueva que sustituirá a la anterior. Tu
                        instructor calificará la entrega más reciente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => setReplacing(true)}>
                        Sí, reemplazar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}

          {/* Formulario de entrega / re-entrega */}
          {showForm && (
            <div className="space-y-4">
              {closedForLate ? (
                <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  La fecha de entrega ya pasó y esta tarea no acepta entregas
                  tardías.
                </p>
              ) : pastDue ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  La fecha de entrega ya pasó: si entregas ahora, tu tarea se
                  marcará como entregada con retraso.
                </p>
              ) : null}

              {/* Respuesta escrita */}
              <div className="space-y-2">
                <Label htmlFor="entrega-respuesta">Tu respuesta</Label>
                <RichTextEditor
                  id="entrega-respuesta"
                  value={answer}
                  onChange={setAnswer}
                  compact
                  minHeight={140}
                  allowImages={false}
                  placeholder="Escribe aquí tu respuesta, o adjunta archivos abajo…"
                />
              </div>

              {/* Archivos */}
              <div className="space-y-2">
                <Label>
                  Archivos{" "}
                  <span className="font-normal text-muted-foreground">
                    ({pending.length}/{MAX_FILES})
                  </span>
                </Label>
                {pending.length > 0 && (
                  <ul className="space-y-2">
                    {pending.map((p) => (
                      <PendingFileRow
                        key={p.localId}
                        file={p}
                        disabled={sending}
                        onRemove={() => removePending(p.localId)}
                      />
                    ))}
                  </ul>
                )}
                {pending.length < MAX_FILES && (
                  <FileDropzone
                    compact
                    accept={data.allowedFileTypes || undefined}
                    disabled={formDisabled}
                    onFiles={addFiles}
                    label="Arrastra tus archivos aquí"
                    hint={`${typesLabel(allowedTypes)} · máx 25 MB c/u · hasta ${MAX_FILES} archivos`}
                  />
                )}
              </div>

              {/* Comentario opcional */}
              <div className="space-y-2">
                <Label htmlFor="entrega-comentario">Comentario (opcional)</Label>
                <Textarea
                  id="entrega-comentario"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={formDisabled}
                  placeholder="Algo que quieras decirle a tu instructor sobre esta entrega"
                  className="min-h-20 text-base"
                  maxLength={1000}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit || formDisabled}
                  className="h-11 min-w-40 bg-cta text-cta-foreground hover:bg-cta/90"
                >
                  {sending && (
                    <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                  )}
                  {sending ? "Entregando…" : uploading ? "Subiendo archivos…" : "Entregar"}
                </Button>
                {!hasAnswer && readyFiles.length === 0 && !formDisabled && (
                  <p className="text-xs text-muted-foreground">
                    Escribe una respuesta o adjunta al menos un archivo.
                  </p>
                )}
                {replacing && (
                  <Button
                    variant="ghost"
                    className="h-11"
                    disabled={sending}
                    onClick={() => {
                      setReplacing(false);
                      resetForm();
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
