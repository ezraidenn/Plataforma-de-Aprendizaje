"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "../use-scene-clock";
import { MiniBadge, MiniButton } from "../mini/basics";
import { MiniCursor } from "../mini/cursor";
import {
  OPEN_ANSWER,
  OPEN_CYCLE_MS,
  openQuestionStory,
  ORDERING_CYCLE_MS,
  ORDERING_STEPS,
  orderingStory,
  POOL_CYCLE_MS,
  poolStory,
  SHUFFLE_CYCLE_MS,
  SHUFFLE_QUESTIONS,
  shuffleStory,
} from "./exam-bank.story";

const ROW_H = 30;
/** Color de cada pregunta para seguirla con la vista al barajar */
const QUESTION_DOTS = ["bg-red-400", "bg-amber-400", "bg-sky-400", "bg-violet-400"];

function StudentOrder({ name, order, revealed }: { name: string; order: readonly number[]; revealed: number }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border bg-white p-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold">
        <span className="flex size-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] text-cta">{name[0]}</span>
        {name}
      </p>
      <div className="relative" style={{ height: ROW_H * SHUFFLE_QUESTIONS.length }}>
        {SHUFFLE_QUESTIONS.map((question, qi) => {
          const pos = order.indexOf(qi);
          return (
            <div
              key={question}
              className={cn(
                "absolute inset-x-0 flex items-center gap-1.5 rounded-md border bg-white px-1.5 text-[9.5px] transition-all duration-700 ease-out",
                pos < revealed ? "opacity-100" : "opacity-0"
              )}
              style={{ top: pos * ROW_H, height: ROW_H - 4 }}
            >
              <b className="w-3 text-slate-400">{pos + 1}.</b>
              <span className={cn("size-2 shrink-0 rounded-full", QUESTION_DOTS[qi])} />
              <span className="truncate">{question}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ShuffleScene({ value }: { value: { shuffle: boolean } }) {
  const phase = useSceneClock(SHUFFLE_CYCLE_MS);
  const s = shuffleStory(phase, value.shuffle);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-slate-50 p-3">
      <div className="flex gap-2.5">
        <StudentOrder name="Laura" order={s.orders[0]} revealed={s.revealed} />
        <StudentOrder name="Carlos" order={s.orders[1]} revealed={s.revealed} />
      </div>
      <span
        className={cn(
          "self-center rounded-md border border-dashed border-cta bg-white px-1.5 py-0.5 text-[9.5px] font-bold text-cta transition-opacity duration-300",
          s.revealed === 4 ? "opacity-100" : "opacity-0"
        )}
      >
        {s.mixed ? "mismas preguntas, distinto orden" : "mismo orden para todos"}
      </span>
    </div>
  );
}

export function PoolScene({ value }: { value: { draw: number | null; bank: number } }) {
  const phase = useSceneClock(POOL_CYCLE_MS);
  const s = poolStory(phase, value.draw, value.bank);
  return (
    <div className="absolute inset-0 space-y-2 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between">
        <b>Banco de preguntas · {value.bank}</b>
        <span key={s.attempt} className="animate-in fade-in rounded-full bg-indigo-50 px-2 py-0.5 text-[9.5px] font-extrabold text-cta duration-300">
          Intento {s.attempt}
        </span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: s.cards }, (_, i) => {
          const picked = s.picked.includes(i);
          return (
            <span
              key={i}
              className={cn(
                "flex aspect-[3/4] items-center justify-center rounded border text-[8px] font-bold transition-all duration-300",
                picked ? "-translate-y-0.5 border-cta bg-cta text-white shadow" : "bg-slate-50 text-slate-400"
              )}
            >
              {i + 1}
            </span>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-600">
        {s.allUsed ? `Cada intento usa las ${s.cards} preguntas.` : `Salen ${s.picked.length} de ${s.target} al azar en este intento.`}
      </p>
    </div>
  );
}

export function OpenQuestionScene() {
  const phase = useSceneClock(OPEN_CYCLE_MS);
  const s = openQuestionStory(phase);
  return (
    <div className="absolute inset-0 grid grid-cols-[1.35fr_1fr] gap-2 bg-slate-50 p-2.5 text-[11px]">
      <div className="flex min-w-0 flex-col rounded-lg border bg-white">
        <p className="border-b px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-500">El alumno</p>
        {s.sent ? (
          <div className="flex flex-1 animate-in fade-in flex-col items-center justify-center gap-1 p-2 text-center duration-300">
            <b className="text-[11px]">Tu examen fue enviado</b>
            <span className="text-[9.5px] leading-snug text-slate-500">Tu instructor revisará las preguntas abiertas — te avisaremos aquí.</span>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-1.5 p-2">
            <b className="text-[10.5px] leading-snug">Describe cómo usar el extintor (técnica PASS).</b>
            <div className="flex-1 rounded-md border p-1.5 text-[9.5px] leading-snug text-slate-700">
              {OPEN_ANSWER.slice(0, s.typed)}
              <span className="animate-pulse">|</span>
            </div>
            <MiniButton variant="primary" className="self-end">
              Enviar examen
            </MiniButton>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col rounded-lg border bg-white">
        <p className="border-b px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-500">Tú</p>
        <div className="space-y-1.5 p-2">
          <div className="flex items-center justify-between rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold">
            <span>📋 Por calificar</span>
            <span key={s.queue} className="animate-in zoom-in rounded-full bg-cta px-1.5 text-[9px] text-white duration-300">
              {s.queue}
            </span>
          </div>
          <div className={cn("rounded-md border px-2 py-1 transition-all duration-500", s.rowVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0")}>
            <b className="block truncate text-[10px]">Laura Pérez</b>
            <span className="block truncate text-[9px] text-slate-500">Evaluación parcial · Texto abierto</span>
          </div>
          <div className="rounded-md border px-2 py-1 opacity-60">
            <b className="block truncate text-[10px]">Carlos Sánchez</b>
            <span className="block truncate text-[9px] text-slate-500">Plan de evacuación · Tarea</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Alto de cada renglón de la escena de «ordenar» (px) */
const ORDER_ROW_H = 34;

/**
 * Ordenar pasos: los pasos se reacomodan (se deslizan a su nuevo lugar) y al
 * final se ve el puntaje por pares, con el par roto en rojo.
 */
export function OrderingScene() {
  const phase = useSceneClock(ORDERING_CYCLE_MS);
  const s = orderingStory(phase);
  const positionOf = new Map(s.order.map((step, pos) => [step, pos]));
  const percent = Math.round((s.pairsOk / s.pairsTotal) * 100);

  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <b className="text-[11.5px] leading-snug">Ordena los pasos para usar el extintor</b>

      <div className="relative" style={{ height: ORDER_ROW_H * ORDERING_STEPS.length }}>
        {ORDERING_STEPS.map((text, step) => {
          const pos = positionOf.get(step) ?? step;
          const moving = s.moving === step;
          // El paso siguiente en el orden correcto quedó justo debajo: par bien
          const nextOk = step < ORDERING_STEPS.length - 1 && positionOf.get(step + 1) === pos + 1;
          return (
            <div
              key={text}
              className={cn(
                "absolute inset-x-0 flex h-[30px] items-center gap-2 rounded-md border bg-white px-2 transition-[top,box-shadow] duration-500",
                moving && "z-10 border-cta shadow-md"
              )}
              style={{ top: pos * ORDER_ROW_H }}
            >
              <span className="w-3 text-center text-[10px] font-bold tabular-nums text-slate-400">{pos + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{text}</span>
              <span className="text-[10px] text-slate-400">↑ ↓</span>
              {moving && <MiniCursor at pressed />}
              {s.graded && step < ORDERING_STEPS.length - 1 && (
                <span
                  className={cn(
                    "ml-1 rounded px-1 text-[9px] font-extrabold",
                    nextOk ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600"
                  )}
                  title="Par con el paso siguiente"
                >
                  {nextOk ? "par ✓" : "par ✗"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[9.5px] leading-snug text-slate-500">
          {s.graded ? "«Jalar el seguro» quedó al final: solo rompe su par." : "Arrastra o usa las flechas."}
        </span>
        {s.graded && (
          <MiniBadge tone="warn">
            {s.pairsOk} de {s.pairsTotal} pares → {percent}% de los puntos
          </MiniBadge>
        )}
      </div>
    </div>
  );
}
