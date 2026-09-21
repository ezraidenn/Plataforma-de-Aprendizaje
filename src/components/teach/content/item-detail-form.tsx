"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Clock,
  FileQuestion,
  FileText,
  Info,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { HelpTip } from "@/components/help/help-tip";
import {
  attachDocumentAction,
  updateDocumentSettingsAction,
  updateItemAction,
  updateTextAction,
} from "@/server/actions/teacher-tree";
import { setVideoLinkAction } from "@/server/actions/teacher-video";
import { updateAssignmentSettingsAction } from "@/server/actions/teacher-assignments";
import {
  addAssignmentAttachmentAction,
  addResourceFileAction,
  removeAssignmentAttachmentAction,
  removeResourceFileAction,
  reorderResourceFilesAction,
  updateLinkAction,
} from "@/server/actions/teacher-resources";
import { LinkSection, isValidHttpUrl, type LinkDetail } from "./link-section";
import { ManagedFilesSection } from "./managed-files-section";
import type { ManagedFile } from "./file-list";

const RESOURCE_MAX_BYTES = 200 * 1024 * 1024;
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

const KIND_LABEL: Record<string, string> = {
  folder: "Carpeta",
  document: "Documento (PPT/PDF)",
  video: "Video",
  text: "Lectura",
  exam: "Examen",
  assignment: "Tarea",
  resource: "Recurso descargable",
  link: "Enlace externo",
};

export type ItemDetail = {
  id: string;
  kind: "folder" | "document" | "video" | "text" | "exam" | "assignment" | "resource" | "link";
  title: string;
  description: string;
  requiredForCompletion: boolean;
  sequenceMode: "inherit" | "required" | "free";
};

export type DocDetail = {
  processingStatus: "pending" | "processing" | "ready" | "error";
  processingError: string | null;
  pageCount: number | null;
  minSecondsPerPage: number;
  hasFile: boolean;
  fileName: string | null;
};

export type TextDetail = {
  contentMd: string;
  minReadSeconds: number;
};

export type VideoDetail = {
  url: string;
  provider: "youtube" | "vimeo" | "other";
  videoId: string | null;
  durationSeconds: number | null;
  allowSpeedUp: boolean;
};

export type ExamSummary = {
  questionCount: number;
  maxScore: number;
};

export type AssignmentDetail = {
  instructionsMd: string;
  /** Material de apoyo que el maestro adjunta para el alumno. */
  attachments: ManagedFile[];
  dueAtMs: number | null;
  maxScore: number;
  allowedFileTypes: string;
  allowResubmission: boolean;
  allowLate: boolean;
};

