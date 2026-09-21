"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "../use-scene-clock";
import { MiniBadge, MiniButton, MiniToast } from "../mini/basics";
import { MiniCourseCard, MiniCoverArt, MiniCoverBlank, MiniLessonRow, MiniModuleHeader } from "../mini/course";
import { MiniCertificate, MiniTimeline } from "../mini/certificate";
import { MiniCursor } from "../mini/cursor";
import type { HelpValues } from "../topics";
import {
  CERTIFICATE_CYCLE_MS,
  certificateStory,
  COVER_CYCLE_MS,
  coverStory,
  SEQ_CYCLE_MS,
  sequentialStory,
  STATUS_CYCLE_MS,
  statusStory,
  VALIDITY_CYCLE_MS,
  validityStory,
  type CourseStatus,
} from "./course.story";

export function SequentialScene({ value }: { value: HelpValues["course.sequential"] }) {
  const phase = useSceneClock(SEQ_CYCLE_MS);
  const s = sequentialStory(phase, value.enabled);
  return (
    <div className="absolute inset-2.5 overflow-hidden rounded-lg border bg-white">
      <MiniModuleHeader>Módulo 1 — Fundamentos del fuego</MiniModuleHeader>
      {s.lessons.map((lesson) => (
        <MiniLessonRow key={lesson.title} {...lesson} />
      ))}
      <MiniToast show={s.toastVisible}>{s.toastText}</MiniToast>
    </div>
  );
}

export function ValidityScene({ value }: { value: HelpValues["course.validity"] }) {
  const phase = useSceneClock(VALIDITY_CYCLE_MS);
  const s = validityStory(phase, value.mode, value.months);
  const tone = s.badge.kind === "valid" ? "ok" : s.badge.kind === "expiring" ? "warn" : "muted";
  const icon = s.badge.kind === "valid" ? "✓ " : s.badge.kind === "expiring" ? "⏳ " : "";
  return (
    <div className="absolute inset-0 bg-white">
      <MiniTimeline
        className="absolute inset-x-3.5 top-5"
        issuedLabel={`${s.issuedLabel} · aprueba`}
        expiryLabel={s.expiryLabel}
        expiryPos={s.expiryPos}
        todayPos={s.todayPos}
      />
      <MiniCertificate
        className="absolute left-3 top-[76px]"
        name="Laura Pérez"
        course="Uso y Manejo de Extintores"
        validityLine={s.certificateLine}
        folio="CERT-2026-000123"
      />
      <div className="absolute left-[172px] right-3 top-[80px] space-y-2">
        <MiniBadge tone={tone}>
          {icon}
          {s.badge.text}
        </MiniBadge>
        <div
          className={cn(
            "overflow-hidden rounded-lg border bg-white transition-all duration-500",
            s.showPanel ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          )}
        >
          <div className="bg-orange-50 px-2 py-1 text-[8.5px] font-extrabold tracking-[0.08em] text-orange-700">VENCIMIENTOS</div>
          <div className="space-y-1 px-2 py-1.5 text-[10px]">
            <b className="block leading-tight">Laura Pérez</b>
            <span className="block text-[9px] text-slate-500">venció {s.expiryLabel ?? ""}</span>
            <MiniButton variant="orange" className="px-2 py-1 text-[10px]">
              Reinscribir
            </MiniButton>
          </div>
        </div>
      </div>
    </div>
  );
}

const STAGES: { status: CourseStatus; label: string; chip: string }[] = [
  { status: "draft", label: "Borrador", chip: "bg-slate-200 text-slate-700" },
  { status: "published", label: "Publicado", chip: "bg-indigo-100 text-cta" },
  { status: "archived", label: "Archivado", chip: "bg-slate-100 text-slate-500" },
];

