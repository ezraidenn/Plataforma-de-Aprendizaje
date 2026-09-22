"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, LockOpen, Pencil, Trash2 } from "lucide-react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteCohortAction,
  renameCohortAction,
  setCohortStatusAction,
} from "@/server/actions/teacher-cohorts";
import { HelpTip } from "@/components/help/help-tip";
import { DeleteForeverDialog } from "@/components/delete-forever-dialog";

/**
 * Renombrar, cerrar/reabrir (no borra nada) y eliminar un grupo (pie de la
 * tarjeta). Eliminar borra solo el grupo: sus alumnos siguen en el curso.
 */
export function CohortActions({
  cohort,
}: {
  cohort: { id: string; name: string; status: "open" | "closed"; enrollmentCount: number };
}) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(cohort.name);
  const [statusOpen, setStatusOpen] = useState(false);
  const [renaming, startRename] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  const isOpen = cohort.status === "open";
  const clean = name.trim();
  const validName = clean.length >= 2 && clean.length <= 80 && clean !== cohort.name;
  const count = cohort.enrollmentCount;
  const countLabel = count === 1 ? "1 matrícula" : `${count.toLocaleString("es-MX")} matrículas`;

  function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!validName) return;
    startRename(async () => {
      const result = await renameCohortAction(cohort.id, clean);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Grupo renombrado a «${clean}»`);
      setRenameOpen(false);
      router.refresh();
    });
  }

  function toggleStatus() {
    startToggle(async () => {
      const result = await setCohortStatusAction(cohort.id, isOpen ? "closed" : "open");
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          isOpen
            ? `«${cohort.name}» quedó cerrado. Nada se borró.`
            : `«${cohort.name}» está abierto de nuevo`
        );
        router.refresh();
      }
      setStatusOpen(false);
    });
  }

  function deleteForever(confirmWord: string) {
    startDelete(async () => {
      const result = await deleteCohortAction(cohort.id, confirmWord);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Se eliminó el grupo «${cohort.name}»`);
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 px-3"
        onClick={() => {
          setName(cohort.name);
          setRenameOpen(true);
        }}
        aria-label={`Renombrar el grupo ${cohort.name}`}
      >
        <Pencil aria-hidden />
        Renombrar
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9 px-3"
        onClick={() => setStatusOpen(true)}
        disabled={toggling}
        aria-label={isOpen ? `Cerrar el grupo ${cohort.name}` : `Reabrir el grupo ${cohort.name}`}
      >
        {toggling ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : isOpen ? (
          <Lock aria-hidden />
        ) : (
          <LockOpen aria-hidden />
        )}
        {isOpen ? "Cerrar grupo" : "Reabrir"}
      </Button>
      <HelpTip topic="groups.close" value={{ status: cohort.status }} />
      <Button
        variant="ghost"
        size="sm"
        className="h-9 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
        disabled={deleting}
        aria-label={`Eliminar el grupo ${cohort.name}`}
      >
        <Trash2 aria-hidden />
        Eliminar
      </Button>

      <DeleteForeverDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`¿Eliminar el grupo «${cohort.name}»?`}
        description="Se borra el grupo, no sus alumnos. Si solo quieres ocultarlo, ciérralo."
        pending={deleting}
        onConfirm={deleteForever}
        summary={
          <>
            <p className="font-semibold">Se borrará para siempre el grupo «{cohort.name}».</p>
            <p>
              {count === 0
                ? "No tiene matrículas."
                : `Sus ${countLabel} no se borran: siguen en el curso con su avance, calificaciones y certificados, sin grupo.`}
            </p>
          </>
        }
      />

      {/* Renombrar */}
      <Dialog
        open={renameOpen}
        onOpenChange={(next) => {
          if (renaming) return;
          setRenameOpen(next);
        }}
      >
        <DialogContent>
          <form onSubmit={rename} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Renombrar grupo</DialogTitle>
              <DialogDescription>
                El nombre nuevo se verá en todas las listas, filtros y reportes.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`rename-cohort-${cohort.id}`}>Nombre del grupo</Label>
              <Input
                id={`rename-cohort-${cohort.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                required
                className="h-11"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setRenameOpen(false)}
                disabled={renaming}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-11 bg-section text-white hover:bg-section-strong"
                disabled={renaming || !validName}
              >
                {renaming && <Loader2 className="animate-spin" aria-hidden />}
                {renaming ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cerrar / reabrir: se explica que no se borra nada */}
      <AlertDialog open={statusOpen} onOpenChange={setStatusOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOpen ? `¿Cerrar el grupo «${cohort.name}»?` : `¿Reabrir el grupo «${cohort.name}»?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {isOpen ? (
                <div className="space-y-2">
                  <p>
                    Sus {countLabel} dejarán de aparecer en las vistas diarias (Estudiantes del
                    curso, Reportes y Estadísticas) y ya no se ofrecerá al inscribir.
                  </p>
                  <p className="font-medium text-foreground">
                    No se borra nada: avance, calificaciones y certificados quedan intactos, siguen
                    en los perfiles y con el filtro «Todos (incl. cerrados)». Puedes reabrirlo
                    cuando quieras.
                  </p>
                </div>
              ) : (
                <p>
                  Sus {countLabel} vuelven a aparecer en las vistas diarias y el grupo vuelve a
                  estar disponible al inscribir.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggling}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-section text-white hover:bg-section-strong"
              disabled={toggling}
              onClick={(e) => {
                e.preventDefault();
                toggleStatus();
              }}
            >
              {toggling && <Loader2 className="animate-spin" aria-hidden />}
              {isOpen ? "Cerrar grupo" : "Reabrir grupo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