/** ms UTC → valor de <input type="datetime-local"> en hora local. */
function msToLocalInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Segundos → "m:ss" para el campo de duración. */
function secondsToMinSec(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "m:ss" (o solo minutos) → segundos. null = vacío · NaN = formato inválido. */
function parseMinSec(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{1,3}$/.test(value)) return Number(value) * 60;
  const match = /^(\d{1,3}):([0-5]?\d)$/.exec(value);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function ItemDetailForm({
  courseId,
  item,
  doc,
  text,
  video,
  exam,
  assignment,
  link,
  resourceFiles,
}: {
  courseId: string;
  item: ItemDetail;
  doc: DocDetail | null;
  text: TextDetail | null;
  video: VideoDetail | null;
  exam: ExamSummary | null;
  assignment: AssignmentDetail | null;
  link: LinkDetail | null;
  resourceFiles: ManagedFile[] | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [required, setRequired] = useState(item.requiredForCompletion);
  const [sequenceMode, setSequenceMode] = useState(item.sequenceMode);
  const [minSecondsPerPage, setMinSecondsPerPage] = useState(
    String(doc?.minSecondsPerPage ?? 3)
  );
  const [contentMd, setContentMd] = useState(text?.contentMd ?? "");
  const [minReadSeconds, setMinReadSeconds] = useState(String(text?.minReadSeconds ?? 0));
  const [videoUrl, setVideoUrl] = useState(video?.url ?? "");
  const [videoDuration, setVideoDuration] = useState(secondsToMinSec(video?.durationSeconds ?? null));
  const [allowSpeedUp, setAllowSpeedUp] = useState(video?.allowSpeedUp ?? false);
  const [videoUrlError, setVideoUrlError] = useState<string | null>(null);
  const [videoDurationError, setVideoDurationError] = useState<string | null>(null);
  const [instructionsMd, setInstructionsMd] = useState(assignment?.instructionsMd ?? "");
  const [dueAt, setDueAt] = useState(msToLocalInput(assignment?.dueAtMs ?? null));
  const [maxScore, setMaxScore] = useState(String(assignment?.maxScore ?? 100));
  const [fileTypes, setFileTypes] = useState(assignment?.allowedFileTypes ?? ".pdf,.docx");
  const [allowResubmission, setAllowResubmission] = useState(
    assignment?.allowResubmission ?? true
  );
  const [allowLate, setAllowLate] = useState(assignment?.allowLate ?? true);
  const [maxScoreError, setMaxScoreError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState(link?.url ?? "");
  const [linkDescription, setLinkDescription] = useState(link?.description ?? "");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const isFolder = item.kind === "folder";

  function save() {
    // Validación previa del video (sin viaje al servidor)
    if (item.kind === "video") {
      setVideoUrlError(null);
      setVideoDurationError(null);
      const seconds = parseMinSec(videoDuration);
      if (Number.isNaN(seconds)) {
        setVideoDurationError("Usa el formato min:seg, por ejemplo 12:30");
        return;
      }
    }

    // Validación previa del enlace (vacío se permite mientras se prepara)
    if (item.kind === "link") {
      setLinkError(null);
      if (linkUrl.trim() && !isValidHttpUrl(linkUrl)) {
        setLinkError("La URL debe empezar con http:// o https://");
        return;
      }
    }

    // Validación previa de la tarea
    if (item.kind === "assignment") {
      setMaxScoreError(null);
      const points = Number(maxScore);
      if (!Number.isFinite(points) || points < 1 || points > 1000) {
        setMaxScoreError("Los puntos máximos deben estar entre 1 y 1000");
        return;
      }
    }

    startSaving(async () => {
      const base = await updateItemAction(courseId, item.id, {
        title,
        description,
        ...(isFolder ? {} : { requiredForCompletion: required, sequenceMode }),
      });
      if ("error" in base) {
        toast.error(base.error);
        return;
      }

      if (item.kind === "document") {
        const seconds = Number(minSecondsPerPage);
        const docResult = await updateDocumentSettingsAction(courseId, item.id, {
          minSecondsPerPage: Number.isFinite(seconds) ? seconds : 3,
        });
        if ("error" in docResult) {
          toast.error(docResult.error);
          return;
        }
      }

      if (item.kind === "text") {
        const seconds = Number(minReadSeconds);
        const textResult = await updateTextAction(courseId, item.id, {
          contentMd,
          minReadSeconds: Number.isFinite(seconds) ? seconds : 0,
        });
        if ("error" in textResult) {
          toast.error(textResult.error);
          return;
        }
      }

      if (item.kind === "video" && videoUrl.trim()) {
        const seconds = parseMinSec(videoDuration);
        const videoResult = await setVideoLinkAction(courseId, item.id, {
          url: videoUrl,
          durationSeconds: Number.isNaN(seconds) ? null : seconds,
          allowSpeedUp,
        });
        if ("error" in videoResult) {
          setVideoUrlError(videoResult.error);
          return;
        }
      }

      if (item.kind === "assignment") {
        const assignmentResult = await updateAssignmentSettingsAction(courseId, item.id, {
          instructionsMd,
          dueAtMs: localInputToMs(dueAt),
          maxScore: Number(maxScore),
          allowedFileTypes: fileTypes,
          allowResubmission,
          allowLate,
        });
        if ("error" in assignmentResult) {
          toast.error(assignmentResult.error);
          return;
        }
      }

      if (item.kind === "link") {
        const linkResult = await updateLinkAction(courseId, item.id, {
          url: linkUrl,
          description: linkDescription,
        });
        if ("error" in linkResult) {
          setLinkError(linkResult.error);
          return;
        }
      }

      toast.success("Cambios guardados");
      router.refresh();
    });
  }

  return (
    <div className="anim-rise flex flex-col gap-5 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
          {KIND_LABEL[item.kind]}
        </p>
        <h2 className="mt-1 truncate font-heading text-lg font-semibold">{item.title}</h2>
      </div>

      {item.kind === "document" && doc && <DocumentSection courseId={courseId} itemId={item.id} doc={doc} />}

      <Separator />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
        Información
      </p>

      <div className="grid gap-2">
        <Label htmlFor="item-title">Título</Label>
        <Input
          id="item-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="item-description">Descripción (opcional)</Label>
        <Textarea
          id="item-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Se muestra al estudiante debajo del título"
        />
      </div>

      {item.kind === "text" && (
        <>
          <Separator />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
            Lectura
          </p>
          <div className="grid gap-2">
            <Label htmlFor="item-content">Contenido de la lectura</Label>
            <RichTextEditor
              key={item.id}
              id="item-content"
              value={contentMd}
              onChange={setContentMd}
              minHeight={280}
              placeholder="Escribe la lectura con formato: usa la barra para negritas, títulos y listas…"
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="item-min-read">Segundos mínimos de lectura</Label>
              <HelpTip
                topic="content.textSeconds"
                value={{ seconds: Math.max(0, Math.min(86400, Number(minReadSeconds) || 0)) }}
              />
            </div>
            <Input
              id="item-min-read"
              type="number"
              min={0}
              max={86400}
              value={minReadSeconds}
              onChange={(e) => setMinReadSeconds(e.target.value)}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              La lectura se marca completa cuando el estudiante permanece este tiempo. 0 = sin
              mínimo.
            </p>
          </div>
        </>
      )}

      {item.kind === "document" && (
        <div className="grid gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="item-min-seconds">Segundos mínimos por página</Label>
            <HelpTip
              topic="content.docSeconds"
              value={{ seconds: Math.max(0, Math.min(600, Number(minSecondsPerPage) || 0)) }}
            />
          </div>
          <Input
            id="item-min-seconds"
            type="number"
            min={0}
            max={600}
            value={minSecondsPerPage}
            onChange={(e) => setMinSecondsPerPage(e.target.value)}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Cada página se acredita cuando el estudiante permanece en ella este tiempo.
          </p>
        </div>
      )}

      {item.kind === "video" && (
        <>
          <Separator />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
            Video
          </p>
          <div className="grid gap-2">
            <Label htmlFor="video-url">Enlace del video (YouTube o Vimeo)</Label>
            <Input
              id="video-url"
              type="url"
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value);
                setVideoUrlError(null);
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              aria-invalid={videoUrlError ? true : undefined}
              className={cn(videoUrlError && "border-destructive")}
            />
            {videoUrlError && (
              <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {videoUrlError}
              </p>
            )}
          </div>

          {video?.videoId && (video.provider === "youtube" || video.provider === "vimeo") && (
            <div className="overflow-hidden rounded-xl border">
              <iframe
                src={
                  video.provider === "youtube"
                    ? `https://www.youtube-nocookie.com/embed/${video.videoId}`
                    : `https://player.vimeo.com/video/${video.videoId}`
                }
                title="Vista previa del video"
                className="aspect-video w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-section/30 bg-section-soft/60 p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-section-strong" aria-hidden />
            <p>
              El tracking completo funciona con YouTube; Vimeo puede requerir que el estudiante
              tenga acceso al video.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="video-duration">Duración (min:seg)</Label>
            <Input
              id="video-duration"
              value={videoDuration}
              onChange={(e) => {
                setVideoDuration(e.target.value);
                setVideoDurationError(null);
              }}
              placeholder="12:30"
              className={cn("w-32", videoDurationError && "border-destructive")}
              aria-invalid={videoDurationError ? true : undefined}
            />
            {videoDurationError ? (
              <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {videoDurationError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Si la dejas vacía, el player del estudiante la detecta al primer load.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="video-speed">Permitir velocidad hasta 2x</Label>
                <HelpTip topic="content.videoSpeed" value={{ allowed: allowSpeedUp }} />
              </div>
              <p className="text-xs text-muted-foreground">
                El estudiante podrá acelerar la reproducción sin perder acreditación.
              </p>
            </div>
            <Switch id="video-speed" checked={allowSpeedUp} onCheckedChange={setAllowSpeedUp} />
          </div>
        </>
      )}

      {item.kind === "exam" && exam && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-kind-exam/30 bg-kind-exam-tint p-4">
          <FileQuestion className="size-6 shrink-0 text-kind-exam" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {exam.questionCount === 0
                ? "Este examen aún no tiene preguntas"
                : `${exam.questionCount} ${exam.questionCount === 1 ? "pregunta" : "preguntas"} · ${exam.maxScore} pts`}
            </p>
            <p className="text-xs text-muted-foreground">
              Las preguntas y los ajustes (intentos, tiempo, fechas) se editan en su propia
              pantalla.
            </p>
          </div>
          <Button asChild className="h-11 bg-cta px-5 text-cta-foreground hover:bg-cta/90">
            <Link href={`/teach/courses/${courseId}/items/${item.id}/edit`}>
              Editar examen
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      )}

      {item.kind === "link" && (
        <>
          <Separator />
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-section-strong">
            Enlace
            <HelpTip topic="content.resourceLink" value={{ kind: "link" }} />
          </p>
          <LinkSection
            url={linkUrl}
            description={linkDescription}
            error={linkError}
            onUrlChange={(v) => {
              setLinkUrl(v);
              setLinkError(null);
            }}
            onDescriptionChange={setLinkDescription}
          />
        </>
      )}

      {item.kind === "resource" && (
        <>
          <Separator />
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-section-strong">
            Archivos del recurso
            <HelpTip topic="content.resourceLink" value={{ kind: "resource" }} />
          </p>
          <ManagedFilesSection
            key={`res-${item.id}`}
            initialFiles={resourceFiles ?? []}
            uploadKind="resource"
            maxBytes={RESOURCE_MAX_BYTES}
            emptyText="Aún no hay archivos. Sube uno o varios para que el alumno los descargue."
            note="El alumno completa el recurso al descargar cualquier archivo."
            onAdd={(fileId) => addResourceFileAction(courseId, item.id, fileId)}
            onRemove={(entryId) => removeResourceFileAction(courseId, item.id, entryId)}
            onReorder={(ids) => reorderResourceFilesAction(courseId, item.id, ids)}
          />
        </>
      )}

      {item.kind === "assignment" && assignment && (
        <>
          <Separator />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
            Entrega
          </p>
          <div className="grid gap-2">
            <Label htmlFor="assignment-instructions">Instrucciones</Label>
            <RichTextEditor
              key={`asg-${item.id}`}
              id="assignment-instructions"
              value={instructionsMd}
              onChange={setInstructionsMd}
              minHeight={180}
              placeholder="Explica qué debe entregar el estudiante, con formato…"
            />
          </div>

          <div className="grid gap-2">
            <Label>Material de apoyo para el alumno (adjuntos)</Label>
            <p className="text-xs text-muted-foreground">
              Plantillas, rúbricas o lecturas que el alumno podrá descargar junto a las
              instrucciones. Se guardan al instante.
            </p>
            <ManagedFilesSection
              key={`att-${item.id}`}
              initialFiles={assignment.attachments}
              uploadKind="attachment"
              maxBytes={ATTACHMENT_MAX_BYTES}
              emptyText="Sin adjuntos."
              onAdd={(fileId) => addAssignmentAttachmentAction(courseId, item.id, fileId)}
              onRemove={(entryId) => removeAssignmentAttachmentAction(courseId, item.id, entryId)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="assignment-due">Fecha límite (opcional)</Label>
                <HelpTip topic="assignment.late" value={{ hasDue: dueAt.trim() !== "", allowLate }} />
              </div>
              <Input
                id="assignment-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Vacía = sin fecha límite.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assignment-max-score">Puntos máximos</Label>
              <Input
                id="assignment-max-score"
                type="number"
                min={1}
                max={1000}
                value={maxScore}
                onChange={(e) => {
                  setMaxScore(e.target.value);
                  setMaxScoreError(null);
                }}
                className={cn("w-32", maxScoreError && "border-destructive")}
                aria-invalid={maxScoreError ? true : undefined}
              />
              {maxScoreError && (
                <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
                  <TriangleAlert className="size-4 shrink-0" aria-hidden />
                  {maxScoreError}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="assignment-file-types">Tipos de archivo permitidos</Label>
              <HelpTip topic="assignment.fileTypes" value={{ types: fileTypes }} />
            </div>
            <Input
              id="assignment-file-types"
              value={fileTypes}
              onChange={(e) => setFileTypes(e.target.value)}
              placeholder=".pdf,.docx"
              className="w-64"
            />
            <p className="text-xs text-muted-foreground">
              Extensiones separadas por coma. Déjalo vacío para aceptar cualquier archivo.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="assignment-resubmission">Permitir reemplazar entrega</Label>
                <HelpTip topic="assignment.replace" value={{ allowed: allowResubmission }} />
              </div>
              <p className="text-xs text-muted-foreground">
                El estudiante puede volver a subir el archivo mientras no esté calificado.
              </p>
            </div>
            <Switch
              id="assignment-resubmission"
              checked={allowResubmission}
              onCheckedChange={setAllowResubmission}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="assignment-late">Aceptar entregas tardías</Label>
                <HelpTip topic="assignment.late" value={{ hasDue: dueAt.trim() !== "", allowLate }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Después de la fecha límite se aceptan, marcadas como «Tardía».
              </p>
            </div>
            <Switch id="assignment-late" checked={allowLate} onCheckedChange={setAllowLate} />
          </div>
        </>
      )}

      {!isFolder && (
        <>
          <Separator />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
            Avance y secuencia
          </p>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="item-required">Requerido para completar</Label>
                <HelpTip topic="content.required" value={{ required }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Si se apaga, el ítem es opcional y no cuenta para el avance del curso.
              </p>
            </div>
            <Switch id="item-required" checked={required} onCheckedChange={setRequired} />
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Secuencia</legend>
            <RadioGroup
              value={sequenceMode}
              onValueChange={(v) => setSequenceMode(v as ItemDetail["sequenceMode"])}
              className="gap-2"
            >
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="inherit" className="mt-0.5" />
                <span>
                  Heredar del curso
                  <span className="block text-xs text-muted-foreground">
                    Usa la regla general del curso (ver Ajustes)
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="required" className="mt-0.5" />
                <span>
                  Obligatoria
                  <span className="block text-xs text-muted-foreground">
                    Hay que completarlo antes de avanzar al siguiente
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="free" className="mt-0.5" />
                <span>
                  Libre
                  <span className="block text-xs text-muted-foreground">
                    No bloquea el avance aunque no esté completo
                  </span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>
        </>
      )}

      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={saving || !title.trim()}
          className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
        >
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}

// ─── Sección de archivo del documento ────────────────────────────────────────

function DocumentSection({
  courseId,
  itemId,
  doc,
}: {
  courseId: string;
  itemId: string;
  doc: DocDetail;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFileIdRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function attach(fileId: string) {
    const result = await attachDocumentAction(courseId, itemId, fileId);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if (result.status === "ready") {
      toast.success(`Documento listo · ${result.pageCount} páginas`);
    } else if (result.status === "pending") {
      toast.info("El PPT se está convirtiendo — en un momento estará listo");
    } else {
      toast.error("No pudimos procesar el archivo. Revisa el detalle e intenta de nuevo.");
    }
    router.refresh();
  }

  async function handleFile(file: File) {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!["pdf", "ppt", "pptx"].includes(ext)) {
      toast.error("Formato no soportado: sube un PDF, PPT o PPTX");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: {
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Kind": "course_source",
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      const data = (await res.json()) as { fileId?: string; error?: string };
      if (!res.ok || !data.fileId) {
        toast.error(data.error ?? "No se pudo subir el archivo. Revisa tu conexión con el servidor.");
        return;
      }
      lastFileIdRef.current = data.fileId;
      await attach(data.fileId);
    } catch {
      toast.error("No se pudo subir el archivo. Revisa tu conexión con el servidor.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function retry() {
    if (lastFileIdRef.current) {
      setUploading(true);
      try {
        await attach(lastFileIdRef.current);
      } finally {
        setUploading(false);
      }
    } else {
      inputRef.current?.click();
    }
  }

  return (
    <div className="grid gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.ppt,.pptx"
        className="sr-only"
        aria-label="Elegir archivo PDF, PPT o PPTX"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {uploading ? (
        <StatusCard tone="info">
          <Loader2 className="size-5 shrink-0 animate-spin text-section-strong" aria-hidden />
          <span>Subiendo archivo…</span>
        </StatusCard>
      ) : !doc.hasFile ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-sm text-muted-foreground transition-colors hover:border-section hover:text-section-strong"
        >
          <Upload className="size-6" aria-hidden />
          <span>
            Haz clic para elegir el archivo
            <span className="block text-xs">PDF, PPT o PPTX</span>
          </span>
        </button>
      ) : doc.processingStatus === "ready" ? (
        <StatusCard tone="success">
          <Check className="size-5 shrink-0 text-success" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              <FileText className="mr-1 inline size-4 align-text-bottom" aria-hidden />
              {doc.fileName ?? "Documento"}
            </span>
            <span className="text-xs text-muted-foreground">
              Listo · {doc.pageCount ?? "?"} páginas
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto shrink-0"
            onClick={() => inputRef.current?.click()}
          >
            Reemplazar
          </Button>
        </StatusCard>
      ) : doc.processingStatus === "error" ? (
        <StatusCard tone="error">
          <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-medium">{doc.fileName ?? "Documento"}</span>
            <span className="text-xs">
              {doc.processingError ?? "No pudimos procesar este archivo."}
            </span>
          </span>
          <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={retry}>
            Reintentar
          </Button>
        </StatusCard>
      ) : (
        <StatusCard tone="pending">
          <Clock className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-medium">{doc.fileName ?? "Documento"}</span>
            <span className="text-xs text-muted-foreground">
              El PPT se está convirtiendo a visor — suele tardar menos de un minuto
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto shrink-0"
            onClick={() => inputRef.current?.click()}
          >
            Reemplazar
          </Button>
        </StatusCard>
      )}
    </div>
  );
}

function StatusCard({
  tone,
  children,
}: {
  tone: "success" | "error" | "pending" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-sm",
        tone === "success" && "border-success/30 bg-success/5",
        tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "pending" && "bg-muted/50",
        tone === "info" && "border-section/30 bg-section-soft/60"
      )}
    >
      {children}
    </div>
  );
}
