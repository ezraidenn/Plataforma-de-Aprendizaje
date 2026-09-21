"use client";

import { formatClock } from "@/components/student/study-timer";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniButton } from "@/components/help/mini/basics";
import { MiniExamBar, MiniQuestion } from "@/components/help/mini/exam";
import { EXAM_RUN_CYCLE_MS, EXAM_RUN_TOTAL, examRunStory } from "./exam-run.story";

const QUESTIONS = [
  { prompt: "¿Cuál es la técnica para usar el extintor?", options: ["PASS", "PARE", "PISA"] },
  { prompt: "¿Qué clase de fuego es un corto circuito?", options: ["Clase A", "Clase C", "Clase K"] },
  { prompt: "¿A qué distancia te colocas del fuego?", options: ["1 m", "2 a 3 m", "10 m"] },
] as const;

/** Responder el examen: se guarda solo, el reloj corre y el envío se confirma. */
export function ExamRunScene() {
  const phase = useSceneClock(EXAM_RUN_CYCLE_MS);
  const s = examRunStory(phase);
  const q = QUESTIONS[Math.min(QUESTIONS.length - 1, s.index - 1)];

  return (
    <div className="absolute inset-0 flex flex-col bg-white text-[11px]">
      {s.stage === "sent" ? (
        <div className="flex flex-1 animate-in fade-in flex-col items-center justify-center gap-1.5 p-3 text-center duration-300">
          <span className="flex size-11 items-center justify-center rounded-full bg-indigo-50 text-[18px]" aria-hidden>
            📤
          </span>
          <b className="text-[12.5px]">Tu examen fue enviado</b>
          <p className="max-w-[92%] text-[10px] leading-snug text-slate-500">
            Tus respuestas se guardaron solas mientras contestabas.
          </p>
        </div>
      ) : (
        <>
          <MiniExamBar
            index={s.index}
            total={EXAM_RUN_TOTAL}
            timer={formatClock(s.secondsLeft)}
            level={s.secondsLeft < 8 * 60 ? "warn" : "normal"}
          />
          <div className="flex-1 p-3">
            <MiniQuestion prompt={q.prompt} options={q.options} picked={s.picked} />
          </div>
          <div className="flex items-center justify-between border-t px-2.5 py-1.5">
            <span className="text-[9.5px] text-slate-500">
              {s.answered} de {EXAM_RUN_TOTAL} respondidas
            </span>
            <MiniButton variant="primary">Enviar examen</MiniButton>
          </div>
          {s.stage === "confirm" && (
            <div className="absolute inset-0 flex animate-in fade-in items-center justify-center bg-slate-900/40 p-4 duration-200">
              <div className="w-full rounded-lg bg-white p-3 shadow-lg">
                <b className="block text-[12px]">¿Enviar examen?</b>
                <p className="mt-1 text-[10px] text-slate-500">
                  Respondiste {EXAM_RUN_TOTAL} de {EXAM_RUN_TOTAL} preguntas.
                </p>
                <p className="text-[10px] text-slate-500">Esta acción no se puede deshacer.</p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <MiniButton>Cancelar</MiniButton>
                  <MiniButton variant="primary">Enviar examen</MiniButton>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
