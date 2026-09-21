"use client";

import { CircleCheck, Eye, FileQuestion, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { KindChip } from "@/components/kind-meta";
import { useSceneClock } from "../use-scene-clock";
import { MiniCheck, MiniOpen } from "../mini/icons";
import { MiniLessonRow } from "../mini/course";
import { MiniConditionBar, MiniConditionCard, MiniConditionState } from "../mini/rules";
import type { HelpValues } from "../topics";
import {
  ALL_ITEMS,
  ALL_ITEMS_CYCLE_MS,
  ALL_ITEMS_REQUIRED,
  allItemsStory,
  AVERAGE_CYCLE_MS,
  AVERAGE_EXAMS,
  AVERAGE_VALUE,
  EXAMS_MIN,
  examAverageStory,
  examSpecificStory,
  operatorStory,
  RULES_CYCLE_MS,
  SPECIFIC_CYCLE_MS,
  SPECIFIC_EXAMS,
  SPECIFIC_INDEX,
  VIEWING_CYCLE_MS,
  VIEWING_LESSONS,
  viewingStory,
} from "./rules.story";

export function OperatorScene({ value }: { value: HelpValues["rules.operator"] }) {
  const phase = useSceneClock(RULES_CYCLE_MS);
  const s = operatorStory(phase);
  return (
    <div className="absolute inset-0 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between font-bold">
        Deben cumplirse:
        <span className="inline-flex gap-0.5 rounded-full bg-slate-100 p-0.5 text-[10.5px] font-extrabold">
          {(["AND", "OR"] as const).map((op) => (
            <span
              key={op}
              className={cn(
                "relative rounded-full px-2.5 py-0.5 transition-all duration-300",
                s.activeOp === op ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              )}
            >
              {op === "AND" ? "Y · todas" : "O · una"}
              {value.op === op && (
                <span className="absolute -right-1 -top-2.5 rounded-full bg-cta px-1 text-[7px] font-bold text-white">tu regla</span>
              )}
            </span>
          ))}
        </span>
      </div>
      <MiniConditionBar label="Ver el contenido (mínimo 100%)" value={s.viewing} min={100} mark={s.viewingMark} />
      <MiniConditionBar label={`Promedio de exámenes (mínimo ${EXAMS_MIN}%)`} value={s.exams} min={EXAMS_MIN} mark={s.examsMark} />
      <div className="relative mt-2.5 h-10">
        <div
          className={cn(
            "absolute inset-0 flex items-center gap-2 rounded-lg bg-red-50 px-2.5 font-bold text-red-700 transition-opacity duration-300",
            s.result === "fail" ? "opacity-100" : "opacity-0"
          )}
        >
          ✗ Aún no aprueba · falta el promedio de exámenes
        </div>
        <div
          className={cn(
            "absolute inset-0 flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 font-bold text-green-700 transition-opacity duration-300",
            s.result === "pass" ? "opacity-100" : "opacity-0"
          )}
        >
          🏅 ¡Aprobado! Se emite su certificado
        </div>
      </div>
    </div>
  );
}

export function ViewingScene({ value }: { value: { min: number } }) {
  const phase = useSceneClock(VIEWING_CYCLE_MS);
  const s = viewingStory(phase, value.min);
  return (
    <div className="absolute inset-0 space-y-2.5 bg-white p-3 text-[11px]">
      <MiniConditionCard Icon={Eye} title="Ver todo el contenido requerido" detail={`al ${value.min}%`} passed={s.passed ? true : null} />
      <div className="flex gap-1.5">
        {Array.from({ length: VIEWING_LESSONS }, (_, i) => (
          <span
            key={i}
            className={cn(
              "flex h-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border text-[9px] transition-colors duration-300",
              i < s.lessonsDone ? "border-green-200 bg-green-50 text-green-700" : "bg-slate-50 text-slate-400"
            )}
          >
            {i < s.lessonsDone ? <MiniCheck className="size-3.5" /> : <MiniOpen className="size-3.5" />}
            Lección {i + 1}
          </span>
        ))}
      </div>
      <MiniConditionBar label="Contenido visto" value={s.value} min={value.min} mark={s.passed} showValue />
    </div>
  );
}

export function ExamAverageScene({ value }: { value: { min: number } }) {
  const phase = useSceneClock(AVERAGE_CYCLE_MS);
  const s = examAverageStory(phase, value.min);
  return (
    <div className="absolute inset-0 space-y-2 bg-white p-3 text-[11px]">
      <MiniConditionCard Icon={FileQuestion} title="Promedio de exámenes" detail={`mínimo ${value.min}%`} passed={s.passed} />
      {AVERAGE_EXAMS.map((exam, i) => (
        <div
          key={exam.title}
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-all duration-300",
            i < s.shown ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0"
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <KindChip kind="exam" />
            <span className="truncate">{exam.title}</span>
          </span>
          <b className="tabular-nums">{exam.score}%</b>
        </div>
      ))}
      <div
        className={cn(
          "flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 font-bold transition-opacity duration-300",
          s.average === null ? "opacity-0" : "opacity-100"
        )}
      >
        <span>
          Promedio: ({AVERAGE_EXAMS.map((e) => e.score).join(" + ")}) ÷ {AVERAGE_EXAMS.length}
        </span>
        <span className={cn("tabular-nums", s.passed === false ? "text-red-600" : s.passed ? "text-green-600" : "text-slate-900")}>
          = {AVERAGE_VALUE}%
        </span>
      </div>
    </div>
  );
}

export function ExamSpecificScene({ value }: { value: { min: number } }) {
  const phase = useSceneClock(SPECIFIC_CYCLE_MS);
  const s = examSpecificStory(phase, value.min);
  return (
    <div className="absolute inset-0 space-y-2 bg-white p-3 text-[11px]">
      <MiniConditionCard Icon={Target} title="Un examen específico" detail={`Examen final · mínimo ${value.min}%`} passed={s.passed} />
      {SPECIFIC_EXAMS.map((exam, i) => {
        const chosen = i === SPECIFIC_INDEX;
        return (
          <div
            key={exam.title}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-all duration-300",
              s.focus && chosen && "border-cta bg-indigo-50 shadow-[0_0_0_3px_rgb(79_70_229/0.15)]",
              s.focus && !chosen && "opacity-40"
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <KindChip kind="exam" />
              <span className="truncate">{exam.title}</span>
            </span>
            <span className="shrink-0 text-[9.5px]">
              {chosen ? (
                <b
                  className={cn(
                    "text-[11px] tabular-nums transition-colors duration-300",
                    s.passed === true && "text-green-600",
                    s.passed === false && "text-red-600"
                  )}
                >
                  {exam.score}%
                </b>
              ) : s.focus ? (
                "no cuenta aquí"
              ) : (
                `${exam.score}%`
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Posición de cada lección entre las requeridas (−1 si es opcional). */
const REQUIRED_POSITION = ALL_ITEMS.map((item, i) => (item.required ? ALL_ITEMS.slice(0, i).filter((x) => x.required).length : -1));

export function AllItemsScene() {
  const phase = useSceneClock(ALL_ITEMS_CYCLE_MS);
  const s = allItemsStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-2.5">
      <div className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-bold">
          <CircleCheck className="size-3.5 shrink-0 text-cta" aria-hidden />
          <span className="truncate">
            Completar lo requerido · {s.requiredDone} de {ALL_ITEMS_REQUIRED}
          </span>
        </span>
        <MiniConditionState passed={s.passed ? true : null} />
      </div>
      <div className="overflow-hidden rounded-lg border">
        {ALL_ITEMS.map((item, i) => {
          const done = REQUIRED_POSITION[i] >= 0 && REQUIRED_POSITION[i] < s.requiredDone;
          return (
            <MiniLessonRow
              key={item.title}
              dense
              title={item.title}
              meta={item.required ? `${item.meta} · requerido` : `${item.meta} · opcional, no bloquea`}
              state={done ? "done" : "open"}
            />
          );
        })}
      </div>
    </div>
  );
}
