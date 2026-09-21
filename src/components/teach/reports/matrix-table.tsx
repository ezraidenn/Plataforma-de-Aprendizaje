"use client";

import { useState } from "react";
import { Check, CircleCheck, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { kindMeta } from "@/components/kind-meta";
import {
  KIND_ICON,
  KIND_LABEL,
  STATE_META,
  type CellState,
  type ItemKind,
} from "./item-meta";
import { StudentDetailSheet, type SheetTarget } from "./student-detail-sheet";

export type MatrixColumnData = {
  itemId: string;
  title: string;
  kind: ItemKind;
  folderTitle: string | null;
};

export type MatrixCellData = {
  state: CellState;
  percent: number;
  examPassed?: boolean;
  examScorePercent?: number | null;
};

export type MatrixRowData = {
  studentId: string;
  studentName: string;
  email: string;
  coursePercent: number;
  courseCompleted: boolean;
  atRisk: boolean;
  cells: MatrixCellData[];
};

const STICKY_LEFT = "sticky left-0 z-10 min-w-48 border-r bg-card";
const STICKY_RIGHT = "sticky right-0 z-10 w-24 border-l bg-card";

/** Agrupa columnas consecutivas por carpeta para la fila de encabezado superior. */
function computeGroups(columns: MatrixColumnData[]) {
  const groups: { title: string | null; span: number }[] = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (last && last.title === col.folderTitle) last.span += 1;
    else groups.push({ title: col.folderTitle, span: 1 });
  }
  return groups;
}

