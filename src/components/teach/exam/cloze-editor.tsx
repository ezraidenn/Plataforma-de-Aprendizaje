"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { Brackets, CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import {
  MAX_CLOZE_TEXT,
  MAX_DISTRACTORS,
  MAX_WRONG_OPTIONS,
  clozeProblem,
  parseCloze,
  type ClozeBlank,
  type ClozeMode,
} from "@/lib/cloze";
import {
  blankPartProblem,
  clozeConfigOf,
  clozeModeLock,
  distractorProblem,
  makeBlank,
  replaceBlank,
  type ClozeEditorValue,
} from "@/lib/cloze-editor-value";
import { cn } from "@/lib/utils";
import { ChipField } from "./cloze-chips";
import { HistoryButtons } from "./image-canvas-toolbar";
import type { Answered } from "./image-photo-tools";
import { Segmented } from "./segmented";
import { isTypingTarget, isUndoKey, useEditorHistory } from "./use-editor-history";
import { usePendingDrafts, type ReportDraft } from "./use-pending-drafts";

/**
 * Editor de «Completar el texto». El texto con sus «[[ ]]» es la única fuente
 * de verdad de los huecos: «Hacer hueco» envuelve la selección y, bajo el
 * texto, cada hueco detectado muestra su respuesta y, según la forma de
 * contestar, sus variantes (escribir) o sus opciones incorrectas (lista) como
 * fichas; agregarlas o quitarlas reescribe el marcador del hueco en el texto.
 * Los distractores (banco) y «Distinguir mayúsculas/acentos» (escribir) van
 * aparte. Cada cambio es un paso de Deshacer (lo que se escribe seguido, uno
 * solo); en el texto, Ctrl+Z deshace lo escrito y, si lo último fue otra cosa
 * (un hueco, una ficha), ese paso. Abajo, lo que impediría guardar, en vivo;
 * cambiar la forma de una pregunta que ya tiene respuestas, además, no se guarda.
 */

const MODES: [ClozeMode, string][] = [
  ["write", "Escribir"],
  ["bank", "Banco"],
  ["select", "Lista"],
];

const MODE_HINT: Record<ClozeMode, string> = {
  write: "El alumno escribe cada respuesta; también cuentan sus variantes.",
  bank: "El alumno pone en cada hueco una palabra del banco: las respuestas de los huecos y los distractores, revueltos.",
  select: "Cada hueco es una lista con la respuesta y sus opciones incorrectas, revueltas.",
};

