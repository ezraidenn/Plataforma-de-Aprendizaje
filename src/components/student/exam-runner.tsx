"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Award,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Clock,
  Info,
  ListChecks,
  Loader2,
  RotateCcw,
  Target,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KindChip } from "@/components/kind-meta";
import { RichContent } from "@/components/rich-content";
import {
  EMPTY_ANSWER,
  QuestionCard,
  isAnswered,
  renderBold,
  type AnswerState,
} from "@/components/exam/question-view";
import {
  saveAnswerAction,
  startAttemptAction,
  submitAttemptAction,
} from "@/server/actions/student-exams";
import type {
  AttemptDto,
  ExamLessonData,
  ReviewEntry,
  RunnerQuestion,
} from "./types";

// ─── Utilidades ──────────────────────────────────────────────────────────────

const DATE_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const DATE_SHORT_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const fmtDate = (ms: number) => DATE_FMT.format(new Date(ms));
const fmtDateShort = (ms: number) => DATE_SHORT_FMT.format(new Date(ms));
/** Cierra la frase con punto sin duplicar el de «p.m.» (es-MX ya lo trae). */
const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

const POLICY_TEXT = {
  best: "Se toma tu MEJOR calificación",
  last: "Cuenta tu ÚLTIMA calificación",
  average: "Se PROMEDIAN tus calificaciones",
} as const;

function toSavePayload(q: RunnerQuestion, a: AnswerState) {
  const withText: RunnerQuestion["type"][] = [
    "short_text",
    "open_text",
    "matching",
    "ordering",
    "image_drag",
    "image_click",
  ];
  if (withText.includes(q.type)) return { answerText: a.answerText };
  return { selectedOptionIds: a.selectedOptionIds };
}

// ─── Timer con reloj corregido por el servidor ───────────────────────────────

