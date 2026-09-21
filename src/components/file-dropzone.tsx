"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Zona genérica para elegir/arrastrar varios archivos. No sube nada: entrega
 * los `File` al padre, que decide cómo subirlos (kind, límites, acciones).
 */
export function FileDropzone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  hint,
  label = "Arrastra archivos aquí",
  buttonLabel = "Elegir archivos",
  compact = false,
  className,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Texto secundario, p. ej. "PDF o DOCX · máx 25 MB c/u". */
  hint?: string;
  label?: string;
  buttonLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const emit = (list: FileList | null) => {
    if (!list || disabled) return;
    const files = Array.from(list);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        emit(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-card px-4 text-center transition-colors",
        compact ? "py-4" : "py-8",
        dragOver && "border-primary bg-accent",
        disabled && "opacity-60",
        className
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept || undefined}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        aria-label={buttonLabel}
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
      />
      <Upload className={cn("text-muted-foreground", compact ? "size-5" : "size-8")} aria-hidden />
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Button
        type="button"
        variant="outline"
        className="mt-1 h-11"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