export function ClozeEditor({
  value,
  onChange,
  savedMode = null,
  answered = null,
  onPendingChange,
}: {
  value: ClozeEditorValue;
  onChange: (value: ClozeEditorValue) => void;
  /** La forma de contestar guardada (null: pregunta nueva). */
  savedMode?: ClozeMode | null;
  /** El examen ya tiene intentos, o esta pregunta respuestas en uno en curso: no se puede guardar con otra forma de contestar. */
  answered?: Answered;
  /** Lo escrito en una ficha sin agregar (null: nada): mientras tanto no se guarda. */
  onPendingChange?: (text: string | null) => void;
}) {
  const history = useEditorHistory(value, onChange);
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Dónde dejar el cursor del texto tras «Hacer hueco». */
  const caret = useRef<number | null>(null);
  /** El último paso: escribir en el texto (su Ctrl+Z es el del campo) u otra cosa (el del editor). */
  const lastEdit = useRef<"typing" | "other">("other");
  /** Se está componiendo un carácter (IME, acentos con tecla muerta): «Hacer hueco» espera. */
  const composing = useRef(false);
  const syntaxId = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const { live, announce } = useAnnouncer();
  const report = usePendingDrafts(onPendingChange);
  const { blanks } = parseCloze(value.text);
  const lock = clozeModeLock(answered, savedMode, value.mode);
  const problem = clozeProblem(clozeConfigOf(value));

  useLayoutEffect(() => {
    const at = caret.current;
    const el = textRef.current;
    if (at === null || !el) return;
    caret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  });

  /** Un cambio que no es escribir en el texto: un paso propio de Deshacer. */
  function edit(fn: (v: ClozeEditorValue) => ClozeEditorValue) {
    lastEdit.current = "other";
    history.set(fn);
  }

  function makeHole() {
    const el = textRef.current;
    if (!el) return;
    if (composing.current) {
      setNotice("Termina de escribir la palabra y vuelve a pulsar «Hacer hueco»");
      return;
    }
    const made = makeBlank(value.text, el.selectionStart, el.selectionEnd);
    if ("error" in made) {
      setNotice(made.error);
      announce(made.error);
      el.focus();
      return;
    }
    setNotice(null);
    edit((v) => ({ ...v, text: made.text }));
    caret.current = made.caret;
    announce("Hueco hecho: escribe o revisa su respuesta dentro de los corchetes");
  }

  /** Reescribe el hueco `index` en el texto (un paso de Deshacer). */
  function changeBlank(index: number, fn: (blank: ClozeBlank) => ClozeBlank, message: string) {
    edit((v) => {
      const blank = parseCloze(v.text).blanks[index];
      return blank ? { ...v, text: replaceBlank(v.text, index, fn(blank)) } : v;
    });
    announce(message);
  }

  /** Deshacer o rehacer; si lo que tenía el foco desaparece, el foco se queda en el editor. */
  function travel(to: "undo" | "redo") {
    const root = rootRef.current;
    lastEdit.current = "other";
    const done = to === "undo" ? history.undo() : history.redo();
    if (done) setNotice(null);
    announce(done ? (to === "undo" ? "Cambio deshecho" : "Cambio rehecho") : to === "undo" ? "Nada que deshacer" : "Nada que rehacer");
    requestAnimationFrame(() => {
      if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    });
  }

  const answers = blanks.flatMap((b) => (b.answers[0] ? [b.answers[0]] : []));

  return (
    <div
      ref={rootRef}
      // Enfocable solo por código: si lo enfocado desaparece al deshacer, los atajos siguen aquí
      tabIndex={-1}
      role="group"
      aria-label="Texto y huecos de la pregunta"
      className="grid gap-3 outline-none"
      onKeyDown={(e) => {
        // Ctrl+Z deshace; Ctrl+Mayús+Z o Ctrl+Y rehacen. En un campo de texto, el suyo
        if (!isUndoKey(e) || isTypingTarget(e.target)) return;
        e.preventDefault();
        travel(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
      }}
    >
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2.5 py-2">
          <Segmented
            label="Forma de contestar"
            value={value.mode}
            options={MODES}
            onChange={(mode) => {
              // La que ya estaba: ni paso ni aviso
              if (mode === value.mode) return;
              edit((v) => ({ ...v, mode }));
              announce(`Forma de contestar: ${MODES.find(([m]) => m === mode)?.[1]}`);
            }}
          />
          <span className="flex-1" />
          <HistoryButtons
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => travel("undo")}
            onRedo={() => travel("redo")}
          />
          <Button
            type="button"
            size="sm"
            // El foco se queda en el texto (y su selección a la vista)
            onMouseDown={(e) => e.preventDefault()}
            onClick={makeHole}
            title="Envuelve lo seleccionado en [[ ]]; sin selección, pone [[ ]] donde está el cursor"
          >
            <Brackets aria-hidden />
            Hacer hueco
          </Button>
        </div>
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">{MODE_HINT[value.mode]}</p>
        <Textarea
          ref={textRef}
          value={value.text}
          maxLength={MAX_CLOZE_TEXT}
          rows={5}
          onChange={(e) => {
            const text = e.target.value;
            lastEdit.current = "typing";
            setNotice(null);
            history.set((v) => ({ ...v, text }), { coalesce: "text" });
          }}
          onKeyDown={(e) => {
            // Lo último no fue escribir (un hueco, una ficha): Ctrl+Z es el del editor, no el del campo
            if (!isUndoKey(e) || lastEdit.current === "typing") return;
            e.preventDefault();
            e.stopPropagation();
            travel(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          // Lo escrito seguido es un paso; al salir del texto empieza otro
          onBlur={history.commit}
          aria-label="Texto con huecos"
          aria-describedby={syntaxId}
          placeholder="La capital de Francia es [[París]] y la de Italia es [[Roma]]."
          className="min-h-28 rounded-none border-0 text-sm leading-relaxed shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        />
        <p id={syntaxId} className="border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          Selecciona una palabra y pulsa «Hacer hueco», o escríbela entre <code>[[ ]]</code>.
          Completo: <code>[[respuesta|variante|!incorrecta]]</code>.
        </p>

        {blanks.length === 0 ? (
          <p className="border-t px-3 py-2.5 text-sm text-muted-foreground">
            Aún no hay huecos: selecciona una palabra del texto y pulsa «Hacer hueco».
          </p>
        ) : (
          <ol aria-label="Huecos" className="divide-y border-t">
            {blanks.map((b, i) => (
              <BlankRow
                key={i}
                n={i + 1}
                blank={b}
                value={value}
                report={report}
                onChange={(fn, message) => changeBlank(i, fn, message)}
              />
            ))}
          </ol>
        )}

        {value.mode === "bank" && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t bg-muted/20 px-3 py-2 text-sm">
            <span className="text-xs text-muted-foreground">Distractores (palabras de más en el banco):</span>
            <ChipField
              items={value.distractors}
              tone="bad"
              noun="distractor"
              context="del banco"
              max={MAX_DISTRACTORS}
              report={report}
              problemOf={(d) => distractorProblem(d, value.distractors, answers)}
              onAdd={(d) => {
                edit((v) => ({ ...v, distractors: [...v.distractors, d] }));
                announce(`«${d}» agregada al banco`);
              }}
              onRemove={(j) => {
                edit((v) => ({ ...v, distractors: v.distractors.filter((_, k) => k !== j) }));
                announce(`«${value.distractors[j]}» quitada del banco`);
              }}
            />
          </div>
        )}
        {value.mode === "write" && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-muted/20 px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={value.matchCase} onCheckedChange={(c) => edit((v) => ({ ...v, matchCase: c === true }))} />
              Distinguir mayúsculas
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={value.matchAccents} onCheckedChange={(c) => edit((v) => ({ ...v, matchAccents: c === true }))} />
              Distinguir acentos <span className="text-xs text-muted-foreground">(la ñ siempre cuenta)</span>
            </label>
          </div>
        )}
      </div>

      {notice && (
        <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-warning" role="status">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      )}
      {/* Lo que impediría guardar, en vivo; la forma bloqueada, primero y más a la vista (tampoco se guarda) */}
      {lock ? (
        <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-warning" role="status">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {lock}
        </p>
      ) : (
        <p className={cn("flex items-center gap-1.5 text-xs", problem ? "text-muted-foreground" : "text-success")}>
          {problem ? <CircleAlert className="size-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />}
          {problem ?? "Lista para guardar"}
        </p>
      )}
      <LiveRegion live={live} />
    </div>
  );
}

/**
 * Un hueco bajo el texto: su número, su respuesta y, según la forma de
 * contestar, sus variantes o sus incorrectas; si su marcador tiene partes que
 * esa forma no usa, lo dice.
 */
function BlankRow({
  n,
  blank,
  value,
  report,
  onChange,
}: {
  n: number;
  blank: ClozeBlank;
  value: ClozeEditorValue;
  report: ReportDraft;
  onChange: (fn: (blank: ClozeBlank) => ClozeBlank, message: string) => void;
}) {
  const { mode } = value;
  const answer = blank.answers[0];
  const context = `del hueco ${n}`;
  const variants = blank.answers.slice(1);
  const unused = [mode !== "write" && variants.length > 0 && "variantes", mode !== "select" && blank.wrong.length > 0 && "incorrectas"].filter(
    Boolean
  );
  return (
    <li className="flex items-start gap-2.5 px-3 py-2 text-sm">
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="sr-only">Hueco {n}:</span>
        {answer ? (
          <b className="[overflow-wrap:anywhere]">{answer}</b>
        ) : (
          <span className="text-muted-foreground italic">sin respuesta: escríbela entre sus [[ ]]</span>
        )}
        {answer && mode === "write" && (
          <>
            <span className="text-xs text-muted-foreground">· variantes:</span>
            <ChipField
              items={variants}
              tone="ok"
              noun="variante"
              context={context}
              report={report}
              problemOf={(v) => blankPartProblem(v, blank, "variant", value)}
              onAdd={(v) => onChange((b) => ({ ...b, answers: [...b.answers, v] }), `Variante «${v}» agregada al hueco ${n}`)}
              onRemove={(j) =>
                onChange((b) => ({ ...b, answers: b.answers.filter((_, k) => k !== j + 1) }), `Variante «${variants[j]}» quitada del hueco ${n}`)
              }
            />
          </>
        )}
        {answer && mode === "select" && (
          <>
            <span className="text-xs text-muted-foreground">· incorrectas:</span>
            <ChipField
              items={blank.wrong}
              tone="bad"
              noun="incorrecta"
              context={context}
              max={MAX_WRONG_OPTIONS}
              report={report}
              problemOf={(w) => blankPartProblem(w, blank, "wrong")}
              onAdd={(w) => onChange((b) => ({ ...b, wrong: [...b.wrong, w] }), `Opción incorrecta «${w}» agregada al hueco ${n}`)}
              onRemove={(j) =>
                onChange((b) => ({ ...b, wrong: b.wrong.filter((_, k) => k !== j) }), `Opción incorrecta «${blank.wrong[j]}» quitada del hueco ${n}`)
              }
            />
          </>
        )}
        {unused.length > 0 && <span className="text-xs text-muted-foreground">· {unused.join(" e ")}: no se usan en esta forma</span>}
      </div>
    </li>
  );
}
