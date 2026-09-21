"use client";

import { useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FileDropzone } from "@/components/file-dropzone";
import { uploadFile, type UploadKind } from "@/lib/upload-client";
import { formatBytes } from "@/lib/file-meta";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ManagedFileList, type ManagedFile } from "./file-list";
import type { FilesResult } from "@/server/actions/teacher-resources";

/**
 * Sección genérica "lista + dropzone multi" para archivos del maestro.
 * Parametrizada por kind de subida y por las actions de agregar / quitar /
 * reordenar; la usan el recurso descargable y los adjuntos de la tarea.
 */
export function ManagedFilesSection({
  initialFiles,
  uploadKind,
  maxBytes,
  note,
  emptyText,
  onAdd,
  onRemove,
  onReorder,
}: {
  initialFiles: ManagedFile[];
  uploadKind: UploadKind;
  maxBytes: number;
  /** Nota informativa bajo la lista (p. ej. cómo se completa el recurso). */
  note?: string;
  emptyText: string;
  onAdd: (fileId: string) => Promise<FilesResult>;
  onRemove: (entryId: string) => Promise<FilesResult>;
  onReorder?: (orderedIds: string[]) => Promise<FilesResult>;
}) {
  const [files, setFiles] = useState<ManagedFile[]>(initialFiles);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ManagedFile | null>(null);

  function apply(result: FilesResult): boolean {
    if ("error" in result) {
      toast.error(result.error);
      return false;
    }
    setFiles(result.files);
    return true;
  }

  async function handleFiles(picked: File[]) {
    const valid = picked.filter((f) => {
      if (f.size > maxBytes) {
        toast.error(`«${f.name}» pesa más de ${formatBytes(maxBytes)}.`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;
    setUploading({ done: 0, total: valid.length });
    let added = 0;
    try {
      for (let i = 0; i < valid.length; i++) {
        try {
          const fileId = await uploadFile(valid[i], uploadKind);
          if (apply(await onAdd(fileId))) added++;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "No se pudo subir el archivo.");
        }
        setUploading({ done: i + 1, total: valid.length });
      }
    } finally {
      setUploading(null);
    }
    if (added > 0) toast.success(added === 1 ? "Archivo agregado" : `${added} archivos agregados`);
  }

  async function confirmRemove() {
    const target = removeTarget;
    if (!target) return;
    setRemoveTarget(null);
    setBusyId(target.id);
    try {
      if (apply(await onRemove(target.id))) toast.success(`Se quitó «${target.originalName}»`);
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, delta: -1 | 1) {
    if (!onReorder) return;
    const target = index + delta;
    if (target < 0 || target >= files.length) return;
    const previous = files;
    const next = [...files];
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next);
    const result = await onReorder(next.map((f) => f.id));
    if ("error" in result) {
      setFiles(previous);
      toast.error(result.error);
    } else {
      setFiles(result.files);
    }
  }

  return (
    <div className="grid gap-3">
      <ManagedFileList
        files={files}
        busyId={busyId}
        onRemove={setRemoveTarget}
        onMove={onReorder ? move : undefined}
        emptyText={emptyText}
      />

      {uploading ? (
        <div className="flex items-center gap-3 rounded-xl border border-section/30 bg-section-soft/60 p-3 text-sm">
          <Loader2 className="size-5 shrink-0 animate-spin text-section-strong" aria-hidden />
          <span>
            Subiendo archivo {Math.min(uploading.done + 1, uploading.total)} de {uploading.total}…
          </span>
        </div>
      ) : (
        <FileDropzone
          compact
          onFiles={(picked) => void handleFiles(picked)}
          hint={`Varios archivos a la vez · máx ${formatBytes(maxBytes)} c/u`}
        />
      )}

      {note && (
        <div className="flex items-start gap-2 rounded-xl border border-section/30 bg-section-soft/60 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-section-strong" aria-hidden />
          <p>{note}</p>
        </div>
      )}

      <AlertDialog open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar «{removeTarget?.originalName}»?</AlertDialogTitle>
            <AlertDialogDescription>
              El archivo dejará de mostrarse a los alumnos. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmRemove()}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