/** Matriz alumnos × ítems con semáforo, sticky columns y drill-down (§2.11). */
export function MatrixTable({
  courseId,
  columns,
  rows,
}: {
  courseId: string;
  columns: MatrixColumnData[];
  rows: MatrixRowData[];
}) {
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openDetail(row: MatrixRowData, focusItemId: string | null) {
    setTarget({
      studentId: row.studentId,
      studentName: row.studentName,
      email: row.email,
      coursePercent: row.coursePercent,
      focusItemId,
    });
    setSheetOpen(true);
  }

  const groups = computeGroups(columns);
  const hasGroups = columns.some((c) => c.folderTitle !== null);

  const itemHeader = (col: MatrixColumnData) => {
    const Icon = KIND_ICON[col.kind];
    return (
      <th
        key={col.itemId}
        scope="col"
        className="h-10 min-w-14 max-w-28 border-b bg-secondary px-1 text-center font-medium"
      >
        <span
          title={`${col.title} · ${KIND_LABEL[col.kind]}${col.folderTitle ? ` · ${col.folderTitle}` : ""}`}
          className="mx-auto flex max-w-24 items-center justify-center gap-1 rounded"
        >
          {/* Icono de tipo en su color de identidad (siempre junto al icono) */}
          <Icon
            className={cn("size-3.5 shrink-0", kindMeta(col.kind).textClass)}
            aria-hidden
          />
          <span className="truncate text-xs">{col.title}</span>
        </span>
      </th>
    );
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        {/* Contenedor propio del scroll horizontal (sticky funciona contra él) */}
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm [&_tbody_tr:last-child>td]:border-b-0">
            <thead>
              {hasGroups ? (
                <>
                  <tr>
                    <th
                      rowSpan={2}
                      scope="col"
                      className={cn(
                        STICKY_LEFT,
                        "border-b bg-secondary px-3 pb-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                      )}
                    >
                      Estudiante
                    </th>
                    {groups.map((group, i) => (
                      <th
                        key={`${group.title ?? "sueltos"}-${i}`}
                        colSpan={group.span}
                        scope="colgroup"
                        className={cn(
                          "h-8 whitespace-nowrap border-b bg-secondary px-2 text-center text-xs font-medium text-muted-foreground",
                          i > 0 && "border-l",
                        )}
                      >
                        <span className="mx-auto block max-w-40 truncate">
                          {group.title ?? ""}
                        </span>
                      </th>
                    ))}
                    <th
                      rowSpan={2}
                      scope="col"
                      className={cn(
                        STICKY_RIGHT,
                        "border-b bg-secondary px-3 pb-2 text-right align-bottom text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                      )}
                    >
                      % Curso
                    </th>
                  </tr>
                  <tr>{columns.map(itemHeader)}</tr>
                </>
              ) : (
                <tr>
                  <th
                    scope="col"
                    className={cn(
                      STICKY_LEFT,
                      "border-b bg-secondary px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                    )}
                  >
                    Estudiante
                  </th>
                  {columns.map(itemHeader)}
                  <th
                    scope="col"
                    className={cn(
                      STICKY_RIGHT,
                      "border-b bg-secondary px-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                    )}
                  >
                    % Curso
                  </th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.studentId}
                  className="group cursor-pointer"
                  onClick={() => openDetail(row, null)}
                >
                  <td
                    className={cn(
                      STICKY_LEFT,
                      "border-b p-0 transition-colors group-hover:bg-section-soft/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(row, null);
                      }}
                      aria-label={`Ver detalle de ${row.studentName}`}
                      className="flex min-h-12 w-full flex-col items-start justify-center px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                    >
                      <span className="max-w-44 truncate font-medium">
                        {row.studentName}
                      </span>
                      <span className="max-w-44 truncate text-xs text-muted-foreground">
                        {row.email}
                      </span>
                    </button>
                  </td>

                  {row.cells.map((cell, i) => {
                    const col = columns[i];
                    if (!col) return null;
                    const meta = STATE_META[cell.state];
                    const StateIcon = meta.icon;
                    const hasExamScore =
                      col.kind === "exam" &&
                      cell.examScorePercent !== null &&
                      cell.examScorePercent !== undefined;
                    const ariaLabel =
                      `${col.title}: ${meta.label}` +
                      (hasExamScore
                        ? `, calificación ${cell.examScorePercent}% (${cell.examPassed ? "aprobado" : "no aprobado"})`
                        : "");
                    const tooltipText =
                      `${col.title}
${meta.label}${cell.state === "in_progress" && cell.percent > 0 ? ` · ${Math.round(cell.percent)}%` : ""}` +
                      (hasExamScore
                        ? `
Calificación: ${cell.examScorePercent}% · ${cell.examPassed ? "Aprobado" : "No aprobado"}`
                        : "");
                    return (
                      <td
                        key={col.itemId}
                        className="border-b p-0 text-center transition-colors group-hover:bg-section-soft/40"
                      >
                        <button
                          title={tooltipText}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(row, col.itemId);
                          }}
                          aria-label={ariaLabel}
                          className="flex h-12 w-full min-w-14 items-center justify-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                        >
                          <StateIcon
                            className={cn("size-4", meta.className)}
                            aria-hidden
                          />
                          {hasExamScore &&
                            (cell.examPassed ? (
                              <Check
                                className="size-3 text-success"
                                aria-hidden
                              />
                            ) : (
                              <X
                                className="size-3 text-destructive"
                                aria-hidden
                              />
                            ))}
                        </button>
                      </td>
                    );
                  })}

                  <td
                    className={cn(
                      STICKY_RIGHT,
                      "border-b px-3 text-right transition-colors group-hover:bg-section-soft/40",
                    )}
                  >
                    <span className="inline-flex items-center justify-end gap-1 font-semibold tabular-nums">
                      {row.coursePercent}%
                      {row.courseCompleted ? (
                        <>
                          <CircleCheck
                            className="size-4 text-progress-ring"
                            aria-hidden
                          />
                          <span className="sr-only">Curso completado</span>
                        </>
                      ) : row.atRisk ? (
                        <>
                          <TriangleAlert
                            className="size-4 text-destructive"
                            aria-hidden
                          />
                          <span className="sr-only">En riesgo</span>
                        </>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Leyenda: el color nunca es el único indicador (§3.1) */}
        <div className="flex flex-wrap items-center gap-1.5 border-t bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-section-strong">
            Leyenda
          </span>
          {(Object.keys(STATE_META) as CellState[]).map((state) => {
            const meta = STATE_META[state];
            const Icon = meta.icon;
            return (
              <span
                key={state}
                className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5"
              >
                <Icon className={cn("size-3.5", meta.className)} aria-hidden />
                {meta.label}
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5">
            <Check className="size-3.5 text-success" aria-hidden />
            <X className="size-3.5 text-destructive" aria-hidden />
            Examen aprobado / no aprobado
          </span>
        </div>
      </div>

      <StudentDetailSheet
        courseId={courseId}
        target={target}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