function ExamTimer({
  deadlineMs,
  offsetMs,
  onExpire,
}: {
  deadlineMs: number;
  offsetMs: number;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState(() => deadlineMs - (Date.now() + offsetMs));
  const [announcement, setAnnouncement] = useState("");
  const expiredRef = useRef(false);
  const warned5 = useRef(false);
  const warned1 = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const id = window.setInterval(() => {
      const rem = deadlineMs - (Date.now() + offsetMs);
      setRemaining(rem);
      if (rem <= 5 * 60_000 && !warned5.current) {
        warned5.current = true;
        setAnnouncement("Quedan 5 minutos");
      }
      if (rem <= 60_000 && !warned1.current) {
        warned1.current = true;
        setAnnouncement("Queda menos de 1 minuto");
      }
      if (rem <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        window.clearInterval(id);
        onExpireRef.current();
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [deadlineMs, offsetMs]);

  const clamped = Math.max(0, remaining);
  const hours = Math.floor(clamped / 3_600_000);
  const mins = Math.floor((clamped % 3_600_000) / 60_000);
  const secs = Math.floor((clamped % 60_000) / 1000);
  const display =
    hours > 0
      ? `${hours} h ${String(mins).padStart(2, "0")} min`
      : `${mins}:${String(secs).padStart(2, "0")}`;
  const level = clamped <= 60_000 ? "danger" : clamped <= 5 * 60_000 ? "warn" : "normal";

  return (
    <>
      <p
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums",
          level === "normal" && "text-muted-foreground",
          level === "warn" && "text-warning",
          level === "danger" && "text-destructive motion-safe:animate-pulse"
        )}
      >
        <Clock className="size-4" aria-hidden />
        {display} restantes
      </p>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

// ─── Anillo de calificación ──────────────────────────────────────────────────

function ScoreRing({ percent, passed }: { percent: number; passed: boolean }) {
  const size = 150;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const color = passed ? "var(--progress-ring)" : "var(--destructive)";

  return (
    <span
      className="relative inline-flex"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Calificación: ${percent}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-heading text-3xl font-semibold tabular-nums"
        style={{ color }}
        aria-hidden
      >
        {percent}%
      </span>
    </span>
  );
}

// ─── Controles por tipo de pregunta ──────────────────────────────────────────

// ─── Runner completo ─────────────────────────────────────────────────────────

type SubmitOutcome = {
  attempt: AttemptDto;
  scorePercent: number | null;
  courseCompleted: boolean;
  review: ReviewEntry[] | null;
  resultsVisible: boolean;
};

/**
 * Player de examen (DISENO-UX §2.5): pantalla de inicio → runner de una
 * pregunta por pantalla con timer del servidor y autosave → confirmación →
 * resultados según show_results_mode.
 */
export function ExamRunner({
  courseId,
  itemId,
  title,
  data,
  courseHref,
  nextHref,
  onSubmitted,
}: {
  courseId: string;
  itemId: string;
  title: string;
  data: ExamLessonData;
  courseHref: string;
  nextHref: string | null;
  /** Marca el ítem como completado en el árbol (sin toast de lección). */
  onSubmitted: () => void;
}) {
  const [phase, setPhase] = useState<"start" | "running" | "results">("start");
  const [attempt, setAttempt] = useState<AttemptDto | null>(null);
  // Las preguntas llegan al iniciar/reanudar el intento (nunca en la pantalla
  // de inicio): el banco no viaja sin intento (C4).
  const [questions, setQuestions] = useState<RunnerQuestion[]>(
    data.resume?.questions ?? []
  );
  const [attemptsUsed, setAttemptsUsed] = useState(data.attemptsUsed);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [index, setIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitOutcome | null>(null);

  // Offset = reloj del servidor − reloj local (el servidor es la verdad)
  const offsetRef = useRef(data.serverNowMs - Date.now());
  const timersRef = useRef(new Map<string, number>());
  const dirtyRef = useRef(new Set<string>());
  const submittedRef = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  // C1: el orden renderizado es EXACTAMENTE questionOrder mapeado sobre las
  // preguntas recibidas; si falta alguna en el payload se ignora (nunca se
  // anexa nada fuera del sorteo).
  const orderedQuestions = useMemo(() => {
    if (!attempt || attempt.questionOrder.length === 0) return questions;
    const byId = new Map(questions.map((q) => [q.id, q]));
    return attempt.questionOrder
      .map((id) => byId.get(id))
      .filter((q): q is RunnerQuestion => !!q);
  }, [attempt, questions]);

  const total = orderedQuestions.length;

  // ─── Iniciar / retomar ─────────────────────────────────────────────────────

  const begin = useCallback(async () => {
    setStarting(true);
    const res = await startAttemptAction({ courseId, itemId });
    setStarting(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    offsetRef.current = res.serverNowMs - Date.now();
    const initial: Record<string, AnswerState> = {};
    for (const a of res.answers) {
      initial[a.questionId] = {
        selectedOptionIds: a.selectedOptionIds ?? [],
        answerText: a.answerText ?? "",
      };
    }
    submittedRef.current = false;
    setResult(null);
    setAnswers(initial);
    setQuestions(res.questions);
    setAttemptsUsed(res.attemptsUsed);
    setAttempt(res.attempt);
    setIndex(0);
    setSaveState("idle");
    setPhase("running");
  }, [courseId, itemId]);

  // ─── Autosave (debounce 400 ms por pregunta) ───────────────────────────────

  const flushQuestion = useCallback(async (q: RunnerQuestion) => {
    const at = attemptRef.current;
    if (!at) return;
    const a = answersRef.current[q.id] ?? EMPTY_ANSWER;
    dirtyRef.current.delete(q.id);
    setSaveState("saving");
    const res = await saveAnswerAction({
      attemptId: at.id,
      questionId: q.id,
      ...toSavePayload(q, a),
    });
    if ("error" in res) {
      dirtyRef.current.add(q.id);
      setSaveState("error");
    } else if (dirtyRef.current.size === 0) {
      setSaveState("saved");
    }
  }, []);

  const scheduleSave = useCallback(
    (q: RunnerQuestion) => {
      dirtyRef.current.add(q.id);
      const prev = timersRef.current.get(q.id);
      if (prev !== undefined) window.clearTimeout(prev);
      timersRef.current.set(
        q.id,
        window.setTimeout(() => {
          timersRef.current.delete(q.id);
          void flushQuestion(q);
        }, 400)
      );
    },
    [flushQuestion]
  );

  const setAnswer = useCallback(
    (q: RunnerQuestion, patch: Partial<AnswerState>) => {
      setAnswers((prev) => ({
        ...prev,
        [q.id]: { ...EMPTY_ANSWER, ...prev[q.id], ...patch },
      }));
      scheduleSave(q);
    },
    [scheduleSave]
  );

  const flushAll = useCallback(async () => {
    for (const t of timersRef.current.values()) window.clearTimeout(t);
    timersRef.current.clear();
    const byId = new Map(orderedQuestions.map((q) => [q.id, q]));
    const pending = [...dirtyRef.current];
    await Promise.all(
      pending.map((id) => {
        const q = byId.get(id);
        return q ? flushQuestion(q) : Promise.resolve();
      })
    );
  }, [orderedQuestions, flushQuestion]);

  // ─── Envío ─────────────────────────────────────────────────────────────────

  const doSubmit = useCallback(
    async (auto: boolean) => {
      const at = attemptRef.current;
      if (!at || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      await flushAll();
      // M2: si quedaron respuestas sin guardar y NO es el autoenvío del timer,
      // no enviamos un intento incompleto.
      if (!auto && dirtyRef.current.size > 0) {
        submittedRef.current = false;
        setSubmitting(false);
        toast.error("No se pudieron guardar todas tus respuestas — revisa tu conexión");
        return;
      }
      const res = await submitAttemptAction({ courseId, itemId, attemptId: at.id, auto });
      setSubmitting(false);
      if ("error" in res) {
        submittedRef.current = false;
        toast.error(res.error);
        return;
      }
      setConfirmOpen(false);
      setAttemptsUsed(res.attemptsUsed);
      setResult({
        attempt: res.attempt,
        scorePercent: res.scorePercent,
        courseCompleted: res.courseCompleted,
        review: res.review,
        resultsVisible: res.resultsVisible,
      });
      setPhase("results");
      if (auto) {
        toast("Se acabó el tiempo — tu intento se envió automáticamente");
      }
      if (res.courseCompleted) {
        toast.success("¡Aprobaste el curso!");
      }
      onSubmitted();
    },
    [courseId, itemId, flushAll, onSubmitted]
  );

  // ─── Teclado: ←/→ navegan preguntas (fuera de los controles) ──────────────

  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
          t.closest(
            '[role="radiogroup"], [role="listbox"], [role="checkbox"], [role="combobox"], [role="dialog"]'
          ))
      ) {
        return;
      }
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, total - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, total]);

  // ═══ Pantalla de inicio ═════════════════════════════════════════════════

  if (phase === "start") {
    const remainingAttempts =
      data.maxAttempts === null ? null : Math.max(0, data.maxAttempts - attemptsUsed);
    const noAttemptsLeft =
      data.resume === null && remainingAttempts !== null && remainingAttempts <= 0;
    const canStart =
      data.windowState === "open" && data.questionCount > 0 && !noAttemptsLeft;

    const chipClass =
      "flex min-h-7 items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm";

    return (
      <div className="h-full overflow-auto">
        <div className="anim-rise mx-auto max-w-2xl space-y-6 p-6 md:p-8">
          <div className="space-y-3">
            <h2 className="flex items-center gap-3 font-heading text-xl font-semibold">
              <KindChip kind="exam" size="lg" />
              {title}
            </h2>
            <ul className="flex flex-wrap items-center gap-2">
              <li className={chipClass}>
                <ListChecks className="size-3.5 shrink-0 text-primary" aria-hidden />
                {data.questionCount}{" "}
                {data.questionCount === 1 ? "pregunta" : "preguntas"}
              </li>
              {data.timeLimitMinutes !== null && (
                <li className={chipClass}>
                  <Clock className="size-3.5 shrink-0 text-primary" aria-hidden />
                  {data.timeLimitMinutes} minutos
                </li>
              )}
              {data.passScore !== null && (
                <li className={chipClass}>
                  <Target className="size-3.5 shrink-0 text-primary" aria-hidden />
                  Calificación mínima: {data.passScore}%
                </li>
              )}
              <li className={chipClass}>
                <RotateCcw className="size-3.5 shrink-0 text-primary" aria-hidden />
                {data.maxAttempts === null
                  ? `Intentos ilimitados · ${attemptsUsed} ${attemptsUsed === 1 ? "usado" : "usados"}`
                  : `Intentos: ${attemptsUsed} de ${data.maxAttempts} usados`}
              </li>
            </ul>
          </div>

          {data.instructionsMd.trim() && (
            <div className="rounded-xl border bg-card p-4">
              <RichContent content={data.instructionsMd} />
            </div>
          )}

          <div className="space-y-1.5 text-sm">
            <p className="flex items-center gap-1.5">
              <Info className="size-4 shrink-0 text-primary" aria-hidden />
              {POLICY_TEXT[data.scorePolicy]}
            </p>
            {data.closesAtMs !== null && (
              <p className="flex items-center gap-1.5">
                <CalendarClock className="size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-semibold">Cierra:</span>{" "}
                  {fmtDate(data.closesAtMs)}
                </span>
              </p>
            )}
          </div>

          {data.timeLimitMinutes !== null && data.windowState === "open" && !noAttemptsLeft && (
            <p className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm text-primary">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Al comenzar, el tiempo corre aunque cierres la ventana.
            </p>
          )}

          {data.windowState === "not_open" ? (
            <p className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm">
              <CalendarClock className="size-4 shrink-0 text-primary" aria-hidden />
              {data.opensAtMs !== null
                ? sentence(`Este examen abre el ${fmtDate(data.opensAtMs)}`)
                : "Este examen aún no abre."}
            </p>
          ) : data.windowState === "closed" ? (
            <p className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {data.closesAtMs !== null
                ? sentence(`Este examen cerró el ${fmtDate(data.closesAtMs)}`)
                : "Este examen ya cerró."}
            </p>
          ) : data.questionCount === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm text-muted-foreground">
              <Info className="size-4 shrink-0" aria-hidden />
              Este examen no tiene preguntas todavía. Tu instructor lo está preparando.
            </p>
          ) : noAttemptsLeft ? (
            <p className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm text-muted-foreground">
              <Info className="size-4 shrink-0" aria-hidden />
              Ya usaste todos tus intentos.
            </p>
          ) : null}

          {canStart && (
            <div>
              <Button
                onClick={() => void begin()}
                disabled={starting}
                className="h-11 min-w-44 bg-cta text-cta-foreground hover:bg-cta/90"
              >
                {starting && (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                )}
                {data.resume ? "Continuar intento" : "Comenzar intento"}
              </Button>
            </div>
          )}

          {data.pastAttempts.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Intentos anteriores</h3>
              <ul className="space-y-1">
                {data.pastAttempts.map((a) => (
                  <li key={a.number} className="text-sm text-muted-foreground">
                    #{a.number} —{" "}
                    {a.percent !== null
                      ? `${a.percent}%`
                      : !data.resultsVisible
                        ? "Enviado · resultados pendientes"
                        : a.status === "submitted"
                          ? "En revisión"
                          : "Enviado"}
                    {a.submittedAtMs !== null && ` — ${fmtDateShort(a.submittedAtMs)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ Resultados ═════════════════════════════════════════════════════════

  if (phase === "results" && result) {
    const graded = result.attempt.status === "graded";
    const showNow = result.resultsVisible && graded;
    const passed =
      result.scorePercent !== null &&
      (data.passScore === null || result.scorePercent >= data.passScore);
    // M3: attemptsUsed viene fresco del servidor (ya incluye este envío)
    const remainingAttempts =
      data.maxAttempts === null ? null : Math.max(0, data.maxAttempts - attemptsUsed);
    // B5: la ventana se recalcula con el reloj del servidor (offset), no con
    // el windowState congelado al cargar la página.
    const nowMs = Date.now() + offsetRef.current;
    const windowOpen =
      (data.opensAtMs === null || nowMs >= data.opensAtMs) &&
      (data.closesAtMs === null || nowMs <= data.closesAtMs);
    const canRetry =
      !passed && windowOpen && (remainingAttempts === null || remainingAttempts > 0);

    const retry = () => {
      submittedRef.current = false;
      setAttempt(null);
      setQuestions([]);
      setResult(null);
      setAnswers({});
      setSaveState("idle");
      setPhase("start");
    };

    return (
      <div className="h-full overflow-auto">
        <div className="anim-rise mx-auto max-w-2xl space-y-6 p-6 md:p-8">
          {result.courseCompleted && (
            <p className="flex items-center gap-3 rounded-xl border-l-4 border-l-success bg-card p-4 font-heading text-lg font-semibold">
              <Award className="size-6 shrink-0 text-success" aria-hidden />
              ¡Aprobaste el curso!
            </p>
          )}

          {showNow && result.scorePercent !== null ? (
            <>
              <div className="flex flex-col items-center gap-3 text-center">
                <ScoreRing percent={result.scorePercent} passed={passed} />
                <p className="font-heading text-lg font-semibold" aria-live="polite">
                  {passed
                    ? data.passScore !== null
                      ? `¡Aprobado! Superaste el mínimo de ${data.passScore}%.`
                      : "Tu examen fue calificado."
                    : `No alcanzaste el mínimo de ${data.passScore}%.`}
                </p>
                {canRetry && (
                  <p className="text-sm text-muted-foreground">
                    {remainingAttempts === null
                      ? "Puedes volver a intentarlo las veces que necesites."
                      : `Te ${remainingAttempts === 1 ? "queda" : "quedan"} ${remainingAttempts} ${remainingAttempts === 1 ? "intento" : "intentos"}.`}
                  </p>
                )}
              </div>

              {result.review && result.review.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-heading text-base font-semibold">
                    Desglose por pregunta
                  </h3>
                  {result.review.map((entry, i) => (
                    <div
                      key={entry.questionId}
                      className="space-y-2 rounded-xl border bg-card p-4"
                    >
                      <div className="flex items-start gap-2">
                        {entry.result === "correct" ? (
                          <CircleCheck
                            className="mt-0.5 size-5 shrink-0 fill-progress-ring stroke-white"
                            aria-hidden
                          />
                        ) : entry.result === "partial" ? (
                          <CircleDot
                            className="mt-0.5 size-5 shrink-0 text-warning"
                            aria-hidden
                          />
                        ) : entry.result === "pending" ? (
                          <Clock
                            className="mt-0.5 size-5 shrink-0 text-primary"
                            aria-hidden
                          />
                        ) : (
                          <X
                            className="mt-0.5 size-5 shrink-0 text-destructive"
                            aria-hidden
                          />
                        )}
                        <p className="min-w-0 flex-1 font-medium">
                          {i + 1}. {renderBold(entry.promptMd)}
                        </p>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                          {entry.earnedPoints ?? "—"} / {entry.points}{" "}
                          {entry.points === 1 ? "pt" : "pts"}
                        </span>
                      </div>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Tu respuesta:</span>{" "}
                        {entry.yourAnswer}
                      </p>
                      {entry.result !== "correct" &&
                        entry.result !== "pending" &&
                        entry.correctAnswer && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">
                              Respuesta correcta:
                            </span>{" "}
                            {entry.correctAnswer}
                          </p>
                        )}
                      {entry.result === "pending" && (
                        <p className="text-sm text-muted-foreground">
                          Pendiente de revisión del instructor.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-brand-tint">
                {data.showResultsMode === "after_close" && graded ? (
                  <CalendarClock className="size-8 text-primary" aria-hidden />
                ) : (
                  <Clock className="size-8 text-primary" aria-hidden />
                )}
              </span>
              <p className="font-heading text-lg font-semibold">Tu examen fue enviado</p>
              <p className="max-w-md text-muted-foreground" aria-live="polite">
                {!graded
                  ? "Tu instructor revisará las preguntas abiertas — te avisaremos aquí."
                  : data.showResultsMode === "after_close" && data.closesAtMs !== null
                    ? sentence(`Los resultados estarán disponibles el ${fmtDate(data.closesAtMs)}`)
                    : "Tu instructor decidirá cuándo publicar los resultados."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              asChild
              className="h-11 min-w-44 bg-cta text-cta-foreground hover:bg-cta/90"
            >
              <Link href={nextHref ?? courseHref}>
                Continuar con el curso
                <ChevronRight aria-hidden />
              </Link>
            </Button>
            {showNow && canRetry && (
              <Button variant="outline" className="h-11" onClick={retry}>
                Reintentar examen
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══ Runner (una pregunta por pantalla) ═════════════════════════════════

  const q = orderedQuestions[index];
  if (!q || !attempt) return null;

  const answer = answers[q.id] ?? EMPTY_ANSWER;
  const answeredCount = orderedQuestions.filter((qq) =>
    isAnswered(qq, answers[qq.id])
  ).length;
  const unanswered = orderedQuestions
    .map((qq, i) => ({ qq, i }))
    .filter(({ qq }) => !isAnswered(qq, answers[qq.id]));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Encabezado: posición, guardado, timer y envío */}
      <div className="space-y-2 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate font-heading text-sm font-semibold">
            Pregunta {index + 1} de {total}
          </p>
          <span
            className="shrink-0 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {saveState === "saving" ? (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden />
                Guardando…
              </span>
            ) : saveState === "saved" ? (
              <span className="flex items-center gap-1">
                <Check className="size-3 text-success" aria-hidden />
                Guardado
              </span>
            ) : saveState === "error" ? (
              <span className="flex items-center gap-1 text-destructive">
                <TriangleAlert className="size-3" aria-hidden />
                Sin guardar — revisa tu conexión
              </span>
            ) : null}
          </span>
          {attempt.deadlineAtMs !== null && (
            <ExamTimer
              deadlineMs={attempt.deadlineAtMs}
              offsetMs={offsetRef.current}
              onExpire={() => void doSubmit(true)}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => setConfirmOpen(true)}
            disabled={submitting}
          >
            Enviar examen
          </Button>
        </div>

        {/* Barra de respondidas, clicable para saltar */}
        <div className="flex gap-px" role="group" aria-label="Ir a una pregunta">
          {orderedQuestions.map((qq, i) => {
            const done = isAnswered(qq, answers[qq.id]);
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Pregunta ${i + 1}${done ? " — respondida" : " — sin responder"}`}
                aria-current={i === index ? "true" : undefined}
                className="group flex h-6 min-w-0 flex-1 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors duration-200",
                    done ? "bg-progress-ring" : "bg-muted",
                    i === index && "outline outline-2 outline-offset-1 outline-primary"
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Pregunta actual (anim-pop al cambiar: el key remonta la card) */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div key={q.id} className="anim-pop mx-auto max-w-2xl space-y-5 p-6 md:p-8">
          <QuestionCard q={q} answer={answer} onChange={(patch) => setAnswer(q, patch)} />
        </div>
      </div>

      {/* Navegación inferior con navegador de puntos */}
      <div className="flex items-center justify-between gap-3 border-t bg-card px-4 py-2">
        <Button
          variant="outline"
          className="h-11 min-w-28"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft aria-hidden />
          Anterior
        </Button>

        <div
          className="hidden flex-wrap items-center justify-center gap-1.5 sm:flex"
          role="group"
          aria-label="Navegador de preguntas"
        >
          {orderedQuestions.map((qq, i) => {
            const done = isAnswered(qq, answers[qq.id]);
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Pregunta ${i + 1}${done ? " — respondida" : " — sin responder"}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border-2 text-[0px] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-primary",
                  done ? "border-progress-ring bg-progress-ring" : "border-locked bg-transparent",
                  i === index && "outline outline-2 outline-offset-1 outline-primary"
                )}
              />
            );
          })}
        </div>

        {index < total - 1 ? (
          <Button
            className="h-11 min-w-28"
            variant="outline"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            Siguiente
            <ChevronRight aria-hidden />
          </Button>
        ) : (
          <Button
            className="h-11 min-w-28 bg-cta text-cta-foreground hover:bg-cta/90"
            onClick={() => setConfirmOpen(true)}
            disabled={submitting}
          >
            Enviar examen
          </Button>
        )}
      </div>

      {/* Confirmación de envío (irreversible → modal, DISENO-UX §3.4) */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Enviar examen?</DialogTitle>
            <DialogDescription>
              Respondiste {answeredCount} de {total}{" "}
              {total === 1 ? "pregunta" : "preguntas"}.
            </DialogDescription>
          </DialogHeader>
          {unanswered.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm text-warning">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                Sin responder:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unanswered.map(({ i }) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmOpen(false);
                      setIndex(i);
                    }}
                  >
                    Pregunta {i + 1}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              className="bg-cta text-cta-foreground hover:bg-cta/90"
              onClick={() => void doSubmit(false)}
              disabled={submitting}
            >
              {submitting && (
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
              )}
              Enviar examen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
