"use client";

// Piezas compartidas por los asistentes de operación masiva (CSV en 3 pasos).
// Mismo lenguaje visual que el importador de estudiantes (§2.13).

import { useState, type ReactNode } from "react";
import { Check, CircleCheck, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type WizardStep = 1 | 2 | 3;

/** Cuántas filas se pintan en la vista previa (el resto igual se procesa). */
export const PREVIEW_LIMIT = 300;

const STEP_LABELS = ["Subir", "Revisar", "Resultado"];

export function StepIndicator({ current }: { current: WizardStep }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as WizardStep;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-border" aria-hidden />}
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                active && "bg-section text-section-fg",
                done && "bg-cta text-cta-foreground",
                !active && !done && "bg-muted text-muted-foreground"
              )}
              aria-hidden
            >
              {done ? <Check className="size-3.5" /> : n}
            </span>
            <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Zona para arrastrar/elegir el .csv; entrega el texto leído al padre. */
export function CsvDropzone({
  busy,
  hint,
  onText,
}: {
  /** true mientras se valida en el servidor (muestra spinner y bloquea). */
  busy: boolean;
  hint: ReactNode;
  onText: (text: string, fileName: string) => void;
}) {
  const [dragging, setDragging] = useState(false);

  function handleFile(file: File) {
    const isCsv =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel";
    if (!isCsv) {
      toast.error("Elige un archivo .csv");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result ?? ""), file.name);
    reader.onerror = () => toast.error("No se pudo leer el archivo. Intenta de nuevo.");
    reader.readAsText(file);
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
        dragging ? "border-section bg-section-soft/50" : "border-border hover:bg-muted/40"
      )}
    >
      {busy ? (
        <Loader2 className="size-8 animate-spin text-section-strong" aria-hidden />
      ) : (
        <FileUp className="size-8 text-muted-foreground" aria-hidden />
      )}
      <span className="text-sm font-medium">
        {busy ? "Validando el archivo…" : "Arrastra tu archivo .csv aquí o haz clic para elegirlo"}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
      <input
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Paso 3: círculo verde con el resumen de lo aplicado. */
export function SuccessResult({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-2 text-center">
      <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
        <CircleCheck className="size-9" aria-hidden />
      </span>
      <p className="font-heading text-xl font-semibold">{title}</p>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
    </div>
  );
}
