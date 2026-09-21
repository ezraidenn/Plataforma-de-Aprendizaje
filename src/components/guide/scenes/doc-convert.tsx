"use client";

import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge } from "@/components/help/mini/basics";
import { MiniFileChip, MiniDropzone } from "@/components/help/mini/assignment";
import { MiniDocPage } from "@/components/help/mini/doc";
import { DOC_CONVERT_CYCLE_MS, docConvertStory } from "./doc-convert.story";

/** Documento: se sube un PowerPoint, se convierte a PDF y queda listo. */
export function DocConvertScene() {
  const phase = useSceneClock(DOC_CONVERT_CYCLE_MS);
  const s = docConvertStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[12px]">Manual del participante</b>
        {s.stage === "converting" && <MiniBadge tone="warn">Convirtiendo…</MiniBadge>}
        {s.stage === "ready" && <MiniBadge tone="ok">Listo · {s.pages} páginas</MiniBadge>}
      </div>

      {s.stage === "empty" ? (
        <MiniDropzone hint="PDF, PPT o PPTX" />
      ) : (
        <div className="space-y-1.5">
          <MiniFileChip name={s.fileName} />
          {s.stage === "uploading" && (
            <div className="h-[6px] w-full overflow-hidden rounded-full bg-slate-200">
              <span
                className="block h-full rounded-full bg-cta transition-[width] duration-200"
                style={{ width: `${Math.round(s.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {s.stage === "ready" ? (
        <div className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-100 p-2">
          <MiniDocPage title="Clases de fuego" />
          <span className="text-[9.5px] leading-snug text-slate-500">
            El alumno lo lee
            <br />
            página por página.
          </span>
        </div>
      ) : (
        <p className="mt-auto text-[9.5px] leading-snug text-slate-500">
          {s.stage === "converting"
            ? "Los PowerPoint se convierten solos a PDF."
            : "Sube el archivo en el panel de detalle."}
        </p>
      )}
    </div>
  );
}