export function StatusScene({ value }: { value: { status: CourseStatus } }) {
  const phase = useSceneClock(STATUS_CYCLE_MS);
  const s = statusStory(phase);
  return (
    <div className="absolute inset-0 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b>Estado:</b>
        <span className="inline-flex gap-0.5 rounded-full bg-slate-100 p-0.5 text-[10px] font-extrabold">
          {STAGES.map((st) => (
            <span
              key={st.status}
              className={cn("relative rounded-full px-2 py-0.5 transition-all duration-300", s.stage === st.status ? cn(st.chip, "shadow-sm") : "text-slate-400")}
            >
              {st.label}
              {value.status === st.status && (
                <span className="absolute -right-1 -top-2.5 rounded-full bg-cta px-1 text-[7px] font-bold text-white">tu curso</span>
              )}
            </span>
          ))}
        </span>
      </div>
      <div className="mt-3 rounded-lg border bg-slate-50 p-2">
        <p className="mb-1.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-500">Panel del alumno · Mis cursos</p>
        <div className="grid grid-cols-2 gap-2">
          <MiniCourseCard title="Primeros Auxilios Básicos" percent={40} cover={<MiniCoverBlank />} />
          <div className="relative">
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-[9px] text-slate-400 transition-opacity duration-300",
                s.cardInPanel ? "opacity-0" : "opacity-100"
              )}
            >
              no aparece
            </div>
            <MiniCourseCard
              title="Uso y Manejo de Extintores"
              percent={0}
              cover={<MiniCoverArt />}
              className={cn("relative transition-all duration-500", s.cardInPanel ? "scale-100 opacity-100" : "scale-95 opacity-0")}
            />
          </div>
        </div>
      </div>
      <div
        className={cn(
          "mt-2 flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-opacity duration-500",
          s.keptNote ? "opacity-100" : "opacity-0"
        )}
      >
        <span className="text-[13px]" aria-hidden>
          🗂
        </span>
        <span className="text-[10px] font-semibold leading-tight">Su avance y sus certificados se conservan</span>
      </div>
    </div>
  );
}

/** Portada que cambia del color propio a la foto. */
function CoverSwap({ on }: { on: boolean }) {
  return (
    <div className="relative size-full">
      <MiniCoverBlank />
      <MiniCoverArt className={cn("absolute inset-0 transition-opacity duration-700", on ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

const SMALL_TITLE = "mb-1 text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-500";

export function CoverScene() {
  const phase = useSceneClock(COVER_CYCLE_MS);
  const s = coverStory(phase);
  return (
    <div className="absolute inset-0 grid grid-cols-[1fr_1.15fr] gap-2.5 bg-white p-3">
      <div className="flex min-w-0 flex-col">
        <p className={SMALL_TITLE}>Ajustes del curso</p>
        <div className="relative flex-1 overflow-hidden rounded-lg border">
          <CoverSwap on={s.uploaded} />
        </div>
        <span className="relative mt-1.5 self-start">
          <MiniButton variant="primary" className={cn(s.pressed && "scale-95")}>
            Subir imagen
          </MiniButton>
          <MiniCursor at={s.cursorAtUpload} pressed={s.pressed} />
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div>
          <p className={SMALL_TITLE}>Panel del alumno</p>
          <MiniCourseCard title="Uso y Manejo de Extintores" percent={40} cover={<CoverSwap on={s.inDashboard} />} />
        </div>
        <div>
          <p className={SMALL_TITLE}>Inicio de sesión</p>
          <div className="flex items-center gap-2 rounded-lg bg-[linear-gradient(135deg,#0f172a,#1e1b4b)] p-1.5">
            <div className="relative size-9 shrink-0 overflow-hidden rounded-md">
              <CoverSwap on={s.inLogin} />
            </div>
            <span className="min-w-0 leading-tight text-white">
              <b className="block truncate text-[9.5px]">Uso y Manejo de Extintores</b>
              <span className="text-[8.5px] text-slate-300">Cursos disponibles</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CertificateScene() {
  const phase = useSceneClock(CERTIFICATE_CYCLE_MS);
  const s = certificateStory(phase);
  return (
    <div className="absolute inset-0 bg-white p-3">
      <div className="rounded-lg border px-2.5 py-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <b className="truncate">Uso y Manejo de Extintores</b>
          <span className={cn("font-extrabold tabular-nums", s.percent === 100 ? "text-green-600" : "text-slate-500")}>{s.percent}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-slate-100">
          <span className="block h-full rounded bg-green-500 transition-[width] duration-100 ease-linear" style={{ width: `${s.percent}%` }} />
        </div>
      </div>
      <div className="mt-3 flex justify-center">
        <MiniCertificate
          className={cn("transition-all duration-500", s.diploma ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}
          name="Laura Pérez"
          course="Uso y Manejo de Extintores"
          folio="CERT-2026-000124"
          reveal={{ name: s.name, folio: s.folio, qr: s.qr }}
        />
      </div>
      <MiniToast show={s.toastVisible}>🎉 ¡Aprobaste el curso!</MiniToast>
    </div>
  );
}
