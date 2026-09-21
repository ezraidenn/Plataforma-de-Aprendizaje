"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FolderInput, Layers, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UnenrollButton } from "./unenroll-button";
import { MoveToCohortDialog } from "./move-to-cohort-dialog";

export type RosterRow = {
  enrollmentId: string;
  studentId: string;
  fullName: string;
  email: string;
  completed: boolean;
  /** Fecha ya formateada en el servidor (evita diferencias de zona horaria) */
  enrolledLabel: string;
  cycle: number;
  cohortName: string | null;
  cohortClosed: boolean;
  percent: number;
};

/**
 * Lista de alumnos del curso con selección múltiple para «Mover a grupo».
 * `allEnrollmentIds` (opcional) permite seleccionar TODO el filtro actual
 * cuando hay varias páginas.
 */
export function CourseRosterTable({
  courseId,
  rows,
  allEnrollmentIds,
  toolbar,
}: {
  courseId: string;
  rows: RosterRow[];
  allEnrollmentIds?: string[];
  /** Controles a la izquierda de la barra (p. ej. el filtro de grupo) */
  toolbar?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);

  const pageIds = useMemo(() => rows.map((r) => r.enrollmentId), [rows]);
  // Tras un refresh pueden desaparecer filas: solo cuentan ids vigentes
  const validIds = useMemo(
    () => new Set(allEnrollmentIds ?? pageIds),
    [allEnrollmentIds, pageIds]
  );
  const selectedIds = useMemo(
    () => [...selected].filter((id) => validIds.has(id)),
    [selected, validIds]
  );

  const totalMatching = allEnrollmentIds?.length ?? pageIds.length;
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const canSelectAllMatching =
    allOnPage && totalMatching > pageIds.length && selectedIds.length < totalMatching;
  const n = selectedIds.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <div
          role="region"
          aria-label="Acciones con la selección"
          className={cn(
            "flex min-h-11 flex-1 flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5 transition-colors",
            n > 0 ? "border-section/40 bg-section-soft/60" : "border-dashed bg-card/60"
          )}
        >
          <span
            aria-live="polite"
            className={cn("text-sm", n > 0 ? "font-medium" : "text-muted-foreground")}
          >
            {n === 0
              ? "Selecciona estudiantes para moverlos de grupo."
              : n === 1
                ? "1 seleccionado"
                : `${n.toLocaleString("es-MX")} seleccionados`}
          </span>
          {canSelectAllMatching && allEnrollmentIds && (
            <Button
              variant="link"
              size="sm"
              className="h-8 px-1 text-section-strong"
              onClick={() => setSelected(new Set(allEnrollmentIds))}
            >
              Seleccionar los {totalMatching.toLocaleString("es-MX")} de este filtro
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {n > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => setSelected(new Set())}
              >
                <X aria-hidden />
                Quitar selección
              </Button>
            )}
            <Button
              size="sm"
              className="h-9 bg-section px-3 text-white hover:bg-section-strong"
              disabled={n === 0}
              onClick={() => setMoveOpen(true)}
            >
              <FolderInput aria-hidden />
              Mover a grupo
            </Button>
          </div>
        </div>
      </div>

      <div className="anim-rise overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <Table>
          <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="w-10 pl-3">
                <Checkbox
                  checked={allOnPage}
                  onCheckedChange={(v) => togglePage(v === true)}
                  aria-label="Seleccionar todos los estudiantes de esta página"
                />
              </TableHead>
              <TableHead scope="col">Nombre</TableHead>
              <TableHead scope="col">Correo</TableHead>
              <TableHead scope="col">Grupo</TableHead>
              <TableHead scope="col" className="w-56">
                Progreso
              </TableHead>
              <TableHead scope="col">Matriculado</TableHead>
              <TableHead scope="col" className="w-12">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
            {rows.map((row) => {
              const isSelected = selected.has(row.enrollmentId);
              return (
                <TableRow
                  key={row.enrollmentId}
                  data-state={isSelected ? "selected" : undefined}
                  className="data-[state=selected]:bg-section-soft/50"
                >
                  <TableCell className="pl-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(v) => toggle(row.enrollmentId, v === true)}
                      aria-label={`Seleccionar a ${row.fullName}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/teach/students/${row.studentId}`}
                        className="rounded-sm transition-colors hover:text-section-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.fullName}
                      </Link>
                      {row.cycle > 1 && (
                        <Badge
                          variant="outline"
                          className="text-[11px] text-muted-foreground"
                          title={`Recertificación: ciclo ${row.cycle} en este curso`}
                        >
                          Ciclo {row.cycle}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.email}</TableCell>
                  <TableCell>
                    {row.cohortName ? (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "max-w-48 text-[11px]",
                          row.cohortClosed
                            ? "bg-muted text-muted-foreground"
                            : "bg-section-soft text-section-strong"
                        )}
                        title={row.cohortClosed ? `${row.cohortName} (grupo cerrado)` : row.cohortName}
                      >
                        {row.cohortClosed ? <Lock aria-hidden /> : <Layers aria-hidden />}
                        <span className="truncate">{row.cohortName}</span>
                        {row.cohortClosed && <span className="sr-only">(grupo cerrado)</span>}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin grupo</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={row.percent}
                        className="h-2 w-28"
                        aria-label={`Progreso de ${row.fullName}: ${row.percent}%`}
                      />
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {row.percent}%
                      </span>
                      {row.completed && (
                        <Badge variant="secondary" className="bg-success/10 text-[11px] text-success">
                          Aprobado
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.enrolledLabel}</TableCell>
                  <TableCell>
                    <UnenrollButton
                      courseId={courseId}
                      studentId={row.studentId}
                      studentName={row.fullName}
                      enrollmentId={row.enrollmentId}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <MoveToCohortDialog
        courseId={courseId}
        enrollmentIds={selectedIds}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onDone={() => setSelected(new Set())}
      />
    </div>
  );
}
