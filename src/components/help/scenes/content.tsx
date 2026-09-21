"use client";

import { cn } from "@/lib/utils";
import { KindChip } from "@/components/kind-meta";
import { useSceneClock } from "../use-scene-clock";
import { MiniButton } from "../mini/basics";
import { MiniLessonRow } from "../mini/course";
import { MiniCursor } from "../mini/cursor";
import { MiniDocPage, MiniSegments, MiniTimerPill } from "../mini/doc";
import { MiniCheck, MiniRing } from "../mini/icons";
import type { HelpValues } from "../topics";
import {
  DOC_CYCLE_MS,
  docSecondsStory,
  REQUIRED_CYCLE_MS,
  requiredStory,
  RESOURCE_LINK_CYCLE_MS,
  resourceLinkStory,
  TEXT_CYCLE_MS,
  textSecondsStory,
} from "./content.story";

export function DocSecondsScene({ value }: { value: HelpValues["content.docSeconds"] }) {
  const phase = useSceneClock(DOC_CYCLE_MS);
  const s = docSecondsStory(phase, value.seconds);
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center gap-2 border-b bg-white px-2.5 py-1.5 text-[11px]">
        <span className="rounded-md bg-kind-document-tint px-1.5 py-0.5 text-[9.5px] font-extrabold text-kind-document">▤ DOC</span>
        <span className="min-w-0 flex-1 truncate font-bold">Manual del participante</span>
        <MiniTimerPill remaining={s.remaining} total={s.total} done={s.pageDone} doneLabel="Página leída" />
      </div>
      <MiniSegments total={4} done={1} filling={s.segmentFill} />
      <div className="flex flex-1 items-start justify-center pt-1.5">
        <MiniDocPage title="Clases de fuego" />
      </div>
      <div className="flex justify-between border-t bg-white px-2.5 py-1.5">
        <MiniButton>‹ Anterior</MiniButton>
        <MiniButton variant={s.nextEnabled ? "primary" : "disabled"} glow={s.glow}>
          Siguiente ›
        </MiniButton>
      </div>
    </div>
  );
}

const TEXT_LINES = [92, 86, 95, 70, 88, 80, 64];

