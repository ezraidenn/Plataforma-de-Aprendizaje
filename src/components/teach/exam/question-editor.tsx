"use client";

import { useCallback, useState, useTransition, type SetStateAction } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { QuestionFormInput } from "@/server/actions/teacher-exams";
import { HelpTip } from "@/components/help/help-tip";
import { isImageQuestionType } from "@/lib/image-questions";
import { initialImageValue, type ImageQuestionValue } from "@/lib/image-editor-value";
import type { Answered } from "./image-photo-tools";
import { ImagePreviewButton, ImageQuestionEditor } from "./image-question-editor";

/**
 * El editor de una pregunta del banco (nueva o existente), dentro de la lista
 * de preguntas (`question-list.tsx`): enunciado, puntos y lo propio de cada
 * tipo; las preguntas sobre imagen, con `ImageQuestionEditor`. Aquí viven
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
};

// ─── Editor inline de una pregunta ───────────────────────────────────────────

export function QuestionEditor({
  type,
  initial,
  onCancel,
  onSave,
  answered = null,
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
        <ImageQuestionEditor
          type={type}
          value={image}
          onChange={changeImage}
          onBusyChange={setUploading}
          answered={answered}
        />
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
