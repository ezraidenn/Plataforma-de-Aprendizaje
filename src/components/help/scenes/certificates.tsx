"use client";

import { cn } from "@/lib/utils";
import { useSceneClock } from "../use-scene-clock";
import { MiniCertificate, MiniPhone } from "../mini/certificate";
import { MiniCheck } from "../mini/icons";
import { TEMPLATE_FIELDS_CYCLE_MS, templateFieldsStory, type TemplateFieldKey } from "./certificates.story";

export function TemplateFieldsScene({ value }: { value: { field: TemplateFieldKey } }) {
  const phase = useSceneClock(TEMPLATE_FIELDS_CYCLE_MS);
  const s = templateFieldsStory(phase, value.field);
  if (value.field === "validity") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 p-3">
        <MiniCertificate
          key={String(s.withValidity)}
          className="animate-in fade-in duration-300"
          name="Laura Pérez"
          course={s.withValidity ? "Uso y Manejo de Extintores" : "Inducción a la empresa"}
          validityLine={s.withValidity ? "Vigente hasta el 31 de diciembre de 2026" : null}
          folio="CERT-2026-000123"
        />
        <span className="rounded-md border border-dashed border-cta bg-white px-1.5 py-0.5 text-[9.5px] font-bold text-cta">
          {s.withValidity ? "curso con vigencia: se imprime la fecha" : "curso vitalicio: el renglón se omite"}
        </span>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-4 bg-slate-50 p-3">
      <MiniCertificate name="Laura Pérez" course="Uso y Manejo de Extintores" folio="CERT-2026-000123" reveal={{ name: true, folio: true, qr: true }} />
      <div className="transition-all duration-300" style={{ transform: `translateX(${Math.round((1 - s.phoneIn) * 60)}px)`, opacity: s.phoneIn }}>
        <MiniPhone>
          {s.verified ? (
            <div className="flex h-full animate-in fade-in flex-col items-center gap-1 p-2 pt-4 text-center duration-300">
              <MiniCheck className="size-7" />
              <b className="text-[9.5px] leading-tight text-green-700">Certificado válido</b>
              <span className="text-[8.5px] font-bold leading-tight">Laura Pérez</span>
              <span className="text-[7.5px] leading-tight text-slate-500">Uso y Manejo de Extintores</span>
              <span className="mt-1 text-[7px] text-slate-400">Folio CERT-2026-000123</span>
            </div>
          ) : (
            <div className="relative h-full bg-slate-900">
              <div className="absolute inset-x-4 top-1/2 aspect-square -translate-y-1/2 rounded-md border-2 border-white/80" />
              <div className={cn("absolute inset-x-4 top-1/2 h-0.5 bg-green-400 transition-opacity", s.scanning ? "animate-pulse opacity-100" : "opacity-0")} />
              <p className="absolute inset-x-0 bottom-3 text-center text-[8px] text-white/80">Escaneando…</p>
            </div>
          )}
        </MiniPhone>
      </div>
    </div>
  );
}
