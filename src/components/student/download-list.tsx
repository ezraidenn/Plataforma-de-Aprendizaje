"use client";

import { Download } from "lucide-react";
import { fileIconFor, formatBytes } from "@/lib/file-meta";
import type { DownloadableFile } from "./types";

/**
 * Lista de archivos descargables (recurso del curso, material de apoyo de la
 * tarea, archivos de una entrega). Cada fila es un enlace a /api/files/:id,
 * que el servidor sirve como descarga tras autorizar la matrícula.
 */
export function DownloadList({
  files,
  onDownload,
  ariaLabel,
}: {
  files: DownloadableFile[];
  /** Se llama al hacer clic (antes de que el navegador inicie la descarga). */
  onDownload?: (file: DownloadableFile) => void;
  ariaLabel?: string;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="divide-y rounded-xl border bg-card" aria-label={ariaLabel}>
      {files.map((f) => {
        const Icon = fileIconFor(f.mimeType, f.name);
        return (
          <li key={f.fileId}>
            <a
              href={`/api/files/${f.fileId}?download=1`}
              target="_blank"
              rel="noreferrer"
              onClick={() => onDownload?.(f)}
              className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted"
            >
              <Icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatBytes(f.sizeBytes)}
                </span>
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                <Download className="size-4" aria-hidden />
                Descargar
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
