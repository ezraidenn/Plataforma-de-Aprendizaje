"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, EllipsisVertical, KeyRound, TriangleAlert, UserRoundCheck, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  resetStudentPasswordAction,
  setStudentActiveAction,
} from "@/server/actions/teacher-students";
import { SHARED_STUDENT_DEACTIVATE_MSG, SHARED_STUDENT_RESET_MSG } from "@/lib/student-account";

export function StudentActions({
  student,
  canDeactivate,
  canResetPassword,
}: {
  student: { id: string; fullName: string; email: string; active: boolean };
  /** false = alumno compartido con otro maestro: solo el admin puede desactivarlo (reactivar sí se puede) */
  canDeactivate: boolean;
  /** false = alumno compartido con otro maestro: solo el admin restablece su contraseña */
  canResetPassword: boolean;
}) {
  const router = useRouter();
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  function resetPassword() {
    startTransition(async () => {
      const result = await resetStudentPasswordAction(student.id);
      if ("error" in result) {
        toast.error(result.error);
        setResetOpen(false);
        return;
      }
      setNewPassword(result.password);
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const result = await setStudentActiveAction(student.id, !student.active);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          student.active
            ? `La cuenta de ${student.fullName} quedó desactivada`
            : `La cuenta de ${student.fullName} quedó activa de nuevo`
        );
        router.refresh();
      }
      setToggleOpen(false);
    });
  }

  async function copyPassword() {
    if (!newPassword) return;
    if (await copyToClipboard(newPassword)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("No se pudo copiar. Copia el texto manualmente.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Opciones de ${student.fullName}`}
          >
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!canResetPassword ? (
            <DropdownMenuItem
              className="text-muted-foreground"
              onSelect={() => toast.info(SHARED_STUDENT_RESET_MSG)}
            >
              <KeyRound aria-hidden />
              Restablecer contraseña…
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => {
                setNewPassword(null);
                setCopied(false);
                setResetOpen(true);
              }}
            >
              <KeyRound aria-hidden />
              Restablecer contraseña
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {student.active && !canDeactivate ? (
            <DropdownMenuItem
              className="text-muted-foreground"
              onSelect={() => toast.info(SHARED_STUDENT_DEACTIVATE_MSG)}
            >
              <UserRoundX aria-hidden />
              Desactivar cuenta…
            </DropdownMenuItem>
          ) : student.active ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setToggleOpen(true)}>
              <UserRoundX aria-hidden />
              Desactivar cuenta
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setToggleOpen(true)}>
              <UserRoundCheck aria-hidden />
              Activar cuenta
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Restablecer contraseña: confirmación y luego la nueva contraseña UNA vez */}
      <Dialog
        open={resetOpen}
        onOpenChange={(o) => {
          setResetOpen(o);
          if (!o) setNewPassword(null);
        }}
      >
        <DialogContent>
          {newPassword ? (
            <>
              <DialogHeader>
                <DialogTitle>Nueva contraseña de {student.fullName}</DialogTitle>
                <DialogDescription>
                  Compártela ahora: no se volverá a mostrar.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 rounded-xl border bg-muted/40 p-4">
                <p className="text-sm font-semibold tracking-wide">{newPassword}</p>
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  La contraseña anterior dejó de funcionar.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={copyPassword}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copiada" : "Copiar contraseña"}
                </Button>
                <Button
                  className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                  onClick={() => setResetOpen(false)}
                >
                  Listo
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>¿Restablecer la contraseña de {student.fullName}?</DialogTitle>
                <DialogDescription>
                  Se generará una contraseña temporal nueva y la actual dejará de funcionar.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setResetOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                  onClick={resetPassword}
                >
                  Restablecer
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Activar / desactivar cuenta */}
      <AlertDialog open={toggleOpen} onOpenChange={setToggleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {student.active
                ? `¿Desactivar la cuenta de ${student.fullName}?`
                : `¿Activar la cuenta de ${student.fullName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {student.active
                ? "No podrá iniciar sesión hasta que la reactives. Su progreso se conserva."
                : "Podrá volver a iniciar sesión con su contraseña actual."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={
                student.active
                  ? "bg-destructive text-white hover:bg-destructive/90"
                  : "bg-cta text-cta-foreground hover:bg-cta/90"
              }
              onClick={toggleActive}
            >
              {student.active ? "Desactivar" : "Activar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
