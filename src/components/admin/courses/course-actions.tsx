"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, EllipsisVertical, ExternalLink, Loader2, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminWarningBanner } from "@/components/admin/admin-warning-banner";
import { ROLE_LABEL } from "@/components/admin/format";
import {
  adminArchiveCourseAction,
  adminReassignCourseAction,
} from "@/server/actions/admin-courses";
import { deleteCourseAction, deleteCoursePreviewAction } from "@/server/actions/teacher-courses";
import type { CourseDeleteImpact } from "@/server/services/courses";
import { DeleteForeverDialog } from "@/components/delete-forever-dialog";

export type OwnerOption = {
  id: string;
  fullName: string;
  role: "admin" | "teacher";
};

export function CourseActions({
  course,
  owners,
}: {
  course: {
    id: string;
    title: string;
    status: "draft" | "published" | "archived";
    ownerId: string;
    ownerName: string;
  };
  owners: OwnerOption[];
}) {
  const router = useRouter();
  const [reassignOpen, setReassignOpen] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<CourseDeleteImpact | null>(null);
  const [pending, startTransition] = useTransition();

  const candidates = owners.filter((o) => o.id !== course.ownerId);
  const selectedOwner = candidates.find((o) => o.id === newOwnerId);

  function reassign() {
    startTransition(async () => {
      const result = await adminReassignCourseAction(course.id, newOwnerId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          selectedOwner
            ? `«${course.title}» ahora pertenece a ${selectedOwner.fullName}`
            : "El curso cambió de dueño"
        );
        setReassignOpen(false);
        router.refresh();
      }
    });
  }

  function archive() {
    startTransition(async () => {
      const result = await adminArchiveCourseAction(course.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`«${course.title}» quedó archivado`);
        router.refresh();
      }
      setArchiveOpen(false);
    });
  }

  function openDelete() {
    setDeleteImpact(null);
    setDeleteOpen(true);
    startTransition(async () => {
      const result = await deleteCoursePreviewAction(course.id);
      if ("error" in result) {
        toast.error(result.error);
        setDeleteOpen(false);
      } else {
        setDeleteImpact(result.impact);
      }
    });
  }

  function deleteForever(confirmWord: string) {
    startTransition(async () => {
      const result = await deleteCourseAction(course.id, confirmWord);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Se eliminó «${course.title}»`);
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Opciones de ${course.title}`}>
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/teach/courses/${course.id}/content`}>
              <ExternalLink aria-hidden />
              Abrir como maestro
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setNewOwnerId("");
              setReassignOpen(true);
            }}
          >
            <UserCog aria-hidden />
            Reasignar dueño
          </DropdownMenuItem>
          {course.status !== "archived" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setArchiveOpen(true)}>
                <Archive aria-hidden />
                Archivar
              </DropdownMenuItem>
            </>
          )}
          {course.status !== "published" && (
            <>
              {course.status === "archived" && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onSelect={openDelete}>
                <Trash2 aria-hidden />
                Eliminar definitivamente
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteForeverDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`¿Eliminar definitivamente «${course.title}»?`}
        description={`Curso de ${course.ownerName}. No se puede deshacer.`}
        loading={!deleteImpact}
        blockers={deleteImpact?.blockers}
        pending={pending && !!deleteImpact}
        onConfirm={deleteForever}
        summary={
          deleteImpact && (
            <>
              <p className="font-semibold">Se borrará para siempre:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{deleteImpact.items} lección(es) con sus documentos, exámenes y tareas</li>
                <li>
                  {deleteImpact.enrollments} matrícula(s) con su avance, intentos y entregas (las
                  cuentas de los alumnos no se borran)
                </li>
                {deleteImpact.cohorts > 0 && <li>{deleteImpact.cohorts} grupo(s) del curso</li>}
                <li>Sus archivos en el almacenamiento</li>
              </ul>
            </>
          )
        }
      />

      {/* Reasignar dueño */}
      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reasignar «{course.title}»</DialogTitle>
            <DialogDescription>
              Dueño actual: {course.ownerName}. El curso pasará a «Mis cursos» del nuevo dueño,
              quien podrá editarlo, calificar y matricular.
            </DialogDescription>
          </DialogHeader>
          <AdminWarningBanner />
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay otros maestros o administradores activos a quienes asignar este curso.
            </p>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor={`owner-${course.id}`}>Nuevo dueño</Label>
              <Select value={newOwnerId} onValueChange={setNewOwnerId}>
                <SelectTrigger
                  id={`owner-${course.id}`}
                  className="w-full"
                  aria-label="Nuevo dueño del curso"
                >
                  <SelectValue placeholder="Elige un maestro o administrador…" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.fullName} — {ROLE_LABEL[owner.role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setReassignOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
              onClick={reassign}
              disabled={pending || !newOwnerId}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Reasignando…" : "Reasignar curso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archivar */}
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar «{course.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Los estudiantes dejarán de verlo en su tablero y nadie podrá avanzar en él. El
              progreso se conserva y el dueño podrá volver a publicarlo más adelante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AdminWarningBanner />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={archive}
            >
              Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
