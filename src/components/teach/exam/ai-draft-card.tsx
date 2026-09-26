"use client";

import { useId, useState } from "react";
import { Check, FileImage, FileText, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { DRAFT_TYPE_LABEL, draftProblem, formatGroupLines, parseGroupLines, type QuestionDraft } from "@/lib/question-draft";
import type { ClozeMode } from "@/lib/cloze";
import { aiFileKind } from "@/lib/ai-import-files";

/**
 * Una pregunta interpretada por la IA, con correcciones rápidas: los puntos,
 * la correcta de las de opciones y, en clasificar y completar, sus grupos, su
 * texto con huecos, cómo se contesta y los distractores.
 */
export function DraftCard({
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
      {draft.type === "categorize" && <GroupsField draft={draft} n={index + 1} onChange={onChange} />}
      {draft.type === "cloze" && <ClozeFields draft={draft} n={index + 1} onChange={onChange} />}

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
 * Los grupos de clasificar, uno por línea: «Grupo: tarjeta; tarjeta». Lo
 * escrito se guarda tal cual (para no comerse un «; » a media escritura) y los
 * grupos se leen de ahí en cada cambio.
 */
function GroupsField({ draft, n, onChange }: { draft: QuestionDraft; n: number; onChange: (d: QuestionDraft) => void }) {
  const hintId = useId();
  const [text, setText] = useState(() => formatGroupLines(draft.groups));
  return (
    <div className="grid gap-1 pl-8">
      <Textarea
        value={text}
        rows={Math.max(2, draft.groups.length)}
        onChange={(e) => {
          setText(e.target.value);
          onChange({ ...draft, groups: parseGroupLines(e.target.value) });
        }}
        aria-label={`Grupos de la pregunta ${n}`}
        aria-describedby={hintId}
        className="min-h-0 text-sm"
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        Un grupo por línea: <code>Grupo: tarjeta; tarjeta</code>.
      </p>
    </div>
  );
}

const CLOZE_MODES: [ClozeMode, string][] = [
  ["write", "Escribir"],
  ["bank", "Banco"],
  ["select", "Lista"],
];

/** Completar el texto: el texto con sus huecos, cómo se contesta y, en banco, los distractores. */
function ClozeFields({ draft, n, onChange }: { draft: QuestionDraft; n: number; onChange: (d: QuestionDraft) => void }) {
  const hintId = useId();
  const modeId = useId();
  const wordsId = useId();
  // Como los grupos: lo escrito tal cual, las palabras se leen de ahí
  const [words, setWords] = useState(() => draft.distractors.join("; "));
  return (
    <div className="grid gap-2 pl-8">
      <div className="grid gap-1">
        <Textarea
          value={draft.clozeText}
          rows={2}
          onChange={(e) => onChange({ ...draft, clozeText: e.target.value })}
          aria-label={`Texto con huecos de la pregunta ${n}`}
          aria-describedby={hintId}
          className="min-h-0 text-sm"
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          Cada hueco entre <code>[[ ]]</code>: <code>[[respuesta|variante|!incorrecta]]</code>.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span id={modeId} className="text-xs text-muted-foreground">
          Forma de contestar:
        </span>
        <RadioGroup
          value={draft.clozeMode}
          onValueChange={(v) => onChange({ ...draft, clozeMode: v as ClozeMode })}
          aria-labelledby={modeId}
          className="flex w-auto flex-wrap gap-4"
        >
          {CLOZE_MODES.map(([mode, label]) => (
            <Label key={mode} className="flex items-center gap-2 font-normal">
              <RadioGroupItem value={mode} /> {label}
            </Label>
          ))}
        </RadioGroup>
      </div>
      {draft.clozeMode === "bank" && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Label htmlFor={wordsId} className="text-xs font-normal text-muted-foreground">
            Distractores (palabras de más en el banco, separadas por ;):
          </Label>
          <Input
            id={wordsId}
            value={words}
            onChange={(e) => {
              setWords(e.target.value);
              onChange({
                ...draft,
                distractors: e.target.value
                  .split(";")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
            }}
            className="h-9 min-w-40 flex-1 text-sm"
          />
        </div>
      )}
    </div>
  );
}
