"use client";

import { useState, useTransition } from "react";
import { Maximize2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { applicableRows, type AssistantBlock, type ProposalRow } from "@/lib/assistant-blocks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { applyProposalAction, cancelProposalAction } from "@/server/actions/assistant";

type ProposalBlock = Extract<AssistantBlock, { type: "proposal" }>;

/** Filas visibles dentro del panel; el resto se ve en el diálogo ampliado. */
const PREVIEW_ROWS = 5;

/**
 * Tabla editable con lo que el asistente propone hacer. El maestro corrige
 * celdas, quita filas y aplica; una vez aplicada o cancelada queda congelada.
 */
export function ReviewTable({
  block,
  onChange,
}: {
  block: ProposalBlock;
  /** `extra`: lo que dejó la acción al aplicar (la descarga de las contraseñas, enlaces) */
  onChange(next: ProposalBlock, extra?: AssistantBlock[]): void;
}) {
  const [rows, setRows] = useState<ProposalRow[]>(block.rows);
  const [wide, setWide] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, startTransition] = useTransition();
  const frozen = block.status !== "pending";
  // El botón cuenta solo lo que hoy se puede aplicar; con `recheckOnApply` las
  // filas con aviso también se mandan y se vuelven a revisar en el servidor,
  // así que se avisa aparte en vez de inflar el número
  const count = applicableRows(rows).length;
  const retryNote = !frozen && !!block.recheckOnApply && rows.some((r) => r.blocked);
  // Lo irreversible pide escribir la palabra tal cual, sin distinguir mayúsculas ni espacios
  const needsConfirm = !frozen && !!block.confirmWord;
  const confirmed = !needsConfirm || confirmText.trim().toLowerCase() === block.confirmWord!.toLowerCase();

  const editCell = (rowId: string, key: string, value: string) =>
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [key]: value } } : r)));
  const removeRow = (rowId: string) => setRows((rs) => rs.filter((r) => r.id !== rowId));

  const apply = () =>
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof applyProposalAction>>;
      try {
        result = await applyProposalAction({ proposalId: block.proposalId, rows, confirm: confirmText });
      } catch {
        result = { error: "No se pudo aplicar. Inténtalo de nuevo." };
      }
      if ("error" in result) {
        toast.error(result.error, { position: "top-center" });
        if (result.error.toLowerCase().includes("caducó")) onChange({ ...block, status: "expired" });
        return;
      }
      toast.success(result.text, { position: "top-center" });
      onChange({ ...block, rows, status: "applied", resultText: result.text }, result.blocks);
      setWide(false);
    });

  const cancel = () =>
    startTransition(async () => {
      try {
        await cancelProposalAction({ proposalId: block.proposalId });
      } catch {
        /* si el servidor no responde, igual se descarta en pantalla */
      }
      onChange({ ...block, status: "cancelled" });
      setWide(false);
    });

  const statusText =
    block.resultText ??
    (block.status === "applied"
      ? "Aplicada"
      : block.status === "cancelled"
        ? "Cancelada"
        : block.status === "expired"
          ? "Caducó; vuelve a pedirla"
          : "");

  const footer = (
    <div className="space-y-2">
      {retryNote && (
        <p className="text-[11.5px] leading-snug text-amber-700">
          Las filas en ámbar se intentarán de nuevo al aplicar, con lo que escribas.
        </p>
      )}
      {needsConfirm && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-red-600">
            Esto no se puede deshacer. Para confirmar, escribe <span className="font-semibold">{block.confirmWord}</span>.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label={`Escribe ${block.confirmWord} para confirmar`}
            autoComplete="off"
            className="h-8 max-w-[220px] text-[13px]"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        {frozen ? (
          <p className="text-[12px] text-slate-500">{statusText}</p>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant={needsConfirm ? "destructive" : undefined}
              onClick={apply}
              disabled={count === 0 || busy || !confirmed}
              className={needsConfirm ? undefined : "bg-indigo-600 text-white hover:bg-indigo-700"}
            >
              {block.applyLabel} {count}
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const table = (limit?: number) => {
    const shown = limit ? rows.slice(0, limit) : rows;
    return (
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-slate-200">
            {block.columns.map((c) => (
              <th key={c.key} scope="col" className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {c.label}
              </th>
            ))}
            {!frozen && (
              <th scope="col" className="w-8 px-1 py-1.5">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id} className={cn("border-b border-slate-100 align-top", row.warning && "bg-amber-50")}>
              {block.columns.map((c, i) => {
                // Una fila bloqueada solo se edita si la propuesta la va a
                // volver a revisar; si no, corregirla no serviría de nada: se
                // enseña en gris tachado, como las columnas de solo lectura
                const editable = !frozen && c.editable !== false && (!row.blocked || !!block.recheckOnApply);
                const value = row.cells[c.key] ?? "";
                return (
                  <td key={c.key} className="px-1 py-1">
                    {editable ? (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => editCell(row.id, c.key, e.target.value)}
                        aria-label={`${c.label}, fila ${row.id}`}
                        className="w-full min-w-[80px] rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-800 outline-none hover:border-slate-300 focus:border-indigo-400 focus:bg-white"
                      />
                    ) : (
                      <span className={cn("block px-1 py-0.5", row.blocked ? "text-slate-400 line-through" : "text-slate-800")}>{value}</span>
                    )}
                    {i === 0 && row.warning && <p className="mt-0.5 px-1 text-[11px] leading-snug text-amber-700">{row.warning}</p>}
                  </td>
                );
              })}
              {!frozen && (
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    aria-label="Quitar fila"
                    title="Quitar fila"
                    className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={block.columns.length + 1} className="px-2 py-3 text-center text-slate-500">
                No queda ninguna fila.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  };

  const summary = `${rows.length} ${rows.length === 1 ? "fila" : "filas"} · ${block.title}`;

  return (
    <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white", frozen && "opacity-90")}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Pencil className="size-3.5 shrink-0 text-indigo-600" aria-hidden />
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-800">
          {frozen ? block.title : "Revisa antes de aplicar"}
        </span>
        <span className="ml-auto min-w-0 truncate text-[11px] text-slate-500">{summary}</span>
        <button
          type="button"
          onClick={() => setWide(true)}
          aria-label="Ampliar"
          title="Ampliar"
          className="flex size-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <Maximize2 className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="overflow-x-auto">{table(PREVIEW_ROWS)}</div>
      {rows.length > PREVIEW_ROWS && (
        <button
          type="button"
          onClick={() => setWide(true)}
          className="w-full border-t border-slate-100 py-1.5 text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-50"
        >
          Ver las {rows.length} filas
        </button>
      )}
      <div className="border-t border-slate-100 px-3 py-2">{footer}</div>

      <Dialog open={wide} onOpenChange={setWide}>
        {/* Esc cierra solo el diálogo: el panel escucha Escape en window y también se cerraría */}
        <DialogContent className="max-w-[960px] sm:max-w-[960px]" onEscapeKeyDown={(e) => e.stopPropagation()} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{block.title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">{table()}</div>
          {footer}
        </DialogContent>
      </Dialog>
    </div>
  );
}
