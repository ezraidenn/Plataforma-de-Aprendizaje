"use client";

import { Layers, Lock, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSceneClock } from "../use-scene-clock";
import { MiniButton, MiniToast } from "../mini/basics";
import { MiniCursor } from "../mini/cursor";
import { MiniAvatars, MiniStudentRow } from "../mini/people";
import {
  CLOSING_GROUP,
  GROUP_CLOSE_CYCLE_MS,
  GROUP_ROWS,
  groupCloseStory,
  IMPORT_CYCLE_MS,
  IMPORT_GROUP,
  IMPORT_MEMBERS,
  importStory,
  RENEWALS_CYCLE_MS,
  renewalsStory,
  TRASH_CYCLE_MS,
  trashStory,
  type CohortStatus,
} from "./people.story";

const CAPS = "text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-500";

/** Fila que se colapsa suavemente al ocultarse. */
function Collapse({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid transition-all duration-500", show ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export function GroupCloseScene({ value }: { value: { status: CohortStatus } }) {
  const phase = useSceneClock(GROUP_CLOSE_CYCLE_MS);
  const s = groupCloseStory(phase);
  const closed = s.stage === "closed";
  return (
    <div className="absolute inset-0 grid grid-cols-[1fr_1.25fr] gap-2.5 bg-slate-50 p-2.5 text-[11px]">
      <div className="flex min-w-0 flex-col rounded-lg border bg-white p-2.5">
        <div className="flex items-start justify-between gap-1">
          <span className={cn("flex size-7 items-center justify-center rounded-lg transition-colors", closed ? "bg-slate-100 text-slate-500" : "bg-indigo-50 text-cta")}>
            {closed ? <Lock className="size-3.5" aria-hidden /> : <Layers className="size-3.5" aria-hidden />}
          </span>
          <span className={cn("relative rounded-full px-1.5 py-0.5 text-[9px] font-extrabold transition-colors", closed ? "bg-slate-100 text-slate-500" : "bg-green-100 text-green-700")}>
            {closed ? "Cerrado" : "Abierto"}
            {value.status === s.stage && (
              <span className="absolute -right-1 -top-2.5 whitespace-nowrap rounded-full bg-cta px-1 text-[7px] font-bold text-white">tu grupo</span>
            )}
          </span>
        </div>
        <b className="mt-1.5 text-[11.5px] leading-tight">{CLOSING_GROUP}</b>
        <span className="text-[9.5px] text-slate-500">3 matrículas · 2 aprobados</span>
        <span className="mt-auto self-start pt-2">
          <MiniButton className={cn("px-2 py-1 text-[10px]", s.pressed && "scale-95")}>{closed ? "🔓 Reabrir" : "🔒 Cerrar grupo"}</MiniButton>
        </span>
      </div>
      <div className="flex min-w-0 flex-col rounded-lg border bg-white">
        <p className={cn(CAPS, "flex items-center justify-between border-b px-2.5 py-1.5")}>
          Estudiantes del curso <span className="tabular-nums">{s.visibleRows}</span>
        </p>
        <div>
          {GROUP_ROWS.map((row, i) => (
            <Collapse key={row.name} show={!closed || row.group !== CLOSING_GROUP}>
              <MiniStudentRow name={row.name} detail={row.group} percent={row.percent} tone={i} />
            </Collapse>
          ))}
        </div>
        <p className={cn("mt-auto border-t px-2.5 py-1 text-[9px] font-bold text-cta transition-opacity duration-300", closed ? "opacity-100" : "opacity-0")}>
          Nada se borra · se ven con «Todos (incl. cerrados)»
        </p>
      </div>
    </div>
  );
}

function CourseBox({ caption, title, children }: { caption: string; title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-white p-2">
      <p className="text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-slate-400">{caption}</p>
      <b className="block truncate text-[10.5px]">{title}</b>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function GroupBox({ members, highlight = false }: { members: readonly string[]; highlight?: boolean }) {
  return (
    <div className={cn("rounded-md border p-2 transition-colors duration-300", highlight && "border-cta bg-indigo-50")}>
      <p className="flex items-center gap-1 truncate text-[10px] font-bold">
        <Layers className="size-3 shrink-0 text-cta" aria-hidden />
        <span className="truncate">{IMPORT_GROUP}</span>
      </p>
      <div className="mt-1.5 flex min-h-5 items-center justify-between gap-1">
        <MiniAvatars names={members} />
        <span className="shrink-0 text-[9px] tabular-nums text-slate-500">
          {members.length} {members.length === 1 ? "alumno" : "alumnos"}
        </span>
      </div>
    </div>
  );
}

export function ImportScene() {
  const phase = useSceneClock(IMPORT_CYCLE_MS);
  const s = importStory(phase);
  return (
    <div className="absolute inset-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 bg-slate-50 p-3 text-[11px]">
      <CourseBox caption="Otro de tus cursos" title="Primeros Auxilios Básicos">
        <GroupBox members={IMPORT_MEMBERS} highlight={s.selected} />
        <p className="mt-1 text-[9px] font-bold text-green-700">el original no cambia</p>
      </CourseBox>
      <span className={cn("text-[18px] text-cta transition-opacity duration-300", s.groupCreated ? "opacity-100" : "opacity-25")} aria-hidden>
        ➜
      </span>
      <CourseBox caption="Este curso" title="Uso y Manejo de Extintores">
        <div className={cn("transition-all duration-500", s.groupCreated ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}>
          <GroupBox members={IMPORT_MEMBERS.slice(0, s.copied)} />
          <p className="mt-1 text-[9px] text-slate-500">mismo nombre de grupo</p>
        </div>
      </CourseBox>
    </div>
  );
}

export function TrashScene() {
  const phase = useSceneClock(TRASH_CYCLE_MS);
  const s = trashStory(phase);
  const inList = s.stage === "list" || s.stage === "restored";
  return (
    <div className="absolute inset-0 bg-slate-50 p-2.5 text-[11px]">
      <div className="flex items-center justify-between">
        <b>Estudiantes del curso</b>
        <span className={cn("rounded-md border bg-white px-2 py-1 text-[10px] font-bold transition-colors duration-300", s.trashCount > 0 && "border-cta text-cta")}>
          🗑 Papelera ({s.trashCount})
        </span>
      </div>
      <div className="mt-2 overflow-hidden rounded-lg border bg-white">
        <Collapse show={inList}>
          <MiniStudentRow
            name="Laura Pérez"
            detail="Generación Agosto 2026"
            percent={100}
            action={
              <span className="relative shrink-0">
                <span className={cn("flex size-5 items-center justify-center rounded text-slate-500", s.pressed && s.cursorAt === "remove" && "bg-red-50 text-red-600")}>
                  <UserMinus className="size-3.5" aria-hidden />
                </span>
                <MiniCursor at={s.cursorAt === "remove"} pressed={s.pressed} />
              </span>
            }
          />
        </Collapse>
        <MiniStudentRow name="Carlos Sánchez" detail="Generación Agosto 2026" percent={60} tone={4} />
        <MiniStudentRow name="Mónica Aguilar" detail="Generación 2025" percent={40} tone={3} />
      </div>
      <div
        className={cn(
          "absolute inset-y-2.5 right-2.5 w-[64%] rounded-lg border bg-white p-2 shadow-lg transition-all duration-500",
          s.stage === "sheet" ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-4 opacity-0"
        )}
      >
        <b className="block text-[11px]">🗑 Papelera del curso</b>
        <p className="text-[9px] leading-snug text-slate-500">Nada se borró: puedes devolverlos cuando quieras.</p>
        <div className="mt-2 rounded-md border p-1.5">
          <b className="block text-[10px]">Laura Pérez</b>
          <span className="block text-[9px] text-slate-500">Estaba: Aprobado · CERT-2026-000123</span>
          <span className="relative mt-1 inline-block">
            <MiniButton className={cn("px-2 py-0.5 text-[9.5px]", s.pressed && s.cursorAt === "restore" && "scale-95")}>↺ Restaurar</MiniButton>
            <MiniCursor at={s.cursorAt === "restore"} pressed={s.pressed} />
          </span>
        </div>
      </div>
      <MiniToast show={s.stage === "removed" || s.stage === "restored"}>
        {s.stage === "removed" ? "Se quitó a Laura Pérez del curso" : "Laura Pérez volvió al curso tal como estaba"}
      </MiniToast>
    </div>
  );
}

function RenewRow({ name, detail, selected }: { name: string; detail: string; selected: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 border-t border-slate-100 px-2.5 py-1.5 text-[10.5px] transition-colors duration-300", selected && "bg-indigo-50")}>
      <span className={cn("size-3 shrink-0 rounded-sm border transition-colors", selected && "border-cta bg-cta")} />
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block truncate">{name}</b>
        <span className="block truncate text-[9px] text-slate-500">{detail}</span>
      </span>
    </div>
  );
}

export function RenewalsScene() {
  const phase = useSceneClock(RENEWALS_CYCLE_MS);
  const s = renewalsStory(phase);
  const selecting = s.stage === "renewing" || s.stage === "dismissing";
  const count = (s.laura === "row" ? 1 : 0) + (s.ernesto === "gone" ? 0 : 1);
  return (
    <div className="absolute inset-0 bg-slate-50 p-2.5 text-[11px]">
      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="flex min-h-[30px] items-center gap-1.5 border-b px-2 py-1">
          {selecting ? (
            <>
              <span className="rounded-full bg-indigo-50 px-1.5 text-[9px] font-bold text-cta">1 seleccionado</span>
              <MiniButton variant="primary" className={cn("px-2 py-0.5 text-[9.5px]", s.stage === "renewing" && "ring-2 ring-cta/30")}>
                ↺ Reinscribir
              </MiniButton>
              <MiniButton className={cn("px-2 py-0.5 text-[9.5px]", s.stage === "dismissing" && "ring-2 ring-cta/30")}>Descartar</MiniButton>
            </>
          ) : (
            <span className="text-[9.5px] text-slate-500">
              <b className="text-slate-900">{count}</b> certificados vencidos. Selecciona para reinscribir o descartar.
            </span>
          )}
        </div>
        <Collapse show={s.laura === "row"}>
          <RenewRow name="Laura Pérez" detail="Uso y Manejo de Extintores · venció 31 dic 2025" selected={s.stage === "renewing"} />
        </Collapse>
        <Collapse show={s.ernesto !== "gone"}>
          <RenewRow name="Ernesto Salazar" detail="Uso y Manejo de Extintores · venció 31 dic 2025" selected={s.stage === "dismissing"} />
        </Collapse>
      </div>
      <div className={cn("mt-2 rounded-lg border bg-white p-2 transition-all duration-500", s.laura === "cycle2" ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}>
        <b className="block text-[10.5px]">Laura Pérez · Uso y Manejo de Extintores</b>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-extrabold text-cta">Ciclo 2 · 0%</span>
          <span className="text-[9px] text-slate-500">Historial: CERT-2025-000123 (ciclo 1)</span>
        </div>
      </div>
      <p className={cn("mt-1.5 text-[9px] font-bold text-cta transition-opacity duration-300", s.ernesto === "gone" ? "opacity-100" : "opacity-0")}>
        Ernesto sale del panel y queda en el historial con su motivo
      </p>
      {s.ernesto === "dialog" && (
        <div className="absolute inset-0 flex animate-in fade-in items-center justify-center bg-slate-900/40 p-4 duration-200">
          <div className="w-full rounded-lg bg-white p-3 shadow-lg">
            <b className="block text-[12px]">Descartar a Ernesto Salazar</b>
            <p className="mt-1 text-[9.5px] leading-snug text-slate-500">No se revoca nada: el certificado sigue siendo auténtico y verificable.</p>
            <p className="mt-1.5 rounded-md border border-cta bg-indigo-50 px-2 py-1 text-[10px] font-bold">◉ Ya no labora en la empresa</p>
            <div className="mt-2 flex justify-end gap-1.5">
              <MiniButton>Cancelar</MiniButton>
              <MiniButton variant="primary">Descartar</MiniButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
