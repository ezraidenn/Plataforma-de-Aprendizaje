"use client";

import { BookOpen, FileQuestion } from "lucide-react";
import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge, MiniToast } from "@/components/help/mini/basics";
import { MiniConditionCard } from "@/components/help/mini/rules";
import { MiniCertificate } from "@/components/help/mini/certificate";
import { RULES_RECHECK_CYCLE_MS, rulesRecheckStory } from "./rules-recheck.story";

const ICONS = [BookOpen, FileQuestion];

/** Reevaluación: al llegar el envío se recalcula todo y sale el certificado. */
export function RulesRecheckScene() {
  const phase = useSceneClock(RULES_RECHECK_CYCLE_MS);
  const s = rulesRecheckStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[12px]">Para aprobar el curso</b>
        {s.approved && <MiniBadge tone="ok">Curso aprobado</MiniBadge>}
      </div>

      <div className="space-y-1.5">
        {s.conditions.map((c, i) => {
          const Icon = ICONS[i] ?? BookOpen;
          return (
            <MiniConditionCard
              key={c.label}
              Icon={Icon}
              title={c.label}
              detail={c.passed === null ? "sin intento aún" : "cumplida"}
              passed={c.passed}
            />
          );
        })}
      </div>

      <div className="mt-auto flex items-end justify-between gap-2">
        <span className="text-[9.5px] leading-snug text-slate-500">
          {s.certificate
            ? "Con plantilla asignada, el certificado sale solo."
            : s.approved
              ? "Se cumplieron las dos: el curso pasa a «Completado»."
              : "Cada vez que el alumno avanza, se vuelve a evaluar."}
        </span>
        {s.certificate && (
          <MiniCertificate
            className="w-[104px] shrink-0 animate-in fade-in zoom-in-95 duration-500"
            name="Laura Pérez"
            course="Uso y Manejo de Extintores"
            folio="CERT-2026-000123"
          />
        )}
      </div>

      <MiniToast show={s.submitted && !s.approved}>Laura envió su examen</MiniToast>
    </div>
  );
}
