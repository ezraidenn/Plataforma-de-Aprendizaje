"use client";

import { useCallback, useId, useState, useTransition, type SetStateAction } from "react";
import { Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { QuestionFormInput } from "@/server/actions/teacher-exams";
import { HelpTip } from "@/components/help/help-tip";
import { isImageQuestionType } from "@/lib/image-questions";
import { initialImageValue, type ImageQuestionValue } from "@/lib/image-editor-value";
import { categorizeProblem, type CategorizeConfig } from "@/lib/categorize";
import { initialCategorizeValue } from "@/lib/categorize-editor-value";
import { clozeProblem } from "@/lib/cloze";
import { clozeConfigOf, clozeModeLock, initialClozeValue, type ClozeEditorValue } from "@/lib/cloze-editor-value";
import { boardPreview } from "@/lib/preview-question";
import { CategorizeEditor } from "./categorize-editor";
import { ChoiceOptionsEditor } from "./choice-options-editor";
import { MatchingPairsEditor, OrderingStepsEditor } from "./matching-ordering-editors";
import { ClozeEditor } from "./cloze-editor";
import type { Answered } from "./image-photo-tools";
import { ImagePreviewButton, ImageQuestionEditor } from "./image-question-editor";
import { DraftPreviewButton } from "./preview-button";

/**
 * El editor de una pregunta del banco (nueva o existente), dentro de la lista
 * de preguntas (`question-list.tsx`): enunciado, puntos y lo propio de cada
 * tipo; las preguntas sobre imagen, con `ImageQuestionEditor`, y las de
 * clasificar y completar, con `CategorizeEditor` y `ClozeEditor`. Aquí viven
 * también los tipos y los nombres de los tipos de pregunta que usa la lista.
 */

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
  | "image_click"
  | "categorize"
  | "cloze";

export type QuestionData = {
  id: string;
  type: QuestionType;
  promptMd: string;
  points: number;
  options: { textMd: string; isCorrect: boolean }[];
  accepted: string[];
  pairs: { left: string; right: string }[];
  steps: string[];
  /** image_drag/image_click: la foto de fondo tal como se guardó */
  imageFileId: string | null;
  /** image_drag/image_click/categorize/cloze: la config tal como se guardó (la lee su editor); los demás tipos, null */
  config: unknown;
};

export const TYPE_LABEL: Record<QuestionType, string> = {
  single_choice: "Opción única",
  multiple_choice: "Opción múltiple",
  true_false: "Verdadero/Falso",
  short_text: "Respuesta corta",
  matching: "Relacionar columnas",
  ordering: "Ordenar pasos",
  open_text: "Texto abierto",
  image_drag: "Arrastrar a la imagen",
  image_click: "Señalar en la imagen",
  categorize: "Clasificar en grupos",
  cloze: "Completar el texto",
};

// ─── Editor inline de una pregunta ───────────────────────────────────────────

export function QuestionEditor({
  type,
  initial,
  onCancel,
  onSave,
  answered = null,
  clozeHasAnswers = false,
}: {
  type: QuestionType;
  initial: QuestionData | null;
  onCancel: () => void;
  /** Devuelve el mensaje de error del servidor o null si todo salió bien. */
  onSave: (input: QuestionFormInput) => Promise<string | null>;
  /**
   * El examen ya tiene intentos enviados («attempts») o esta pregunta,
   * respuestas guardadas en un intento en curso («in_progress»): cambiar,
   * recortar o girar su foto pide confirmación.
   */
  answered?: Answered;
  /** Completar: la pregunta ya tiene respuestas guardadas (en cualquier intento): no se puede cambiar su forma de contestar. */
  clozeHasAnswers?: boolean;
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
  // Preguntas sobre imagen: la foto y su config (los demás tipos no lo usan)
  const [image, setImage] = useState<ImageQuestionValue>(() =>
    initialImageValue(type, initial?.imageFileId ?? null, initial?.config)
  );
  // Clasificar y completar: su config (los demás tipos no la usan)
  const [categorize, setCategorize] = useState(() => initialCategorizeValue(type === "categorize" ? initial?.config : null));
  const [cloze, setCloze] = useState(() => initialClozeValue(type === "cloze" ? initial?.config : null));
  const [uploading, setUploading] = useState(false);
  /** Lo escrito en una ficha o tarjeta sin agregar (clasificar y completar): no se guarda hasta agregarlo o cerrarlo. */
  const [pending, setPending] = useState<string | null>(null);
  const pendingId = useId();
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  // Al tocar la foto, los lugares o los puntos, el error del último intento de
  // guardar ya no aplica: no debe quedar junto a «Lista para guardar»
  const changeImage = useCallback((next: SetStateAction<ImageQuestionValue>) => {
    setError(null);
    setImage(next);
  }, []);
  const changeCategorize = useCallback((next: CategorizeConfig) => {
    setError(null);
    setCategorize(next);
  }, []);
  const changeCloze = useCallback((next: ClozeEditorValue) => {
    setError(null);
    setCloze(next);
  }, []);
  const parsedPoints = Number(points);
  // Clasificar y completar: lo que se guarda (en completar, solo lo de su forma de contestar)
  const boardConfig = type === "categorize" ? categorize : type === "cloze" ? clozeConfigOf(cloze) : null;
  // Completar con respuestas guardadas: otra forma de contestar no se guarda (el editor dice por qué)
  const savedClozeMode = type === "cloze" && initial ? initialClozeValue(initial.config).mode : null;
  const clozeLock = type === "cloze" ? clozeModeLock(clozeHasAnswers, savedClozeMode, cloze.mode) : null;

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
        ...(isImageQuestionType(type) ? { imageFileId: image.imageFileId, config: image.config } : {}),
        ...(boardConfig ? { config: boardConfig } : {}),
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
          {type === "categorize" && <HelpTip topic="exam.categorize" />}
          {type === "cloze" && <HelpTip topic="exam.cloze" />}
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
        {(type === "categorize" || type === "cloze") && boardConfig && (
          <DraftPreviewButton
            problem={type === "categorize" ? categorizeProblem(boardConfig) : clozeProblem(boardConfig)}
            build={() =>
              boardPreview({
                id: "vista-previa",
                type,
                promptMd,
                points: Number.isFinite(parsedPoints) ? parsedPoints : 0,
                config: boardConfig,
              })
            }
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
        <ChoiceOptionsEditor type={type} options={options} setOptions={setOptions} />
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

      {type === "matching" && <MatchingPairsEditor pairs={pairs} setPairs={setPairs} />}

      {type === "ordering" && <OrderingStepsEditor steps={steps} setSteps={setSteps} />}

      {isImageQuestionType(type) && (
        <ImageQuestionEditor
          type={type}
          value={image}
          onChange={changeImage}
          onBusyChange={setUploading}
          answered={answered}
        />
      )}

      {type === "categorize" && (
        <CategorizeEditor value={categorize} onChange={changeCategorize} onBusyChange={setUploading} onPendingChange={setPending} />
      )}
      {type === "cloze" && (
        <ClozeEditor value={cloze} onChange={changeCloze} savedMode={savedClozeMode} hasAnswers={clozeHasAnswers} onPendingChange={setPending} />
      )}

      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {pending !== null && (
        <p id={pendingId} className="flex items-center justify-end gap-1 text-sm text-amber-700 dark:text-warning">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          Tienes «{pending}» sin agregar: pulsa Enter o ciérralo.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          onClick={save}
          // Mientras sube una imagen no se guarda (se perdería), ni con algo escrito sin agregar o una forma de contestar que no se puede guardar
          disabled={saving || uploading || pending !== null || clozeLock !== null}
          title={
            uploading
              ? "Espera a que termine de subir la imagen"
              : pending !== null
                ? `Tienes «${pending}» sin agregar: pulsa Enter o ciérralo`
                : (clozeLock ?? undefined)
          }
          aria-describedby={pending !== null ? pendingId : undefined}
          className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
        >
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {saving ? "Guardando…" : "Guardar pregunta"}
        </Button>
      </div>
    </div>
  );
}
