"use client";

import { useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCohortAction } from "@/server/actions/teacher-cohorts";

export type NewCohortCourse = { id: string; title: string };

/**
 * Crea un grupo vacío en un curso (los grupos son propios de cada curso); las
 * matrículas se asignan al inscribir o desde la lista del curso.
 */
export function NewCohortDialog({
  courses,
  defaultCourseId,
}: {
  /** Cursos donde se puede crear (activos, del maestro) */
  courses: NewCohortCourse[];
  /** Curso preseleccionado (p. ej. el filtrado en la página) */
  defaultCourseId?: string;
}) {
  const router = useRouter();
  // Preselección: el curso filtrado o, si solo hay uno, ese
  const initialCourse =
    defaultCourseId && courses.some((c) => c.id === defaultCourseId)
      ? defaultCourseId
      : courses.length === 1
        ? courses[0].id
        : "";
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState(initialCourse);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const course = courses.find((c) => c.id === courseId);
  const clean = name.trim();
  const valid = Boolean(course) && clean.length >= 2 && clean.length <= 80;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !course) return;
    startTransition(async () => {
      const result = await createCohortAction(course.id, clean);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Grupo «${result.name}» creado`, { description: `En «${course.title}».` });
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        // Cada apertura empieza limpia, con el curso filtrado en ese momento
        if (next) {
          setCourseId(initialCourse);
          setName("");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-11 bg-section px-4 text-white hover:bg-section-strong">
          <Plus aria-hidden />
          Nuevo grupo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nuevo grupo</DialogTitle>
            <DialogDescription>
              Cada grupo pertenece a un curso y reúne una oleada de sus alumnos. Podrás asignarlo
              al inscribir o mover alumnos después desde la lista del curso.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-cohort-course">Curso</Label>
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger
                id="new-cohort-course"
                className="w-full data-[size=default]:h-11"
                aria-required
                aria-describedby="new-cohort-course-hint"
              >
                <SelectValue placeholder="Elige un curso" />
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="new-cohort-course-hint" className="text-xs text-muted-foreground">
              El grupo solo aparecerá en este curso: sus listas, reportes y estadísticas.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-cohort-name">Nombre del grupo</Label>
            <Input
              id="new-cohort-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Ingreso octubre 2026"
              maxLength={80}
              autoFocus={Boolean(initialCourse)}
              required
              aria-describedby="new-cohort-name-hint"
              className="h-11"
            />
            <p id="new-cohort-name-hint" className="text-xs text-muted-foreground">
              Usa algo que identifique la oleada: fecha de ingreso, empresa, turno…
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="h-11 bg-section text-white hover:bg-section-strong"
              disabled={pending || !valid}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Creando…" : "Crear grupo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
