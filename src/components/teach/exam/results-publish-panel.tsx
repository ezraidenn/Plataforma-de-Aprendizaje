"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Loader2, Megaphone } from "lucide-react";
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
import { setExamResultsPublishedAction } from "@/server/actions/teacher-exams";

const DATE_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fmtDate = (ms: number) => DATE_FMT.format(new Date(ms));

const alumnos = (n: number) => (n === 1 ? "1 alumno" : `${n} alumnos`);

/**
 * Estado de los resultados en los modos «Al cerrar el examen» y «Cuando yo
 * decida», con «Publicar resultados» / «Ocultar». Trabaja sobre lo GUARDADO.
 */
export function ResultsPublishPanel({
  courseId,
  itemId,
  closesAtMs,
  publishedAtMs,
  visibleByClose,
  studentsWithAttempts,
  dirty,
}: {
  courseId: string;
  itemId: string;
  closesAtMs: number | null;
  publishedAtMs: number | null;
  /** «Al cerrar el examen» y el examen ya cerró: visibles sin publicar */
  visibleByClose: boolean;
  studentsWithAttempts: number;
  /** Hay cambios sin guardar en el modo o el cierre */
  dirty: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const hidden = publishedAtMs === null && !visibleByClose;

  function run(published: boolean) {
    startTransition(async () => {
      const result = await setExamResultsPublishedAction(courseId, itemId, published);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(published ? "Resultados publicados" : "Resultados ocultos", {
        description: published
          ? result.notified > 0
            ? `Se avisó a ${alumnos(result.notified)}.`
            : "No había alumnos por avisar."
          : "Los alumnos dejan de ver su calificación.",
      });
      router.refresh();
    });
  }

  return (
    <div
      data-results-panel
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5"
    >
      <div className="min-w-0 text-sm">
        {visibleByClose && closesAtMs !== null ? (
          <p>
            <span className="font-medium">Visibles desde el cierre</span> ({fmtDate(closesAtMs)})
          </p>
        ) : publishedAtMs !== null ? (
          <p>
            <span className="font-medium">Publicados el {fmtDate(publishedAtMs)}</span> · visibles
            para los alumnos
          </p>
        ) : (
          <p>
            <span className="font-medium">Resultados ocultos para los alumnos</span> ·{" "}
            {studentsWithAttempts} con intento
          </p>
        )}
        {dirty && (
          <p className="text-xs text-muted-foreground">Guarda los cambios para actualizar.</p>
        )}
      </div>

      {!visibleByClose && (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant={hidden ? "default" : "outline"} size="sm" disabled={pending}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : hidden ? (
                <Megaphone aria-hidden />
              ) : (
                <EyeOff aria-hidden />
              )}
              {hidden ? "Publicar resultados" : "Ocultar"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {hidden ? "¿Publicar los resultados?" : "¿Ocultar los resultados?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {hidden
                  ? studentsWithAttempts === 0
                    ? "Los alumnos verán su calificación en cuanto terminen el examen."
                    : studentsWithAttempts === 1
                      ? "El alumno con intento verá su calificación y recibirá un aviso."
                      : `Los ${studentsWithAttempts} alumnos con intento verán su calificación y recibirán un aviso.`
                  : "Los alumnos dejarán de ver su calificación. Los avisos ya enviados no se retiran."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(hidden)}>
                {hidden ? "Publicar resultados" : "Ocultar resultados"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
