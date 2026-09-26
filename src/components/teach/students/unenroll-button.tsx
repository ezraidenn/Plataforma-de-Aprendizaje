"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  restoreEnrollmentsAction,
  unenrollStudentAction,
} from "@/server/actions/teacher-students";
import { HelpTip } from "@/components/help/help-tip";

export function UnenrollButton({
  courseId,
  studentId,
  studentName,
  enrollmentId,
}: {
  courseId: string;
  studentId: string;
  studentName: string;
  /** Si se conoce, el aviso ofrece «Deshacer» (restaura desde la papelera) */
  enrollmentId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function undo() {
    if (!enrollmentId) return;
    void restoreEnrollmentsAction(courseId, [enrollmentId]).then((result) => {
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${studentName} volvió al curso tal como estaba`);
      router.refresh();
    });
  }

  function confirm() {
    startTransition(async () => {
      const result = await unenrollStudentAction(courseId, studentId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Se quitó a ${studentName} del curso`, {
          description: "Está en la Papelera: puedes restaurarlo sin perder nada.",
          action: enrollmentId ? { label: "Deshacer", onClick: undo } : undefined,
        });
        router.refresh();
      }
      setOpen(false);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Quitar a ${studentName} del curso`}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserMinus aria-hidden />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-1.5">
            ¿Quitar a {studentName} del curso?
            <HelpTip topic="students.trash" />
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>Dejará de ver el curso y saldrá de esta lista.</p>
              <p className="font-medium text-foreground">
                No se pierde nada: su avance, calificaciones, certificado y estatus se conservan, y
                puedes restaurarlo cuando quieras desde la Papelera.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive-solid" onClick={confirm}>
            Quitar del curso
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
