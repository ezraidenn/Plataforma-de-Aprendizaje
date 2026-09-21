"use client";

import { useSceneClock } from "@/components/help/use-scene-clock";
import { MiniBadge, MiniButton, MiniToast } from "@/components/help/mini/basics";
import { MiniFileChip } from "@/components/help/mini/assignment";
import { CSV_IMPORT_CYCLE_MS, csvImportStory } from "./csv-import.story";

const RESULT_LABEL = {
  new: { tone: "ok" as const, text: "se crea" },
  existing: { tone: "muted" as const, text: "ya existe" },
  error: { tone: "bad" as const, text: "correo inválido" },
};

/** Importar por CSV: previsualiza qué pasará con cada fila y luego confirma. */
export function CsvImportScene() {
  const phase = useSceneClock(CSV_IMPORT_CYCLE_MS);
  const s = csvImportStory(phase);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-white p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[12px]">Importar estudiantes</b>
        {s.stage !== "pick" && <MiniFileChip name="alumnos.csv" />}
      </div>

      {s.stage === "pick" ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-[10px] text-slate-400">
          Elige el archivo CSV (nombre y correo)
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {s.rows.map((row) => (
            <div
              key={row.name}
              className="flex items-center gap-2 border-t border-slate-100 px-2.5 py-1 first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">{row.name}</span>
              <MiniBadge tone={RESULT_LABEL[row.result].tone} className="shrink-0">
                {RESULT_LABEL[row.result].text}
              </MiniBadge>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[9.5px] leading-snug text-slate-500">
          {s.stage === "done"
            ? "Las repetidas y las erróneas no se tocan."
            : "Antes de crear nada, revisas la lista."}
        </span>
        {s.stage === "preview" && (
          <MiniButton variant="primary" className="shrink-0">
            Importar
          </MiniButton>
        )}
      </div>

      <MiniToast show={s.stage === "done"}>{s.created} estudiantes creados</MiniToast>
    </div>
  );
}
