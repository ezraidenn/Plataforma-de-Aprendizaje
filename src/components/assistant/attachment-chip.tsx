"use client";

import { FileSpreadsheet, FileText, Image as ImageIcon, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { extOf } from "@/lib/ai-import-files";

/**
 * Tarjeta de un archivo adjunto: icono según el tipo, nombre recortado y el
 * detalle que resumió el servidor («2 hojas · 94 filas»). Se usa en el
 * desplegable del campo (con la X para quitarlo) y dentro de la burbuja del
 * usuario, donde el archivo ya se mandó y no se puede quitar.
 */

const SHEET_EXTS = [".xlsx", ".xls", ".csv", ".ods"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

function iconFor(name: string): LucideIcon {
  const ext = extOf(name);
  if (SHEET_EXTS.includes(ext)) return FileSpreadsheet;
  if (IMAGE_EXTS.includes(ext)) return ImageIcon;
  return FileText;
}

export function AttachmentChip({
  name,
  detail,
  onRemove,
  className,
}: {
  name: string;
  detail: string;
  onRemove?(): void;
  className?: string;
}) {
  const Icon = iconFor(name);
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left",
        className
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-slate-900" title={name}>
          {name}
        </span>
        {detail ? <span className="block truncate text-[11px] text-slate-500">{detail}</span> : null}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Quitar el archivo"
          title="Quitar el archivo"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
