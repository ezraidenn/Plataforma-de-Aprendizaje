"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Settings2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { updateExamSettingsAction } from "@/server/actions/teacher-exams";
import { HelpTip } from "@/components/help/help-tip";
import { ResultsPublishPanel } from "./results-publish-panel";

export type ExamSettingsData = {
  instructionsMd: string;
  opensAtMs: number | null;
  closesAtMs: number | null;
  maxAttempts: number | null;
  attemptScorePolicy: "best" | "last" | "average";
  timeLimitMinutes: number | null;
  passScore: number | null;
  shuffleQuestions: boolean;
  showResultsMode: "immediately" | "after_close" | "manual";
  /** Pool aleatorio: preguntas por intento; null = todas las del banco */
  drawCount: number | null;
  /** «Publicar resultados»: null = no publicados */
  resultsPublishedAtMs: number | null;
  /** «Al cerrar el examen» y ya cerró: visibles sin publicar */
  resultsVisibleByClose: boolean;
  /** Alumnos con al menos un intento enviado o calificado */
  studentsWithAttempts: number;
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

/** Número del formulario para la ayuda visual: vacío → null; fuera de rango → ajustado. */
function helpNumber(raw: string, min: number, max: number): number | null {
  if (raw.trim() === "") return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

export function ExamSettingsCard({
  courseId,
  itemId,
  settings,
  questionCount,
}: {
  courseId: string;
  itemId: string;
  settings: ExamSettingsData;
  /** Total de preguntas en el banco (para validar el pool aleatorio) */
  questionCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [instructionsMd, setInstructionsMd] = useState(settings.instructionsMd);
  const [opensAt, setOpensAt] = useState(msToLocalInput(settings.opensAtMs));
  const [closesAt, setClosesAt] = useState(msToLocalInput(settings.closesAtMs));
  const [maxAttempts, setMaxAttempts] = useState(
    settings.maxAttempts === null ? "" : String(settings.maxAttempts)
  );
  const [policy, setPolicy] = useState(settings.attemptScorePolicy);
  const [timeLimit, setTimeLimit] = useState(
    settings.timeLimitMinutes === null ? "" : String(settings.timeLimitMinutes)
  );
  const [passScore, setPassScore] = useState(
    settings.passScore === null ? "" : String(settings.passScore)
  );
  const [shuffle, setShuffle] = useState(settings.shuffleQuestions);
  const [drawCount, setDrawCount] = useState(
    settings.drawCount === null ? "" : String(settings.drawCount)
  );
  const [resultsMode, setResultsMode] = useState(settings.showResultsMode);
  // Valores en vivo para la ayuda visual (aunque aún no se guarden)
  const attemptsHelp = {
    attempts: maxAttempts.trim() === "" ? null : Math.max(1, Number(maxAttempts) || 1),
    policy,
  };
  const windowHelp = { opensAt: localInputToMs(opensAt), closesAt: localInputToMs(closesAt) };
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function save() {
    setError(null);
    startSaving(async () => {
      const result = await updateExamSettingsAction(courseId, itemId, {
        instructionsMd,
        opensAtMs: localInputToMs(opensAt),
        closesAtMs: localInputToMs(closesAt),
        maxAttempts: maxAttempts.trim() === "" ? null : Number(maxAttempts),
        attemptScorePolicy: policy,
        timeLimitMinutes: timeLimit.trim() === "" ? null : Number(timeLimit),
        passScore: passScore.trim() === "" ? null : Number(passScore),
        shuffleQuestions: shuffle,
        showResultsMode: resultsMode,
        drawCount: drawCount.trim() === "" ? null : Number(drawCount),
      });
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Ajustes del examen guardados");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl p-4 text-left"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-section-soft text-section-strong">
          <Settings2 className="size-4" aria-hidden />
        </span>
        <span className="flex-1 text-sm font-semibold">Ajustes del examen</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="grid gap-5 border-t p-4">
          <div className="grid gap-2">
            <Label htmlFor="exam-instructions">Instrucciones</Label>
            <RichTextEditor
              id="exam-instructions"
              value={instructionsMd}
              onChange={setInstructionsMd}
              minHeight={140}
              placeholder="Lo que el estudiante lee antes de comenzar…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="exam-opens">Abre</Label>
                <HelpTip topic="exam.window" value={windowHelp} />
              </div>
              <Input
                id="exam-opens"
                type="datetime-local"
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="exam-closes">Cierra</Label>
                <HelpTip topic="exam.window" value={windowHelp} />
              </div>
              <Input
                id="exam-closes"
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Ambas fechas vacías = el examen siempre está abierto.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="exam-attempts">Intentos máximos</Label>
                <HelpTip topic="exam.attempts" value={attemptsHelp} />
              </div>
              <Input
                id="exam-attempts"
                type="number"
                min={1}
                max={100}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                placeholder="Ilimitados"
              />
              <p className="text-xs text-muted-foreground">Vacío = ilimitados</p>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="exam-time">Tiempo límite (min)</Label>
                <HelpTip topic="exam.timeLimit" value={{ minutes: helpNumber(timeLimit, 1, 600) }} />
              </div>
              <Input
                id="exam-time"
                type="number"
                min={1}
                max={600}
                value={timeLimit}
                onChange={(e) => setTimeLimit(e.target.value)}
                placeholder="Sin límite"
              />
              <p className="text-xs text-muted-foreground">Vacío = sin límite</p>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="exam-pass">Calificación mínima (%)</Label>
                <HelpTip topic="exam.passing" value={{ passScore: helpNumber(passScore, 0, 100) }} />
              </div>
              <Input
                id="exam-pass"
                type="number"
                min={0}
                max={100}
                value={passScore}
                onChange={(e) => setPassScore(e.target.value)}
                placeholder="80"
              />
              <p className="text-xs text-muted-foreground">
                Informativa: la aprobación del curso la deciden las reglas.
              </p>
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="flex items-center gap-1.5 text-sm font-medium">
              Si hay varios intentos, se toma
              <HelpTip topic="exam.attempts" value={attemptsHelp} />
            </legend>
            <RadioGroup
              value={policy}
              onValueChange={(v) => setPolicy(v as ExamSettingsData["attemptScorePolicy"])}
              className="flex flex-wrap gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="best" /> El mejor
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="last" /> El último
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="average" /> El promedio
              </label>
            </RadioGroup>
          </fieldset>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="exam-shuffle">Barajar preguntas</Label>
                <HelpTip topic="exam.shuffle" value={{ shuffle }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Cada estudiante ve las preguntas en un orden distinto.
              </p>
            </div>
            <Switch id="exam-shuffle" checked={shuffle} onCheckedChange={setShuffle} />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="exam-draw">Preguntas por intento</Label>
              <HelpTip topic="exam.pool" value={{ draw: helpNumber(drawCount, 1, 500), bank: questionCount }} />
            </div>
            <Input
              id="exam-draw"
              type="number"
              min={1}
              max={Math.max(1, questionCount)}
              value={drawCount}
              onChange={(e) => setDrawCount(e.target.value)}
              placeholder="Todas"
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Cada intento toma {drawCount.trim() === "" ? "N" : drawCount} preguntas al
              azar del banco de {questionCount}. Vacío = todas.
            </p>
            {drawCount.trim() !== "" && Number(drawCount) >= questionCount && (
              <p className="text-xs text-warning">
                Con {drawCount} o más (el banco tiene {questionCount}), se usarán todas
                las preguntas.
              </p>
            )}
          </div>

          <fieldset className="grid gap-2">
            <legend className="flex items-center gap-1.5 text-sm font-medium">
              Mostrar resultados
              <HelpTip topic="exam.results" value={{ mode: resultsMode }} />
            </legend>
            <RadioGroup
              value={resultsMode}
              onValueChange={(v) => setResultsMode(v as ExamSettingsData["showResultsMode"])}
              className="flex flex-wrap gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="immediately" /> Al enviar
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="after_close" /> Al cerrar el examen
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="manual" /> Cuando yo decida
              </label>
            </RadioGroup>
            {settings.showResultsMode !== "immediately" && (
              <ResultsPublishPanel
                courseId={courseId}
                itemId={itemId}
                closesAtMs={settings.closesAtMs}
                publishedAtMs={settings.resultsPublishedAtMs}
                visibleByClose={settings.resultsVisibleByClose}
                studentsWithAttempts={settings.studentsWithAttempts}
                dirty={
                  resultsMode !== settings.showResultsMode ||
                  localInputToMs(closesAt) !== settings.closesAtMs
                }
              />
            )}
          </fieldset>

          {error && (
            <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={save}
              disabled={saving}
              className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
            >
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {saving ? "Guardando…" : "Guardar ajustes"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
