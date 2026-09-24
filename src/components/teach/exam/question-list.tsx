"use client";

import { useCallback, useState, useTransition, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileQuestion,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  type QuestionFormInput,
} from "@/server/actions/teacher-exams";
import { HelpTip } from "@/components/help/help-tip";
import { fileUrl, isImageQuestionType } from "@/lib/image-questions";
import { initialImageValue, type ImageQuestionValue } from "@/lib/image-editor-value";
import { ImagePreviewButton, ImageQuestionEditor } from "./image-question-editor";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type QuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "short_text"
  | "matching"
  | "ordering"
  | "open_text"
  | "image_drag"
  | "image_click";

export type QuestionData = {
  id: string;
  type: QuestionType;
  promptMd: string;
  points: number;
  options: { textMd: string; isCorrect: boolean }[];
  accepted: string[];
  pairs: { left: string; right: string }[];
  steps: string[];
  /** image_drag/image_click: la foto y la config tal como se guardaron */
  imageFileId: string | null;
  imageConfig: unknown;
};

const TYPE_LABEL: Record<QuestionType, string> = {
  single_choice: "Opción única",
  multiple_choice: "Opción múltiple",
  true_false: "Verdadero/Falso",
  short_text: "Respuesta corta",
  matching: "Relacionar columnas",
  ordering: "Ordenar pasos",
  open_text: "Texto abierto",
  image_drag: "Arrastrar a la imagen",
  image_click: "Señalar en la imagen",
};

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
}: {
  courseId: string;
  itemId: string;
  questions: QuestionData[];
  /** Pool aleatorio activo: preguntas sorteadas por intento (null = todas) */
  drawCount?: number | null;
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

// ─── Editor inline de una pregunta ───────────────────────────────────────────

function QuestionEditor({
  type,
  initial,
  onCancel,
  onSave,
}: {
  type: QuestionType;
  initial: QuestionData | null;
  onCancel: () => void;
  /** Devuelve el mensaje de error del servidor o null si todo salió bien. */
  onSave: (input: QuestionFormInput) => Promise<string | null>;
}) {
  const [promptMd, setPromptMd] = useState(initial?.promptMd ?? "");
  const [points, setPoints] = useState(String(initial?.points ?? 1));
  const [options, setOptions] = useState<{ textMd: string; isCorrect: boolean }[]>(() => {
    if (type === "true_false") {
      return [
        { textMd: "Verdadero", isCorrect: initial?.options[0]?.isCorrect ?? false },
        { textMd: "Falso", isCorrect: initial?.options[1]?.isCorrect ?? false },
      ];
    }
    if (initial && initial.options.length > 0) return initial.options.map((o) => ({ ...o }));
    return [
      { textMd: "", isCorrect: false },
      { textMd: "", isCorrect: false },
    ];
  });
  const [accepted, setAccepted] = useState<string[]>(initial?.accepted ?? []);
  const [newVariant, setNewVariant] = useState("");
  const [pairs, setPairs] = useState<{ left: string; right: string }[]>(
    initial && initial.pairs.length > 0
      ? initial.pairs.map((p) => ({ ...p }))
      : [
          { left: "", right: "" },
          { left: "", right: "" },
        ]
  );
  const [steps, setSteps] = useState<string[]>(
    initial && initial.steps.length > 0 ? [...initial.steps] : ["", "", ""]
  );
  const moveStep = (from: number, to: number) =>
    setSteps((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  // Preguntas sobre imagen: la foto y su config (los demás tipos no lo usan)
  const [image, setImage] = useState<ImageQuestionValue>(() =>
    initialImageValue(type, initial?.imageFileId ?? null, initial?.imageConfig)
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  // Al tocar la foto, los lugares o los puntos, el error del último intento de
  // guardar ya no aplica: no debe quedar junto a «Lista para guardar»
  const changeImage = useCallback((next: SetStateAction<ImageQuestionValue>) => {
    setError(null);
    setImage(next);
  }, []);
  const parsedPoints = Number(points);

  function addVariant() {
    const value = newVariant.trim();
    if (!value) return;
    if (!accepted.includes(value)) setAccepted((prev) => [...prev, value]);
    setNewVariant("");
  }

  function save() {
    setError(null);
    startSaving(async () => {
      const input: QuestionFormInput = {
        type,
        promptMd,
        points: Number.isFinite(parsedPoints) ? parsedPoints : 0,
        ...(type === "single_choice" || type === "multiple_choice" || type === "true_false"
          ? { options }
          : {}),
        ...(type === "short_text"
          ? { accepted: newVariant.trim() ? [...accepted, newVariant.trim()] : accepted }
          : {}),
        ...(type === "matching" ? { pairs } : {}),
        ...(type === "ordering" ? { steps } : {}),
        ...(isImageQuestionType(type) ? { imageFileId: image.imageFileId, imageConfig: image.config } : {}),
      };
      const message = await onSave(input);
      if (message) setError(message);
    });
  }

  const singleCorrectIndex = options.findIndex((o) => o.isCorrect);

  return (
    <div
      className={cn("grid gap-4 rounded-xl p-4", error && "ring-1 ring-destructive")}
      role="group"
      aria-label={`Editor de pregunta: ${TYPE_LABEL[type]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-md bg-kind-exam-tint px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-kind-exam-strong">
            {TYPE_LABEL[type]}
          </span>
          {type === "image_drag" && <HelpTip topic="exam.imageDrag" />}
          {type === "image_click" && <HelpTip topic="exam.imageClick" />}
        </span>
        {type === "open_text" && (
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
              <TriangleAlert className="size-3.5" aria-hidden />
              La revisa el instructor en la cola de calificación
            </span>
            <HelpTip topic="exam.openQuestion" />
          </span>
        )}
        {isImageQuestionType(type) && (
          <ImagePreviewButton
            type={type}
            value={image}
            promptMd={promptMd}
            points={Number.isFinite(parsedPoints) ? parsedPoints : 0}
          />
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="q-prompt">Enunciado</Label>
        <Textarea
          id="q-prompt"
          value={promptMd}
          onChange={(e) => setPromptMd(e.target.value)}
          rows={3}
          placeholder="Escribe la pregunta…"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="q-points">Puntos</Label>
        <Input
          id="q-points"
          type="number"
          min={0.5}
          step={0.5}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="w-28"
        />
      </div>

      {(type === "single_choice" || type === "multiple_choice") && (
        <div className="grid gap-2">
          <Label>
            Opciones{" "}
            <span className="font-normal text-muted-foreground">
              ({type === "single_choice" ? "marca la correcta" : "marca las correctas"})
            </span>
          </Label>
          {type === "single_choice" ? (
            <RadioGroup
              value={singleCorrectIndex >= 0 ? String(singleCorrectIndex) : ""}
              onValueChange={(v) =>
                setOptions((prev) => prev.map((o, i) => ({ ...o, isCorrect: i === Number(v) })))
              }
              className="gap-2"
            >
              {options.map((option, i) => (
                <div key={i} className="flex items-center gap-2">
                  <RadioGroupItem value={String(i)} aria-label={`Opción ${i + 1} correcta`} />
                  <Input
                    value={option.textMd}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, j) => (j === i ? { ...o, textMd: e.target.value } : o))
                      )
                    }
                    placeholder={`Opción ${i + 1}`}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Quitar opción ${i + 1}`}
                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <div className="grid gap-2">
              {options.map((option, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Checkbox
                    checked={option.isCorrect}
                    onCheckedChange={(checked) =>
                      setOptions((prev) =>
                        prev.map((o, j) => (j === i ? { ...o, isCorrect: checked === true } : o))
                      )
                    }
                    aria-label={`Opción ${i + 1} correcta`}
                  />
                  <Input
                    value={option.textMd}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, j) => (j === i ? { ...o, textMd: e.target.value } : o))
                      )
                    }
                    placeholder={`Opción ${i + 1}`}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Quitar opción ${i + 1}`}
                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => setOptions((prev) => [...prev, { textMd: "", isCorrect: false }])}
          >
            <Plus aria-hidden />
            Agregar opción
          </Button>
        </div>
      )}

      {type === "true_false" && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Respuesta correcta</legend>
          <RadioGroup
            value={singleCorrectIndex >= 0 ? String(singleCorrectIndex) : ""}
            onValueChange={(v) =>
              setOptions((prev) => prev.map((o, i) => ({ ...o, isCorrect: i === Number(v) })))
            }
            className="flex gap-6"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="0" /> Verdadero
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="1" /> Falso
            </label>
          </RadioGroup>
        </fieldset>
      )}

      {type === "short_text" && (
        <div className="grid gap-2">
          <Label htmlFor="q-variant">Respuestas aceptadas</Label>
          {accepted.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {accepted.map((variant) => (
                <li
                  key={variant}
                  className="inline-flex items-center gap-1 rounded-md bg-section-soft px-2 py-0.5 text-sm text-section-strong"
                >
                  {variant}
                  <button
                    type="button"
                    aria-label={`Quitar «${variant}»`}
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                    onClick={() => setAccepted((prev) => prev.filter((v) => v !== variant))}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              id="q-variant"
              value={newVariant}
              onChange={(e) => setNewVariant(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addVariant();
                }
              }}
              placeholder="Escribe una variante y presiona Enter"
            />
            <Button size="sm" variant="outline" className="h-9" onClick={addVariant}>
              Agregar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Se compara sin distinguir mayúsculas ni espacios al inicio o final.
          </p>
        </div>
      )}

      {type === "matching" && (
        <div className="grid gap-2">
          <Label>Pares para relacionar (mínimo 2)</Label>
          {pairs.map((pair, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={pair.left}
                onChange={(e) =>
                  setPairs((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, left: e.target.value } : p))
                  )
                }
                placeholder={`Izquierda ${i + 1}`}
                aria-label={`Lado izquierdo del par ${i + 1}`}
              />
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <Input
                value={pair.right}
                onChange={(e) =>
                  setPairs((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, right: e.target.value } : p))
                  )
                }
                placeholder={`Derecha ${i + 1}`}
                aria-label={`Lado derecho del par ${i + 1}`}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Quitar par ${i + 1}`}
                onClick={() => setPairs((prev) => prev.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => setPairs((prev) => [...prev, { left: "", right: "" }])}
          >
            <Plus aria-hidden />
            Agregar par
          </Button>
          <p className="text-xs text-muted-foreground">
            El estudiante verá la columna derecha en desorden y deberá emparejarla.
          </p>
        </div>
      )}

      {type === "ordering" && (
        <div className="grid gap-2">
          <div className="flex items-center gap-1.5">
            <Label>Pasos en el orden correcto (3 a 10)</Label>
            <HelpTip topic="exam.ordering" />
          </div>
          <ol className="grid gap-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <Input
                  value={step}
                  onChange={(e) =>
                    setSteps((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
                  }
                  placeholder={`Paso ${i + 1}`}
                  aria-label={`Paso ${i + 1}`}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Subir paso ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => moveStep(i, i - 1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Bajar paso ${i + 1}`}
                  disabled={i === steps.length - 1}
                  onClick={() => moveStep(i, i + 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Quitar paso ${i + 1}`}
                  onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={steps.length >= 10}
            onClick={() => setSteps((prev) => [...prev, ""])}
          >
            <Plus aria-hidden />
            Agregar paso
          </Button>
          <p className="text-xs text-muted-foreground">
            Escríbelos en el orden correcto: el estudiante los verá revueltos y deberá acomodarlos.
          </p>
        </div>
      )}

      {isImageQuestionType(type) && (
        <ImageQuestionEditor type={type} value={image} onChange={changeImage} onBusyChange={setUploading} />
      )}

      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          onClick={save}
          // Mientras sube una imagen no se guarda: se perdería
          disabled={saving || uploading}
          title={uploading ? "Espera a que termine de subir la imagen" : undefined}
          className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
        >
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {saving ? "Guardando…" : "Guardar pregunta"}
        </Button>
      </div>
    </div>
  );
}