export function TextSecondsScene({ value }: { value: { seconds: number } }) {
  const phase = useSceneClock(TEXT_CYCLE_MS);
  const s = textSecondsStory(phase, value.seconds);
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <div className="border-b px-2.5 py-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <KindChip kind="text" />
          <span className="min-w-0 flex-1 truncate font-bold">Bienvenida y objetivos</span>
          <MiniTimerPill remaining={s.remaining} total={s.total} done={s.done} doneLabel="Lectura completada" />
        </div>
        <div className={cn("mt-1.5 h-1 overflow-hidden rounded bg-slate-100 transition-opacity duration-300", s.done && "opacity-0")}>
          <span className="block h-full rounded bg-cta transition-[width] duration-100 ease-linear" style={{ width: `${s.percent}%` }} />
        </div>
      </div>
      <div className="flex-1 space-y-2 px-4 pt-3">
        {TEXT_LINES.map((w, i) => (
          <span key={i} className="block h-[5px] rounded bg-slate-200" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="px-4 pb-3">
        <MiniButton variant="primary" className={cn(s.showContinue ? "scale-100 opacity-100" : "scale-90 opacity-0")}>
          Continuar ›
        </MiniButton>
      </div>
    </div>
  );
}

const REQUIRED_DONE = [
  { title: "Bienvenida y objetivos", meta: "Lectura" },
  { title: "Manual del participante", meta: "Documento" },
  { title: "Evaluación parcial", meta: "Examen" },
] as const;

export function RequiredScene({ value }: { value: { required: boolean } }) {
  const phase = useSceneClock(REQUIRED_CYCLE_MS);
  const s = requiredStory(phase);
  const optional = s.mode === "optional";
  const mine = value.required ? "required" : "optional";
  const complete = s.percent === 100;
  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-2.5">
      <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px]">
        <MiniRing className="size-5" progress={s.percent / 100} color={complete ? "#16a34a" : "#4f46e5"} track={complete ? "#bbf7d0" : "#e0e7ff"} />
        <b>Avance del curso</b>
        <span className="ml-auto tabular-nums text-slate-500">
          {s.done} de {s.total} lecciones · <b className={complete ? "text-green-600" : "text-slate-900"}>{s.percent}%</b>
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {REQUIRED_DONE.map((lesson) => (
          <MiniLessonRow key={lesson.title} dense title={lesson.title} meta={lesson.meta} state="done" />
        ))}
        <div className="relative">
          <div className={cn("transition-opacity duration-500", optional && "opacity-60")}>
            <MiniLessonRow dense title="Video de repaso" meta={optional ? "Video · no cuenta para el avance" : "Video · pendiente"} state="open" />
          </div>
          <span
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[9px] font-extrabold transition-colors duration-300",
              optional ? "bg-slate-100 text-slate-500" : "bg-indigo-100 text-cta"
            )}
          >
            {optional ? "Opcional" : "Requerido"}
            {s.mode === mine && (
              <span className="absolute -right-1 -top-2.5 whitespace-nowrap rounded-full bg-cta px-1 text-[7px] font-bold text-white">tu ajuste</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ResourceLinkScene({ value }: { value: { kind: "resource" | "link" } }) {
  const phase = useSceneClock(RESOURCE_LINK_CYCLE_MS);
  const s = resourceLinkStory(phase);
  const isLink = value.kind === "link";
  return (
    <div className="absolute inset-0 space-y-2.5 bg-white p-3 text-[11px]">
      <div className="flex items-center gap-2">
        <KindChip kind={value.kind} size="md" />
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[12px]">{isLink ? "Tabla de clases de fuego" : "Hoja de datos de seguridad"}</b>
          <span className="text-[9.5px] text-slate-500">{isLink ? "stps.gob.mx" : "1 archivo"}</span>
        </span>
        {!isLink && (
          <span className={cn("flex items-center gap-1 text-[10.5px] font-semibold text-green-600 transition-opacity duration-300", s.done ? "opacity-100" : "opacity-0")}>
            <MiniCheck className="size-3.5" /> Visto
          </span>
        )}
      </div>
      {isLink ? (
        <div className="rounded-lg border p-2.5">
          <p className="text-[10px] text-slate-600">Consulta la tabla oficial antes del examen.</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="relative shrink-0">
              <MiniButton variant="primary" className={cn(s.pressed && "scale-95")}>
                ↗ Abrir enlace
              </MiniButton>
              <MiniCursor at={s.cursorAtButton} pressed={s.pressed} />
            </span>
            {s.done ? (
              <span className="flex items-center gap-1 text-[10.5px] font-semibold text-green-600">
                <MiniCheck className="size-3.5" /> Visto
              </span>
            ) : (
              <span className="text-[9.5px] leading-tight text-slate-500">Se abre en una pestaña nueva y se marca como visto.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="flex size-7 items-center justify-center rounded bg-red-50 text-[8px] font-extrabold text-red-600">PDF</span>
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[10.5px]">Hoja-seguridad-CO2.pdf</b>
              <span className="text-[9px] text-slate-500">240 KB</span>
            </span>
            <span className="relative shrink-0">
              <MiniButton className={cn(s.pressed && "scale-95")}>⤓ Descargar</MiniButton>
              <MiniCursor at={s.cursorAtButton} pressed={s.pressed} />
            </span>
          </div>
          <p className={cn("border-t px-2.5 py-1.5 text-[9.5px] text-slate-500 transition-opacity duration-300", s.done && "opacity-0")}>
            Descarga cualquiera para marcar este recurso como visto.
          </p>
        </div>
      )}
      <MiniButton variant="primary" className={cn(s.showNext ? "scale-100 opacity-100" : "scale-90 opacity-0")}>
        Siguiente lección ›
      </MiniButton>
    </div>
  );
}
