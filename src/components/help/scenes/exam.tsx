"use client";

import { cn } from "@/lib/utils";
import { KindChip } from "@/components/kind-meta";
import { useSceneClock } from "../use-scene-clock";
import { MiniBadge, MiniButton, MiniToast } from "../mini/basics";
import { MiniExamBar, MiniQuestion, MiniScoreRing } from "../mini/exam";
import type { HelpValues } from "../topics";
import {
  ATTEMPTS_CYCLE_MS,
  attemptsStory,
  EXAMPLE_CLOSES,
  PASS_MIN,
  PASSING_CYCLE_MS,
  passingStory,
  RESULTS_CYCLE_MS,
  resultsStory,
  TIME_CYCLE_MS,
  timeLimitStory,
  timerText,
  WINDOW_CYCLE_MS,
  windowStory,
  type ResultsMode,
} from "./exam.story";

/** Fecha con hora como la del examen del alumno («15 mar 2026, 9:00 a.m.»). */
const DATE_FMT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDate = (ms: number) => DATE_FMT.format(new Date(ms));
/** Cierra la frase con punto sin duplicar el de «p.m.» */
const dot = (text: string) => (text.endsWith(".") ? text : `${text}.`);
const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;

export function AttemptsScene({ value }: { value: HelpValues["exam.attempts"] }) {
  const phase = useSceneClock(ATTEMPTS_CYCLE_MS);
  const s = attemptsStory(phase, value.attempts, value.policy);
  const screenKey = s.screen === "history" ? "history" : `${s.screen}-${s.attemptLabel}`;
  return (
    <div className="absolute inset-2.5 rounded-xl border bg-white p-3">
      <div key={screenKey} className="animate-in fade-in duration-300">
        {s.screen === "answering" && (
          <>
            <h4 className="text-[12.5px] font-bold">Evaluación parcial — Clases de fuego</h4>
            <p className="mt-0.5 text-[10.5px] text-slate-500">{s.attemptLabel} · respondiendo…</p>
            <div className="my-3 flex gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={cn("size-[26px] rounded-md border transition-colors duration-200", i < s.answered ? "border-indigo-200 bg-indigo-50" : "bg-slate-100")}
                />
              ))}
            </div>
            <MiniButton variant="primary">Enviar intento</MiniButton>
          </>
        )}
        {s.screen === "result" && (
          <>
            <h4 className="text-[12.5px] font-bold">Resultado · {s.attemptLabel}</h4>
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className={cn("text-[26px] font-extrabold", s.passed ? "text-green-600" : "text-red-600")}>{s.score}%</span>
              <MiniBadge tone={s.passed ? "ok" : "bad"}>{s.passed ? "Aprobado" : `No aprobado · mínimo ${PASS_MIN}%`}</MiniBadge>
            </div>
            <p className="my-2.5 text-[10.5px] text-slate-500">
              {s.passed
                ? s.nextLabel
                  ? "¡Bien! Todavía puede intentar mejorar."
                  : "¡Bien!"
                : s.nextLabel
                  ? "Puede volver a intentarlo."
                  : "Ya no le quedan intentos."}
            </p>
            {s.nextLabel ? <MiniButton variant="primary">{s.nextLabel}</MiniButton> : <MiniButton variant="disabled">🔒 Sin intentos</MiniButton>}
          </>
        )}
        {s.screen === "history" && (
          <>
            <h4 className="text-[12.5px] font-bold">Tus intentos</h4>
            <table className="mt-2 w-full text-[11px]">
              <tbody>
                {s.rows.map((row) => (
                  <tr key={row.n} className={row.counted ? "bg-emerald-50 font-bold" : undefined}>
                    <td className="border-t border-slate-100 px-1 py-1.5">Intento {row.n}</td>
                    <td className="border-t border-slate-100 px-1 py-1.5">{row.score}%</td>
                    <td className="border-t border-slate-100 px-1 py-1.5 text-right">{row.counted ? "★ cuenta" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10.5px] leading-snug text-slate-500">
              Calificación del examen: <b className="text-slate-900">{s.finalScore}%</b> ({s.policyText}). {s.remainingText}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function WindowScene({ value }: { value: { opensAt: number | null; closesAt: number | null } }) {
  const phase = useSceneClock(WINDOW_CYCLE_MS);
  const s = windowStory(phase, value.opensAt !== null, value.closesAt !== null);
  return (
    <div className="absolute inset-0 bg-white p-3 text-[11px]">
      <div className="relative mx-1 mt-2 h-9">
        <div className="absolute inset-x-0 top-[13px] h-1 rounded bg-slate-200" />
        <div className="absolute top-[13px] h-1 rounded bg-emerald-300" style={{ left: pct(s.openPos ?? 0), right: pct(1 - (s.closePos ?? 1)) }} />
        {s.openPos !== null && (
          <>
            <span className="absolute top-[10px] size-2.5 -translate-x-1/2 rounded-full bg-green-600" style={{ left: pct(s.openPos) }} />
            <span className="absolute top-[22px] -translate-x-1/2 text-[8.5px] text-slate-500" style={{ left: pct(s.openPos) }}>
              abre
            </span>
          </>
        )}
        {s.closePos !== null && (
          <>
            <span className="absolute top-[10px] size-2.5 -translate-x-1/2 rounded-full bg-slate-600" style={{ left: pct(s.closePos) }} />
            <span className="absolute top-[22px] -translate-x-1/2 text-[8.5px] text-slate-500" style={{ left: pct(s.closePos) }}>
              cierra
            </span>
          </>
        )}
        {s.openPos === null && s.closePos === null && (
          <span className="absolute left-1/2 top-[22px] -translate-x-1/2 text-[8.5px] font-bold text-green-700">siempre abierto</span>
        )}
        <span className="absolute top-0 h-[26px] w-0.5 bg-cta transition-[left] duration-100 ease-linear" style={{ left: pct(s.todayPos) }}>
          <span className="absolute -left-2 -top-3 text-[8.5px] font-extrabold text-cta">hoy</span>
        </span>
      </div>
      <div className="mt-2 rounded-lg border p-2.5">
        <div className="flex items-center gap-2">
          <KindChip kind="exam" />
          <b className="truncate text-[12px]">Evaluación parcial — Clases de fuego</b>
        </div>
        <div key={s.stage} className="mt-2 min-h-[54px] animate-in fade-in duration-300">
          {s.stage === "before" && value.opensAt !== null && (
            <p className="rounded-md border bg-slate-50 px-2 py-1.5 text-[10.5px]">🗓 {dot(`Este examen abre el ${fmtDate(value.opensAt)}`)}</p>
          )}
          {s.stage === "open" && (
            <div className="space-y-1.5">
              {value.closesAt !== null && (
                <p className="text-[10px] text-slate-600">
                  <b>Cierra:</b> {fmtDate(value.closesAt)}
                </p>
              )}
              <MiniButton variant="primary">Comenzar intento</MiniButton>
            </div>
          )}
          {s.stage === "after" && value.closesAt !== null && (
            <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[10.5px] text-red-700">
              ⚠ {dot(`Este examen cerró el ${fmtDate(value.closesAt)}`)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TimeLimitScene({ value }: { value: { minutes: number | null } }) {
  const phase = useSceneClock(TIME_CYCLE_MS);
  const s = timeLimitStory(phase, value.minutes);
  return (
    <div className="absolute inset-0 flex flex-col bg-white text-[11px]">
      {s.submitted ? (
        <div className="flex flex-1 animate-in fade-in flex-col items-center justify-center gap-1.5 p-3 text-center duration-300">
          <span className="flex size-10 items-center justify-center rounded-full bg-indigo-50 text-[18px]" aria-hidden>
            📨
          </span>
          <b className="text-[12.5px]">Tu examen fue enviado</b>
          <span className="rounded-md border border-dashed border-cta px-1.5 py-0.5 text-[9.5px] font-bold text-cta">
            {s.expired ? `se envió con ${s.answered} de 5 respuestas` : "contestó las 5 preguntas"}
          </span>
        </div>
      ) : (
        <>
          <MiniExamBar index={Math.min(5, s.answered + 1)} total={5} timer={s.remaining === null ? null : timerText(s.remaining)} level={s.level} />
          <div key={s.answered} className="flex-1 animate-in fade-in p-3 duration-200">
            <MiniQuestion prompt="¿Qué agente usas en un fuego clase C?" options={["Agua", "CO₂", "Espuma"]} picked={null} />
          </div>
          <div className="flex justify-end border-t px-2.5 py-1.5">
            <MiniButton variant="primary">Enviar examen</MiniButton>
          </div>
        </>
      )}
      <MiniToast show={s.toast}>Se acabó el tiempo — tu intento se envió automáticamente</MiniToast>
    </div>
  );
}

export function PassingScene({ value }: { value: { passScore: number | null } }) {
  const phase = useSceneClock(PASSING_CYCLE_MS);
  const s = passingStory(phase, value.passScore);
  const passed = s.verdict === "pass" ? true : s.verdict === "fail" ? false : null;
  return (
    <div className="absolute inset-0 flex flex-col items-center gap-2 bg-white p-3 text-center">
      <p className="text-[10px] font-bold text-slate-500">Resultado · Intento {s.attempt + 1}</p>
      <MiniScoreRing key={s.attempt} className="size-20" percent={s.score} fill={s.fill} passed={passed} />
      <div className="relative h-2 w-4/5 rounded bg-slate-100">
        <span
          className={cn("absolute inset-y-0 left-0 rounded transition-[width] duration-100 ease-linear", passed === false ? "bg-red-500" : passed ? "bg-green-500" : "bg-cta")}
          style={{ width: `${s.score * s.fill}%` }}
        />
        {value.passScore !== null && <span className="absolute -top-1 h-4 w-0.5 bg-slate-900" style={{ left: `calc(${value.passScore}% - 1px)` }} />}
      </div>
      <p className={cn("min-h-[32px] text-[11.5px] font-bold leading-snug transition-opacity duration-300", s.verdict ? "opacity-100" : "opacity-0")}>
        {s.verdict === "pass"
          ? `¡Aprobado! Superaste el mínimo de ${value.passScore}%.`
          : s.verdict === "fail"
            ? `No alcanzaste el mínimo de ${value.passScore}%.`
            : "Tu examen fue calificado."}
      </p>
    </div>
  );
}

export function ResultsScene({ value }: { value: { mode: ResultsMode } }) {
  const phase = useSceneClock(RESULTS_CYCLE_MS);
  const s = resultsStory(phase, value.mode);
  return (
    <div className="absolute inset-0 flex flex-col bg-white text-[11px]">
      {s.stage !== "sent" ? (
        <>
          <MiniExamBar index={5} total={5} timer={null} />
          <div className="flex-1 p-3">
            <MiniQuestion prompt="¿Cuál es la técnica para usar el extintor?" options={["PASS", "PARE", "PISA"]} picked={0} />
          </div>
          <div className="flex justify-end border-t px-2.5 py-1.5">
            <MiniButton variant="primary">Enviar examen</MiniButton>
          </div>
          {s.stage === "confirm" && (
            <div className="absolute inset-0 flex animate-in fade-in items-center justify-center bg-slate-900/40 p-4 duration-200">
              <div className="w-full rounded-lg bg-white p-3 shadow-lg">
                <b className="block text-[12px]">¿Enviar examen?</b>
                <p className="mt-1 text-[10px] text-slate-500">Respondiste 5 de 5 preguntas.</p>
                <p className="text-[10px] text-slate-500">Esta acción no se puede deshacer.</p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <MiniButton>Cancelar</MiniButton>
                  <MiniButton variant="primary">Enviar examen</MiniButton>
                </div>
              </div>
            </div>
          )}
        </>
      ) : value.mode === "immediately" ? (
        <div className="flex flex-1 animate-in fade-in flex-col items-center justify-center gap-1.5 p-3 text-center duration-300">
          <MiniScoreRing className="size-20" percent={85} passed />
          <b className="text-[11.5px]">¡Aprobado! Superaste el mínimo de 80%.</b>
          <span className="text-[9.5px] text-slate-500">Desglose por pregunta ▾</span>
        </div>
      ) : (
        <div className="flex flex-1 animate-in fade-in flex-col items-center justify-center gap-1.5 p-3 text-center duration-300">
          <span className="flex size-11 items-center justify-center rounded-full bg-indigo-50 text-[18px]" aria-hidden>
            {value.mode === "after_close" ? "🗓" : "🕒"}
          </span>
          <b className="text-[12.5px]">Tu examen fue enviado</b>
          <p className="max-w-[92%] text-[10px] leading-snug text-slate-500">
            {value.mode === "after_close"
              ? dot(`Los resultados estarán disponibles el ${fmtDate(EXAMPLE_CLOSES)}`)
              : "Tu instructor decidirá cuándo publicar los resultados."}
          </p>
          <p className="rounded-md border px-2 py-1 text-[10px]">
            Intentos anteriores ·{" "}
            {s.gradeVisible ? (
              <>
                <b className="animate-in fade-in duration-500">#1 — 85%</b>{" "}
                <span className="text-cta">
                  {value.mode === "after_close" ? "(el examen ya cerró)" : "(el instructor los publicó)"}
                </span>
              </>
            ) : (
              <span className="text-slate-500">#1 — resultados pendientes</span>
            )}
          </p>
          {s.publishing && (
            <div className="absolute bottom-2 right-2 flex animate-in fade-in items-center gap-1.5 rounded-md border bg-white px-2 py-1 shadow-md duration-200">
              <span className="text-[9.5px] text-slate-500">Instructor</span>
              <MiniButton variant="primary">Publicar resultados</MiniButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
