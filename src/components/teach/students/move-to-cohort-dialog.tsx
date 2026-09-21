"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Loader2 } from "lucide-react";
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
import {
  CohortPicker,
  NO_COHORT,
  isCohortChoiceReady,
  type CohortChoice,
} from "@/components/teach/cohort-picker";
import { assignToCohortAction } from "@/server/actions/teacher-cohorts";

/**
 * Mueve las matrículas seleccionadas a un grupo DEL CURSO (existente o nuevo)
 * o las deja sin grupo.
 */
export function MoveToCohortDialog({
  courseId,
  enrollmentIds,
  open,
  onOpenChange,
  onDone,
}: {
  courseId: string;
  enrollmentIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<CohortChoice>(NO_COHORT);
  const [label, setLabel] = useState("Sin grupo (quitar del grupo)");
  const [pending, startTransition] = useTransition();

  const n = enrollmentIds.length;
  const toNone = !choice.cohortId && typeof choice.newCohortName !== "string";

  function submit() {
    if (!isCohortChoiceReady(choice) || n === 0) return;
    startTransition(async () => {
      const result = await assignToCohortAction(courseId, enrollmentIds, choice);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const who = result.count === 1 ? "1 matrícula" : `${result.count} matrículas`;
      toast.success(
        toNone
          ? `${who} ${result.count === 1 ? "quedó" : "quedaron"} sin grupo`
          : `${who} ${result.count === 1 ? "movida" : "movidas"} a «${label}»`
      );
      onOpenChange(false);
      setChoice(NO_COHORT);
      onDone();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
        if (!next) setChoice(NO_COHORT);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Mover {n === 1 ? "1 estudiante" : `${n} estudiantes`} a un grupo
          </DialogTitle>
          <DialogDescription>
            Solo cambia el grupo: su avance, calificaciones y certificados no se tocan.
          </DialogDescription>
        </DialogHeader>

        <CohortPicker
          courseId={courseId}
          value={choice}
          onChange={(next, nextLabel) => {
            setChoice(next);
            setLabel(nextLabel);
          }}
          label="Grupo de destino"
          noneLabel="Sin grupo (quitar del grupo)"
          disabled={pending}
        />

        <DialogFooter>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            className="h-11 bg-section text-white hover:bg-section-strong"
            onClick={submit}
            disabled={pending || n === 0 || !isCohortChoiceReady(choice)}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <FolderInput aria-hidden />
            )}
            {toNone ? "Quitar del grupo" : "Mover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
