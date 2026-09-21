"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Award, Info, Layers, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatRelative } from "@/components/teach/format";
import { restoreEnrollmentsAction } from "@/server/actions/teacher-students";
import { HelpTip } from "@/components/help/help-tip";

export type TrashRow = {
  enrollmentId: string;
  studentId: string;
  fullName: string;
  email: string;
  cycle: number;
  droppedAtMs: number | null;
  /** Fecha completa ya formateada en el servidor (para el tooltip) */
  droppedAtLabel: string;
  droppedFrom: "active" | "completed" | null;
  droppedByName: string | null;
  cohortName: string | null;
  certificateFolio: string | null;
};

/**
 * Papelera del curso: bajas reversibles. Restaurar devuelve la matrícula tal
 * como estaba (avance, calificaciones, certificado y estatus).
 */
export function TrashSheet({ courseId, rows }: { courseId: string; rows: TrashRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const ids = useMemo(() => new Set(rows.map((r) => r.enrollmentId)), [rows]);
  const selectedIds = useMemo(() => [...selected].filter((id) => ids.has(id)), [selected, ids]);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const n = rows.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function restore(enrollmentIds: string[], single?: TrashRow) {
    if (enrollmentIds.length === 0) return;
    setBusyIds((prev) => new Set([...prev, ...enrollmentIds]));
    startTransition(async () => {
      const result = await restoreEnrollmentsAction(courseId, enrollmentIds);
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const id of enrollmentIds) next.delete(id);
        return next;
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        single
          ? `${single.fullName} volvió al curso tal como estaba`
          : result.count === 1
            ? "1 estudiante restaurado tal como estaba"
            : `${result.count} estudiantes restaurados tal como estaban`
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of enrollmentIds) next.delete(id);
        return next;
      });
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelected(new Set());
      }}
    >
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="h-11"
          aria-label={
            n === 0
              ? "Papelera vacía"
              : `Papelera: ${n} ${n === 1 ? "estudiante dado de baja" : "estudiantes dados de baja"}`
          }
        >
          <Trash2 aria-hidden />
          Papelera ({n.toLocaleString("es-MX")})
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-section-soft text-section-strong">
              <Trash2 className="size-4" aria-hidden />
            </span>
            Papelera del curso
            <HelpTip topic="students.trash" />
          </SheetTitle>
          <SheetDescription>
            Estudiantes dados de baja. Nada se borró: puedes devolverlos cuando quieras.
          </SheetDescription>
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-section-soft/60 p-3 text-sm text-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-section-strong" aria-hidden />
            Restaurar devuelve al alumno con su avance, calificaciones, certificado y estatus
            exactamente como estaban.
          </p>
        </SheetHeader>

        {n === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
              <Trash2 className="size-8" aria-hidden />
            </span>
            <p className="font-heading text-base font-semibold">La papelera está vacía</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Cuando quites a alguien del curso aparecerá aquí para que puedas restaurarlo.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-5 py-2.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) =>
                    setSelected(v === true ? new Set(rows.map((r) => r.enrollmentId)) : new Set())
                  }
                  aria-label="Seleccionar todos los de la papelera"
                />
                Seleccionar todos ({n.toLocaleString("es-MX")})
              </label>
              <Button
                size="sm"
                className="ml-auto h-9 bg-section px-3 text-white hover:bg-section-strong"
                disabled={selectedIds.length === 0 || pending}
                onClick={() => restore(selectedIds)}
              >
                {pending && selectedIds.some((id) => busyIds.has(id)) ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RotateCcw aria-hidden />
                )}
                Restaurar seleccionados
                {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
              </Button>
            </div>

            <ul className="min-h-0 flex-1 divide-y overflow-y-auto" aria-label="Estudiantes dados de baja">
              {rows.map((row) => {
                const busy = busyIds.has(row.enrollmentId);
                const isSelected = selected.has(row.enrollmentId);
                return (
                  <li
                    key={row.enrollmentId}
                    className={cn(
                      "flex items-start gap-3 px-5 py-3.5 transition-colors",
                      isSelected && "bg-section-soft/40",
                      busy && "opacity-60"
                    )}
                  >
                    <Checkbox
                      className="mt-1"
                      checked={isSelected}
                      onCheckedChange={(v) => toggle(row.enrollmentId, v === true)}
                      aria-label={`Seleccionar a ${row.fullName}`}
                      disabled={busy}
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{row.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.droppedFrom === "completed" ? (
                          <Badge variant="secondary" className="bg-success/10 text-[11px] text-success">
                            Estaba: Aprobado
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[11px]">
                            Estaba: En curso
                          </Badge>
                        )}
                        {row.certificateFolio && (
                          <Badge
                            variant="secondary"
                            className="bg-section-soft text-[11px] text-section-strong"
                            title="El certificado sigue siendo válido y verificable"
                          >
                            <Award aria-hidden />
                            Certificado conservado · {row.certificateFolio}
                          </Badge>
                        )}
                        {row.cohortName && (
                          <Badge variant="outline" className="text-[11px] text-muted-foreground">
                            <Layers aria-hidden />
                            {row.cohortName}
                          </Badge>
                        )}
                        {row.cycle > 1 && (
                          <Badge variant="outline" className="text-[11px] text-muted-foreground">
                            Ciclo {row.cycle}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground" title={row.droppedAtLabel}>
                        Dado de baja{" "}
                        {row.droppedAtMs !== null ? formatRelative(row.droppedAtMs) : "sin fecha"}
                        {row.droppedByName ? ` por ${row.droppedByName}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 px-3"
                      disabled={busy}
                      onClick={() => restore([row.enrollmentId], row)}
                      aria-label={`Restaurar a ${row.fullName}`}
                    >
                      {busy ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw aria-hidden />
                      )}
                      Restaurar
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
