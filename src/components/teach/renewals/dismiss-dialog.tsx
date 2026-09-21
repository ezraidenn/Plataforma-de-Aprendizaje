"use client";

import { useState, useTransition } from "react";
import { Archive, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { dismissCertificatesAction } from "@/server/actions/teacher-renewals";
import { ChoiceOption } from "./choice-option";

export type DismissReason = Parameters<typeof dismissCertificatesAction>[1];
export type ReasonOption = { value: DismissReason; label: string };

export type DismissTarget = {
  certificateId: string;
  studentName: string;
  courseTitle: string;
  studentActive: boolean;
};

/**
 * Descartar en lote con motivo: salen del panel y quedan en el historial.
 * No revoca nada: el certificado sigue siendo auténtico.
 */
export function DismissDialog({
  open,
  onOpenChange,
  targets,
  reasons,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: DismissTarget[];
  reasons: ReasonOption[];
  onDone: () => void;
}) {
  // Si todas las cuentas están desactivadas, lo más probable es la baja
  const allInactive = targets.length > 0 && targets.every((t) => !t.studentActive);
  const [reason, setReason] = useState<DismissReason | null>(
    allInactive && reasons.some((r) => r.value === "baja") ? "baja" : null
  );
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const n = targets.length;
  const needsNote = reason === "otro";
  const ready = reason !== null && (!needsNote || note.trim().length > 0);

  function submit() {
    if (!ready || reason === null || n === 0) return;
    startTransition(async () => {
      const result = await dismissCertificatesAction(
        targets.map((t) => t.certificateId),
        reason,
        note.trim() || undefined
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { count } = result;
      toast.success(
        count === 1
          ? "Se descartó 1 certificado del panel"
          : `Se descartaron ${count} certificados del panel`,
        { description: "Quedan en el historial con el motivo." }
      );
      if (count < n) {
        const rest = n - count;
        toast.info(rest === 1 ? "1 ya se había atendido" : `${rest} ya se habían atendido`);
      }
      onOpenChange(false);
      onDone();
    });
  }

  const first = targets[0];
  const title =
    n === 1 && first ? `Descartar a ${first.studentName}` : `Descartar ${n} certificados`;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {n === 1 && first
              ? `Su certificado de «${first.courseTitle}» saldrá de Vencimientos.`
              : "Saldrán de Vencimientos y no se reinscribirán."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-xl border bg-muted/50 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            No se revoca nada: el certificado sigue siendo auténtico y verificable. La decisión queda
            registrada en el historial con el motivo.
          </p>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Motivo</legend>
          <RadioGroup
            value={reason ?? ""}
            onValueChange={(v) => setReason(v as DismissReason)}
            className="gap-2"
            aria-required
          >
            {reasons.map((option) => (
              <ChoiceOption
                key={option.value}
                id={`dismiss-${option.value}`}
                value={option.value}
                active={reason === option.value}
                title={option.label}
              />
            ))}
          </RadioGroup>
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor="dismiss-note">
            Nota{" "}
            <span className="font-normal text-muted-foreground">
              {needsNote ? "(obligatoria)" : "(opcional)"}
            </span>
          </Label>
          <Textarea
            id="dismiss-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            required={needsNote}
            aria-required={needsNote || undefined}
            placeholder={
              needsNote
                ? "Explica el motivo"
                : "Ej. Se le asignó el curso de la norma actualizada"
            }
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !ready || n === 0}
            className="bg-section text-white hover:bg-section-strong"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Archive aria-hidden />}
            {pending ? "Descartando…" : n === 1 ? "Descartar" : `Descartar (${n})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
