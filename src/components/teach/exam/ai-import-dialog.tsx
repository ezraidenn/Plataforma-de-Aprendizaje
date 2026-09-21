"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, FileImage, FileText, FileUp, Loader2, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExamPreview } from "@/components/exam/exam-preview";
import { downloadTextFile } from "@/components/teach/csv-download";
import { analyzeChunkAction, draftsToCsvAction, importAiQuestionsAction } from "@/server/actions/ai-exam";
import { DRAFT_TYPE_LABEL, draftProblem, type QuestionDraft } from "@/lib/question-draft";
import { draftToPreview } from "@/lib/preview-question";
import { formatBytes } from "@/lib/file-meta";
import {
  AI_ACCEPT,
  MAX_AI_FILES,
  MAX_SCANNED_PAGES,
  addAiFiles,
  aiFileKind,
  scannedTooLongMessage,
} from "@/lib/ai-import-files";

type Step = "file" | "working" | "result";

/** Una pregunta interpretada, con correcciones rápidas. */
function DraftCard({
  draft,
  index,
  onChange,
  onRemove,
}: {
  draft: QuestionDraft;
  index: number;
  onChange: (d: QuestionDraft) => void;
  onRemove: () => void;
}) {
  const problem = draftProblem(draft);
  const withOptions = draft.type === "single_choice" || draft.type === "multiple_choice" || draft.type === "true_false";

  function toggleCorrect(i: number) {
    const options = draft.options.map((o, j) =>
      draft.type === "multiple_choice" ? (j === i ? { ...o, correct: !o.correct } : o) : { ...o, correct: j === i }
    );
    // Al marcar la correcta, la nota «no se indica la respuesta correcta» ya no aplica
    onChange({ ...draft, options, issues: draft.issues.filter((n) => !/correcta/i.test(n)) });
  }

  return (
    <li
      data-draft
      className={cn("space-y-2 rounded-xl border bg-card p-3", problem && "border-destructive/50 ring-1 ring-destructive/20")}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{index + 1}.</span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-md bg-kind-exam-tint px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-kind-exam-strong">
              {DRAFT_TYPE_LABEL[draft.type]}
            </span>
            {draft.source && (
              <span
                data-draft-source
                title={draft.source}
                className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {aiFileKind(draft.source) === "image" || /imágenes$/.test(draft.source) ? (
                  <FileImage className="size-3 shrink-0" aria-hidden />
                ) : (
                  <FileText className="size-3 shrink-0" aria-hidden />
                )}
                <span className="truncate">{draft.source}</span>
              </span>
            )}
          </div>
          <p className="text-[15px] font-medium leading-snug">{draft.prompt}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Input
            type="number"
            min={0.5}
            step={0.5}
            value={draft.points}
            onChange={(e) => onChange({ ...draft, points: Number(e.target.value) || 0 })}
            className="h-9 w-16 text-center"
            aria-label={`Puntos de la pregunta ${index + 1}`}
          />
          <span className="text-xs text-muted-foreground">pts</span>
          <Button size="icon-sm" variant="ghost" aria-label={`Quitar la pregunta ${index + 1}`} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      {withOptions && (
        <ul className="grid gap-1 pl-8">
          {draft.options.map((o, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggleCorrect(i)}
                aria-pressed={o.correct}
                aria-label={`${o.correct ? "Correcta" : "Marcar como correcta"}: ${o.text}`}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm transition-colors",
                  o.correct ? "border-success/40 bg-success/10" : "hover:bg-accent"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center border",
                    draft.type === "multiple_choice" ? "rounded-md" : "rounded-full",
                    o.correct ? "border-success bg-success text-white" : "border-muted-foreground/40"
                  )}
                >
                  {o.correct && <Check className="size-3.5" aria-hidden />}
                </span>
                {o.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft.type === "short_text" && (
        <p className="pl-8 text-sm text-muted-foreground">Se acepta: {draft.accepted.join(" · ") || "—"}</p>
      )}
      {draft.type === "matching" && (
        <ul className="grid gap-0.5 pl-8 text-sm">
          {draft.pairs.map((p, i) => (
            <li key={i}>
              {p.left} <span className="text-muted-foreground">→</span> {p.right}
            </li>
          ))}
        </ul>
      )}
      {draft.type === "ordering" && (
        <ol className="grid gap-0.5 pl-8 text-sm">
          {draft.steps.map((s, i) => (
            <li key={i}>
              <span className="tabular-nums text-muted-foreground">{i + 1}.</span> {s}
            </li>
          ))}
        </ol>
      )}

      {draft.issues.length > 0 && (
        <ul className="space-y-0.5 pl-8">
          {draft.issues.map((n) => (
            <li key={n} className="flex items-start gap-1.5 text-[13px] text-amber-800">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p className="pl-8 text-[13px] font-medium text-destructive" role="alert">
          Falta: {problem}
        </p>
      )}
    </li>
  );
}

/**
 * «Importar con IA»: archivos (hasta 5) → texto (servidor) o visión (imágenes
 * y PDF escaneados) → OpenAI → revisar y ver como alumno → importar. Nada se
 * crea hasta el último paso.
 */
export function AiImportDialog({
  courseId,
  itemId,
  currentCount,
}: {
  courseId: string;
  itemId: string;
  currentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>({ done: 0, total: 0, label: "" });
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [tab, setTab] = useState("review");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [busy, startBusy] = useTransition();
  const cancelled = useRef(false);

  const valid = drafts.filter((d) => draftProblem(d) === null);
  const blocked = drafts.length - valid.length;
  const withNotes = drafts.filter((d) => d.issues.length > 0).length;
  // La vista previa se arma con las válidas; se recalcula solo cuando cambian
  // (revolver de nuevo en cada render movería las opciones mientras se usa)
  const previewQuestions = useMemo(
    () => drafts.filter((d) => draftProblem(d) === null).map(draftToPreview),
    [drafts]
  );

  function reset() {
    setStep("file");
    setFiles([]);
    setDrafts([]);
    setFailures([]);
    setTab("review");
    setMode("append");
    setProgress({ done: 0, total: 0, label: "" });
  }

  function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const { files: next, rejected } = addAiFiles(files, Array.from(list));
    setFiles(next);
    for (const message of rejected) toast.error(message);
  }

  /** Imágenes (juntas) o un PDF escaneado → borradores, por la ruta de visión. */
  async function readVision(list: File[]): Promise<{ drafts: QuestionDraft[] } | { error: string }> {
    const form = new FormData();
    form.set("courseId", courseId);
    form.set("itemId", itemId);
    for (const f of list) form.append("files", f, f.name);
    try {
      const res = await fetch("/api/teach/ai-vision", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { drafts?: QuestionDraft[]; error?: string };
      if (!res.ok || !body.drafts) return { error: body.error ?? "No se pudo leer el archivo." };
      return { drafts: body.drafts };
    } catch {
      return { error: "Se perdió la conexión con el servidor." };
    }
  }

  async function analyze() {
    if (files.length === 0) return;
    cancelled.current = false;
    setStep("working");
    setFailures([]);

    // Pasos en el orden de la lista; las imágenes van juntas (una pregunta puede
    // seguir de una foto a la otra), en el lugar de la primera
    const images = files.filter((f) => aiFileKind(f.name) === "image");
    const steps: ({ kind: "doc"; file: File } | { kind: "images" })[] = [];
    for (const f of files) {
      if (aiFileKind(f.name) === "doc") steps.push({ kind: "doc", file: f });
      else if (f === images[0]) steps.push({ kind: "images" });
    }
    const multi = files.length > 1;
    const imagesLabel = images.length === 1 ? images[0].name : `${images.length} imágenes`;
    const found: QuestionDraft[] = [];
    const failed: string[] = [];
    const add = (drafts: QuestionDraft[], source: string) =>
      found.push(...drafts.map((d) => (multi ? { ...d, source } : d)));

    for (let s = 0; s < steps.length && !cancelled.current; s++) {
      const current = steps[s];
      const at = (label: string, fraction = 0) => setProgress({ done: s + fraction, total: steps.length, label });

      if (current.kind === "images") {
        at(images.length === 1 ? `Interpretando «${images[0].name}»…` : `Interpretando ${images.length} imágenes…`);
        const result = await readVision(images);
        if ("error" in result) failed.push(`${imagesLabel}: ${result.error}`);
        else add(result.drafts, imagesLabel);
        continue;
      }

      const f = current.file;
      at(`Leyendo «${f.name}» (${s + 1} de ${steps.length})…`);
      let extracted: { chunks?: string[]; scanned?: boolean; pages?: number; error?: string };
      try {
        const res = await fetch("/api/teach/ai-extract", {
          method: "POST",
          headers: { "X-File-Name": encodeURIComponent(f.name) },
          body: f,
        });
        extracted = (await res.json()) as typeof extracted;
        if (!res.ok) throw new Error(extracted.error ?? "No se pudo leer el archivo.");
      } catch (err) {
        failed.push(`${f.name}: ${err instanceof Error ? err.message : "No se pudo leer el archivo."}`);
        continue;
      }

      if (extracted.scanned) {
        const pages = extracted.pages ?? 0;
        if (pages > MAX_SCANNED_PAGES) {
          failed.push(scannedTooLongMessage(f.name, pages));
          continue;
        }
        at(`Leyendo el PDF escaneado «${f.name}»…`);
        const result = await readVision([f]);
        if ("error" in result) failed.push(`${f.name}: ${result.error}`);
        else add(result.drafts, f.name);
        continue;
      }

      const chunks = extracted.chunks ?? [];
      for (let i = 0; i < chunks.length && !cancelled.current; i++) {
        at(
          chunks.length > 1 ? `Interpretando «${f.name}», parte ${i + 1} de ${chunks.length}…` : `Interpretando «${f.name}»…`,
          i / chunks.length
        );
        const result = await analyzeChunkAction({ courseId, itemId, chunk: chunks[i] });
        if ("error" in result) failed.push(`${f.name}${chunks.length > 1 ? ` (parte ${i + 1})` : ""}: ${result.error}`);
        else add(result.drafts, f.name);
      }
    }

    if (cancelled.current) {
      setStep("file");
      return;
    }
    if (found.length === 0) {
      toast.error(failed[0] ?? "No encontré preguntas en los archivos.");
      setFailures(failed);
      setStep("file");
      return;
    }
    setDrafts(found);
    setFailures(failed);
    setTab("review");
    setStep("result");
  }

  function downloadCsv() {
    startBusy(async () => {
      const result = await draftsToCsvAction({ courseId, itemId, drafts });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      downloadTextFile(result.filename, result.csv);
      toast.success("CSV descargado. Edítalo en Excel y súbelo con «Importar CSV».");
    });
  }

  function runImport() {
    startBusy(async () => {
      const result = await importAiQuestionsAction({ courseId, itemId, drafts: valid, mode });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Se ${result.imported === 1 ? "importó 1 pregunta" : `importaron ${result.imported} preguntas`}` +
          (blocked > 0 ? ` (${blocked} con problemas se omitieron)` : "")
      );
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) cancelled.current = true;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11">
          <Sparkles aria-hidden />
          Importar con IA
        </Button>
      </DialogTrigger>
      {/* Con resultados, alto FIJO: así la revisión y la vista previa hacen scroll
          por dentro y nada empuja el pie ni se sale del diálogo */}
      <DialogContent
        className={cn(
          "flex max-h-[92vh] flex-col gap-4 overflow-hidden sm:max-w-4xl",
          step === "result" && "h-[92vh]"
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-section-strong" aria-hidden />
            Importar preguntas con IA
          </DialogTitle>
          <DialogDescription>
            Sube hasta 5 archivos con tus preguntas, también fotos o PDF escaneados: la IA las transcribe con su
            tipo. Las revisas y las ves como alumno antes de crearlas.
          </DialogDescription>
        </DialogHeader>

        {step === "file" && (
          <div className="space-y-4">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "hover:bg-accent"
              )}
            >
              <FileUp className="size-8 text-muted-foreground" aria-hidden />
              <span className="font-medium">Arrastra aquí hasta {MAX_AI_FILES} archivos o haz clic para elegirlos</span>
              <span className="text-xs text-muted-foreground">
                Word, Excel, CSV, PDF, PowerPoint, texto o imágenes (JPG, PNG, WEBP) · hasta 10 MB cada uno
              </span>
              <input
                type="file"
                multiple
                accept={AI_ACCEPT}
                className="sr-only"
                aria-label="Archivos con las preguntas"
                onChange={(e) => {
                  pick(e.target.files);
                  // Permite volver a elegir un archivo que se quitó
                  e.target.value = "";
                }}
              />
            </label>

            {files.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {files.length} de {MAX_AI_FILES} archivos
                </p>
                <ul className="max-h-60 space-y-1.5 overflow-auto" data-ai-files>
                  {files.map((f) => {
                    const Icon = aiFileKind(f.name) === "image" ? FileImage : FileText;
                    return (
                      <li
                        key={`${f.name}-${f.size}`}
                        data-ai-file
                        className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5"
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Quitar «${f.name}»`}
                          onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                        >
                          <X aria-hidden />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              El texto y las imágenes se envían a OpenAI para procesarlos. Nada sale del servidor hasta que pulses «Analizar».
            </p>
            {failures.length > 0 && (
              <ul className="space-y-1 text-[13px] text-destructive">
                {failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button onClick={() => void analyze()} disabled={files.length === 0} className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90">
                <Sparkles aria-hidden />
                Analizar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "working" && (
          <div className="space-y-4 py-6" role="status" aria-live="polite">
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {progress.label}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-cta transition-[width] duration-500"
                style={{ width: progress.total ? `${Math.round(((progress.done + 0.5) / progress.total) * 100)}%` : "8%" }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Un archivo largo puede tardar un par de minutos.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => (cancelled.current = true)}>
                Cancelar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "result" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="text-sm" data-ai-summary>
              Encontré <b>{drafts.length}</b> {drafts.length === 1 ? "pregunta" : "preguntas"}
              {withNotes > 0 && <> · <span className="text-amber-800">{withNotes} con avisos</span></>}
              {blocked > 0 && <> · <span className="text-destructive">{blocked} necesitan tu corrección</span></>}
            </p>
            {failures.length > 0 && (
              <ul className="space-y-0.5 text-[13px] text-destructive">
                {failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-3">
              <TabsList className="self-start">
                <TabsTrigger value="review">Revisar</TabsTrigger>
                <TabsTrigger value="preview" disabled={valid.length === 0}>
                  Ver como alumno
                </TabsTrigger>
              </TabsList>
              <TabsContent value="review" className="min-h-0 flex-1 overflow-auto">
                <ol className="space-y-2">
                  {drafts.map((d, i) => (
                    <DraftCard
                      key={d.key}
                      draft={d}
                      index={i}
                      onChange={(next) => setDrafts((prev) => prev.map((x) => (x.key === d.key ? next : x)))}
                      onRemove={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                    />
                  ))}
                </ol>
              </TabsContent>
              <TabsContent value="preview" className="min-h-0 flex-1">
                <ExamPreview questions={previewQuestions} />
              </TabsContent>
            </Tabs>

            {/* El pie ya trae su línea y su fondo: aquí no se suma otra */}
            <div className="space-y-3">
              {currentCount > 0 && (
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as "append" | "replace")}
                  className="flex flex-wrap gap-4 border-t pt-3"
                >
                  <Label className="flex items-center gap-2 font-normal">
                    <RadioGroupItem value="append" /> Agregar al examen
                  </Label>
                  <Label className="flex items-center gap-2 font-normal">
                    <RadioGroupItem value="replace" /> Reemplazar las {currentCount} preguntas actuales
                  </Label>
                </RadioGroup>
              )}
              {mode === "replace" && currentCount > 0 && (
                <p className="text-[13px] text-destructive">
                  Se borrarán las {currentCount} preguntas que tiene hoy el examen.
                </p>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={downloadCsv} disabled={busy || drafts.length === 0}>
                  <Download aria-hidden />
                  Descargar como CSV
                </Button>
                <Button
                  onClick={runImport}
                  disabled={busy || valid.length === 0}
                  className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
                >
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  Importar {valid.length} {valid.length === 1 ? "pregunta" : "preguntas"}
                  {blocked > 0 ? ` (${blocked} se omiten)` : ""}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
