"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCourseAction } from "@/server/actions/teacher-courses";
import { OnBehalfNote } from "@/components/teach/on-behalf-note";
import { OpenFromUrl } from "@/components/open-from-url";
import { clearUrlParam, useOpenDialogRequest } from "@/lib/open-dialog";

/** `urlTrigger`: solo una instancia por página debe abrirse sola */
export function NewCourseDialog({ urlTrigger = false }: { urlTrigger?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createCourseAction({ title, description });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Curso creado. Ahora agrega su contenido.");
      setOpen(false);
      router.push(`/teach/courses/${result.courseId}/content`);
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTitle("");
      setDescription("");
      clearUrlParam("nuevo");
    }
  }

  const openFromUrl = useCallback(() => setOpen(true), []);
  // Misma regla que ?nuevo=1: solo la instancia marcada se abre sola
  useOpenDialogRequest("new-course", () => {
    if (urlTrigger) setOpen(true);
  });

  return (
    <>
      {urlTrigger && <OpenFromUrl param="nuevo" onOpen={openFromUrl} />}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90">
            <Plus aria-hidden />
            Nuevo curso
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Nuevo curso</DialogTitle>
              <DialogDescription>
                El curso nace como borrador: nadie lo verá hasta que lo publiques.
              </DialogDescription>
            </DialogHeader>
            <OnBehalfNote subject="El curso" />
            <div className="grid gap-2">
              <Label htmlFor="new-course-title">Título</Label>
              <Input
                id="new-course-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Seguridad Industrial"
                autoFocus
                required
                maxLength={200}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-course-description">Descripción (opcional)</Label>
              <Textarea
                id="new-course-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="¿De qué trata este curso?"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => handleOpenChange(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                disabled={pending || !title.trim()}
              >
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {pending ? "Creando…" : "Crear curso"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
