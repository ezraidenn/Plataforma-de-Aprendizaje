"use client";

import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniButton } from "@/components/help/mini/basics";
import { MiniCursor } from "@/components/help/mini/cursor";
import { MiniCertificate } from "@/components/help/mini/certificate";
import { CERT_ONDEMAND_CYCLE_MS, certOnDemandStory } from "./cert-ondemand.story";

/** El certificado no ocupa disco: se arma al descargarlo. */
export function CertOnDemandScene() {
  const phase = useSceneClock(CERT_ONDEMAND_CYCLE_MS);
  const s = certOnDemandStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex flex-1 items-center gap-3">
        <div className="flex-1 space-y-1.5">
          <b className="block text-[11.5px]">Mis certificados</b>
          <span className="block text-[9.5px] leading-snug text-slate-500">
            Uso y Manejo de Extintores
          </span>
          <span className="relative inline-block">
            <MiniButton variant="primary" glow={s.stage === "building"}>
              ⤓ Descargar
            </MiniButton>
            <MiniCursor at={s.stage !== "idle"} pressed={s.stage === "building"} />
          </span>
          <span className="block text-[9px] text-slate-400">
            {s.stage === "building" ? "Armando el PDF…" : "PDF con folio y QR"}
          </span>
        </div>

        <MiniCertificate
          className="shrink-0"
          name="Laura Pérez"
          course="Uso y Manejo de Extintores"
          folio="CERT-2026-000123"
          reveal={s.reveal}
        />
      </div>

      <p className="text-[9.5px] leading-snug text-slate-500">
        En disco: <b>{s.filesOnDisk} archivos</b> — se arma al descargarlo, con la copia de la
        plantilla que se congeló al emitirlo.
      </p>
    </div>
  );
}
