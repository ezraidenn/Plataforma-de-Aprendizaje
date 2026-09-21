"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Download, RotateCcw, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EXPIRING_WINDOW_DAYS } from "@/lib/validity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadTextFile } from "@/components/teach/csv-download";
import { formatNumber } from "@/components/teach/format";
import { RenewDialog, type RenewCohortOption } from "./renew-dialog";
import { DismissDialog, type ReasonOption } from "./dismiss-dialog";
import type { RenewalsTabValue } from "./href";
import { HelpTip } from "@/components/help/help-tip";

/** Fila serializable: fechas ya formateadas en el servidor (sin desfase de zona). */
export type RenewalItem = {
  certificateId: string;
  folio: string;
  studentId: string;
  studentName: string;
  email: string;
  studentActive: boolean;
  courseId: string;
  courseTitle: string;
  cycle: number;
  cohortName: string | null;
  cohortClosed: boolean;
  /** «31 dic 2026» */
  expiresLabel: string;
  /** «hace 3 días», «en 12 días», «hoy»… */
  relativeLabel: string;
  /** Por vencer en 7 días o menos: se resalta en ámbar */
  urgent: boolean;
  /** YYYY-MM-DD para el CSV */
  expiresIso: string;
  issuedIso: string;
};

function csvCell(value: string | number): string {
  let s = String(value);
  // Excel interpretaría «=…», «+…», «-…», «@…» como fórmula (inyección CSV)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function RenewalsTable({
  tab,
  items,
  filtered,
  cohorts,
  reasons,
}: {
  tab: RenewalsTabValue;
  items: RenewalItem[];
  /** Hay filtros o búsqueda activos (cambia el texto del resumen) */
  filtered: boolean;
  /** Grupos abiertos (con su curso) para reinscribir */
  cohorts: RenewCohortOption[];
  reasons: ReasonOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<"renew" | "dismiss" | null>(null);
  // Cambia en cada apertura: el diálogo se monta de nuevo con su estado limpio
  const [dialogKey, setDialogKey] = useState(0);
  // Copia de la selección al abrir: el diálogo no cambia mientras se cierra
  const [dialogTargets, setDialogTargets] = useState<RenewalItem[]>([]);

  const chosen = useMemo(
    () => items.filter((item) => selected.has(item.certificateId)),
    [items, selected]
  );
  const count = chosen.length;
  const headerChecked: boolean | "indeterminate" =
    count === 0 ? false : count === items.length ? true : "indeterminate";
  const expired = tab === "expired";

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(items.map((item) => item.certificateId)) : new Set());
  }

  function openDialog(kind: "renew" | "dismiss") {
    setDialogTargets(chosen);
    setDialogKey((k) => k + 1);
    setDialog(kind);
  }

  function afterAction() {
    setSelected(new Set());
    router.refresh();
  }

  function downloadCsv() {
    const header = [
      "Alumno",
      "Correo",
      "Cuenta",
      "Curso",
      "Ciclo",
      "Grupo",
      "Emitido",
      expired ? "Venció" : "Vence",
      "Cuándo",
      "Folio",
    ];
    const rows = items.map((item) => [
      item.studentName,
      item.email,
      item.studentActive ? "Activa" : "Desactivada",
      item.courseTitle,
      item.cycle,
      item.cohortName ?? "Sin grupo",
      item.issuedIso,
      item.expiresIso,
      item.relativeLabel,
      item.folio,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    // BOM UTF-8: Excel abre los acentos correctamente
    downloadTextFile(
      `vencimientos-${expired ? "vencidos" : "por-vencer"}-${todayIso()}.csv`,
      "﻿" + csv
    );
    toast.success("CSV descargado");
  }

  const total = items.length;
  const summary = expired
    ? `${total === 1 ? "certificado vencido" : "certificados vencidos"}`
    : `${total === 1 ? "certificado vence" : "certificados vencen"} en los próximos ${EXPIRING_WINDOW_DAYS} días`;

  return (
    <section
      aria-label={expired ? "Certificados vencidos" : "Certificados por vencer"}
      className="anim-rise anim-d2 rounded-2xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]"
    >
      {/* Anuncio para lectores de pantalla (la barra cambia de contenido) */}
      <p className="sr-only" aria-live="polite">
        {count > 0 ? `${count} ${count === 1 ? "seleccionado" : "seleccionados"}` : ""}
      </p>

      {/* Barra superior: resumen o acciones de la selección. Fija bajo el header. */}
      <div className="sticky top-14 z-20 flex min-h-[4.25rem] flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b bg-card/95 px-4 py-3 backdrop-blur-sm">
        {count > 0 ? (
          <div
            role="toolbar"
            aria-label="Acciones para los seleccionados"
            className="anim-pop flex flex-wrap items-center gap-2"
          >
            <span className="mr-1 inline-flex h-7 items-center rounded-full bg-section-soft px-2.5 text-sm font-semibold tabular-nums text-section-strong">
              {formatNumber(count)} {count === 1 ? "seleccionado" : "seleccionados"}
            </span>
            <Button
              onClick={() => openDialog("renew")}
              className="h-10 bg-section text-white hover:bg-section-strong"
            >
              <RotateCcw aria-hidden />
              Reinscribir
            </Button>
            <Button variant="outline" className="h-10" onClick={() => openDialog("dismiss")}>
              <Archive aria-hidden />
              Descartar
            </Button>
            <Button
              variant="ghost"
              className="h-10 text-muted-foreground"
              onClick={() => setSelected(new Set())}
            >
              <X aria-hidden />
              Quitar selección
            </Button>
            <HelpTip topic="renewals.actions" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">
              {formatNumber(total)}
            </span>{" "}
            {summary}
            {filtered ? " con estos filtros" : ""}. Selecciona para reinscribir o descartar.{" "}
            <HelpTip topic="renewals.actions" className="align-middle" />
          </p>
        )}
        <Button variant="outline" className="h-10" onClick={downloadCsv}>
          <Download aria-hidden />
          Descargar CSV
        </Button>
      </div>

      <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="w-10">
              <Checkbox
                checked={headerChecked}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label={
                  count === total ? "Quitar la selección de todos" : `Seleccionar los ${total}`
                }
              />
            </TableHead>
            <TableHead scope="col">Alumno</TableHead>
            <TableHead scope="col">Curso</TableHead>
            <TableHead scope="col">Grupo</TableHead>
            <TableHead scope="col">{expired ? "Venció" : "Vence"}</TableHead>
            <TableHead scope="col">Folio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isSelected = selected.has(item.certificateId);
            return (
              <TableRow
                key={item.certificateId}
                data-state={isSelected ? "selected" : undefined}
                className="hover:bg-section-soft/30 data-[state=selected]:bg-section-soft/50"
              >
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(v) => toggle(item.certificateId, v === true)}
                    aria-label={`Seleccionar: ${item.studentName}, ${item.courseTitle}`}
                  />
                </TableCell>
                <TableCell className="min-w-56 whitespace-normal">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/teach/students/${item.studentId}`}
                      className="rounded-sm font-medium transition-colors hover:text-section-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.studentName}
                    </Link>
                    {!item.studentActive && (
                      <Badge variant="secondary" className="gap-1 text-slate-600">
                        <UserX aria-hidden />
                        Cuenta desactivada
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{item.email}</p>
                </TableCell>
                <TableCell className="min-w-48 whitespace-normal">
                  <p className="font-medium leading-snug">{item.courseTitle}</p>
                  <p className="text-xs text-muted-foreground">Ciclo {item.cycle}</p>
                </TableCell>
                <TableCell className="text-sm">
                  {item.cohortName ? (
                    <span className="inline-flex items-center gap-1.5">
                      {item.cohortName}
                      {item.cohortClosed && (
                        <span className="text-xs text-muted-foreground">(cerrado)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Sin grupo</span>
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium tabular-nums">{item.expiresLabel}</p>
                  <p
                    className={cn(
                      "text-xs",
                      item.urgent ? "font-medium text-amber-700" : "text-muted-foreground"
                    )}
                  >
                    {item.relativeLabel}
                  </p>
                </TableCell>
                <TableCell>
                  <a
                    href={`/verify/${encodeURIComponent(item.folio)}`}
                    target="_blank"
                    rel="noopener"
                    title="Ver la verificación pública"
                    className="rounded-sm font-mono text-xs text-muted-foreground transition-colors hover:text-section-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.folio}
                    <span className="sr-only"> (verificación pública, se abre en otra pestaña)</span>
                  </a>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <RenewDialog
        key={`renew-${dialogKey}`}
        open={dialog === "renew"}
        onOpenChange={(open) => setDialog(open ? "renew" : null)}
        targets={dialogTargets}
        cohorts={cohorts}
        onDone={afterAction}
      />
      <DismissDialog
        key={`dismiss-${dialogKey}`}
        open={dialog === "dismiss"}
        onOpenChange={(open) => setDialog(open ? "dismiss" : null)}
        targets={dialogTargets}
        reasons={reasons}
        onDone={afterAction}
      />
    </section>
  );
}
