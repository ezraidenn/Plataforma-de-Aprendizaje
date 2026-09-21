"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deleteTemplateAction } from "@/server/actions/teacher-templates";

export function TemplateCardMenu({
  templateId,
  name,
  usedBy = 0,
}: {
  templateId: string;
  name: string;
  /** Cursos que tienen asignada la plantilla */
  usedBy?: number;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [, startTransition] = useTransition();

  function confirmDelete() {
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await deleteTemplateAction(templateId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Se eliminó «${name}»`);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="absolute right-2 top-2"
            aria-label={`Opciones de «${name}»`}
          >
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {usedBy > 0 ? (
                <>
                  <span className="font-medium text-foreground">
                    {usedBy === 1 ? "La usa 1 curso" : `La usan ${usedBy} cursos`}
                  </span>
                  : {usedBy === 1 ? "quedará" : "quedarán"} sin certificado hasta que se elija otra
                  plantilla.{" "}
                </>
              ) : (
                "Ningún curso la usa. "
              )}
              Los certificados ya emitidos no se tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
