"use client";

import { ArrowDown, ArrowUp, Download, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileIconFor, formatBytes } from "@/lib/file-meta";
import { Button } from "@/components/ui/button";

export type ManagedFile = {
  id: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Lista de archivos administrada por el maestro (recurso / adjuntos de tarea):
 * icono por tipo, nombre, tamaño, descargar, reordenar (opcional) y quitar.
 */
export function ManagedFileList({
  files,
  busyId,
  onRemove,
  onMove,
  emptyText,
}: {
  files: ManagedFile[];
  /** id de la entrada con una operación en curso (deshabilita sus botones). */
  busyId: string | null;
  onRemove: (entry: ManagedFile) => void;
  /** Si se pasa, muestra flechas arriba/abajo. */
  onMove?: (index: number, delta: -1 | 1) => void;
  emptyText: string;
}) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="divide-y rounded-xl border">
      {files.map((f, i) => {
        const Icon = fileIconFor(f.mimeType, f.originalName);
        const busy = busyId === f.id;
        return (
          <li key={f.id} className={cn("flex items-center gap-3 px-3 py-2", busy && "opacity-60")}>
            <Icon className="size-5 shrink-0 text-section-strong" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{f.originalName}</span>
              <span className="block text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
            </span>
            {onMove && (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || i === 0}
                  onClick={() => onMove(i, -1)}
                  aria-label={`Subir «${f.originalName}»`}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || i === files.length - 1}
                  onClick={() => onMove(i, 1)}
                  aria-label={`Bajar «${f.originalName}»`}
                >
                  <ArrowDown aria-hidden />
                </Button>
              </>
            )}
            <Button size="icon-sm" variant="ghost" asChild>
              <a
                href={`/api/files/${f.fileId}?download=1`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Descargar «${f.originalName}»`}
              >
                <Download aria-hidden />
              </a>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => onRemove(f)}
              aria-label={`Quitar «${f.originalName}»`}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
