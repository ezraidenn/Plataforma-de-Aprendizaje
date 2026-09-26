"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { revokeCertificateAction } from "@/server/actions/teacher-templates";

export function RevokeCertificateDialog({
  certificateId,
  folio,
  studentName,
}: {
  certificateId: string;
  folio: string;
  studentName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function revoke() {
    startTransition(async () => {
      const result = await revokeCertificateAction(certificateId, reason);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Certificado ${folio} revocado`);
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          <ShieldX aria-hidden />
          Revocar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Revocar el certificado de {studentName}?</AlertDialogTitle>
          <AlertDialogDescription>
            El folio {folio} dejará de ser válido en la página de verificación. Esta acción no
            se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`revoke-reason-${certificateId}`}>Motivo</Label>
          <Textarea
            id={`revoke-reason-${certificateId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Ej. Se emitió por error"
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive-solid"
            onClick={revoke}
            disabled={pending || !reason.trim()}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? "Revocando…" : "Revocar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
