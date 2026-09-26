"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  deleteCourseAction,
  deleteCoursePreviewAction,
  setCourseStatusAction,
  updateCourseAction,
} from "@/server/actions/teacher-courses";
import type { CourseDeleteImpact } from "@/server/services/courses";
import { DeleteForeverDialog } from "@/components/delete-forever-dialog";
import { setCourseCertificateTemplateAction } from "@/server/actions/teacher-templates";
import type { ValidityMode } from "@/lib/validity";
import { CourseValidityCard } from "@/components/teach/course-validity-card";
import { HelpTip } from "@/components/help/help-tip";
import { pulseHighlight } from "@/lib/guide-pulse";

const NO_TEMPLATE = "none";

export function CourseSettingsForm({
  course,
  templates,
}: {
  course: {
    id: string;
    title: string;
    description: string;
    enforceSequence: boolean;
    status: "draft" | "published" | "archived";
    certificateTemplateId: string | null;
    validityMode: ValidityMode;
    validityMonths: number | null;
  };
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [enforceSequence, setEnforceSequence] = useState(course.enforceSequence);
  const [templateId, setTemplateId] = useState(course.certificateTemplateId ?? NO_TEMPLATE);
  const [saving, startSaving] = useTransition();
  const [savingTemplate, startSavingTemplate] = useTransition();
  const [archiving, startArchiving] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<CourseDeleteImpact | null>(null);
  const [deleting, startDeleting] = useTransition();
  const diplomaRef = useRef<HTMLDivElement>(null);

  // Llegada desde la guía de primeros pasos: el bloque del diploma se trae a la
  // vista y late un momento, para que no haya que buscarlo en la página.
  useEffect(() => {
    if (window.location.hash !== "#diploma") return;
    // Tras el primer pintado, con el anim-rise ya colocado
    const id = window.setTimeout(() => pulseHighlight(diplomaRef.current), 350);
    return () => window.clearTimeout(id);
  }, []);

  function changeTemplate(next: string) {
    const previous = templateId;
    setTemplateId(next);
    startSavingTemplate(async () => {
      const result = await setCourseCertificateTemplateAction(
        course.id,
        next === NO_TEMPLATE ? null : next
      );
      if ("error" in result) {
        setTemplateId(previous);
        toast.error(result.error);
        return;
      }
      toast.success(
        next === NO_TEMPLATE
          ? "El curso quedó sin certificado"
          : "Plantilla de certificado asignada"
      );
      router.refresh();
    });
  }

  function save() {
    startSaving(async () => {
      const result = await updateCourseAction(course.id, {
        title,
        description,
        enforceSequence,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Ajustes guardados");
      router.refresh();
    });
  }

  function setArchived(archived: boolean) {
    startArchiving(async () => {
      const result = await setCourseStatusAction(course.id, archived ? "archived" : "draft");
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(archived ? "Curso archivado" : "El curso volvió a borrador");
      router.refresh();
    });
  }

  function openDelete() {
    setDeleteImpact(null);
    setDeleteOpen(true);
    startDeleting(async () => {
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
    startDeleting(async () => {
      const result = await deleteCourseAction(course.id, confirmWord);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Se eliminó «${course.title}»`);
      setDeleteOpen(false);
      router.push("/teach/courses");
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="anim-rise anim-d1 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <CardHeader>
          <CardTitle className="font-heading text-base">Información general</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="settings-title">Título</Label>
            <Input
              id="settings-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-description">Descripción</Label>
            <Textarea
              id="settings-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="settings-sequence">Progresión secuencial estricta</Label>
                <HelpTip topic="course.sequential" value={{ enabled: enforceSequence }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Cada lección se desbloquea al completar la anterior. Puedes hacer excepciones por
                lección en la pestaña Contenido.
              </p>
            </div>
            <Switch
              id="settings-sequence"
              checked={enforceSequence}
              onCheckedChange={setEnforceSequence}
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={save}
              disabled={saving || !title.trim()}
              className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
            >
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {saving ? "Guardando…" : "Guardar ajustes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* #diploma: destino del paso «Elegir diploma» de la guía */}
      <Card
        id="diploma"
        ref={diplomaRef}
        className="anim-rise anim-d2 scroll-mt-24 shadow-[0_1px_2px_rgb(15_23_42/0.05)]"
      >
        <CardHeader>
          <CardTitle className="font-heading text-base">Certificado</CardTitle>
          <CardDescription>
            El diploma que recibe el estudiante al aprobar este curso.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="settings-certificate">Plantilla de certificado</Label>
            <HelpTip topic="course.certificate" />
          </div>
          <div className="flex items-center gap-2">
            <Select value={templateId} onValueChange={changeTemplate} disabled={savingTemplate}>
              <SelectTrigger
                id="settings-certificate"
                className="w-full max-w-sm data-[size=default]:h-11"
              >
                <SelectValue placeholder="Sin certificado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>Sin certificado</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {savingTemplate && (
              <Loader2 className="size-4 animate-spin text-section-strong" aria-hidden />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Al aprobar, el certificado se genera automáticamente.
          </p>
          {templates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aún no tienes plantillas.{" "}
              <Link href="/teach/templates" className="font-medium text-section-strong underline-offset-2 hover:underline">
                Crea una en Certificados
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <CourseValidityCard
        courseId={course.id}
        initialMode={course.validityMode}
        initialMonths={course.validityMonths}
        hasCertificate={templateId !== NO_TEMPLATE}
        className="anim-rise anim-d3"
      />

      <Card className="anim-rise anim-d4 border-destructive/30 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <CardHeader>
          <CardTitle className="font-heading text-base text-destructive">
            Zona de peligro
          </CardTitle>
          <CardDescription>
            {course.status === "archived"
              ? "Este curso está archivado: los estudiantes no lo ven."
              : "Archivar oculta el curso a los estudiantes sin borrar su progreso."}{" "}
            {course.status === "published"
              ? "Para eliminarlo para siempre, archívalo primero."
              : "Eliminar lo borra para siempre, con su contenido y matrículas."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {course.status === "archived" ? (
            <Button
              variant="outline"
              className="h-11"
              disabled={archiving}
              onClick={() => setArchived(false)}
            >
              {archiving ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ArchiveRestore aria-hidden />
              )}
              Reactivar como borrador
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="h-11" disabled={archiving}>
                  {archiving ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Archive aria-hidden />
                  )}
                  Archivar curso
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Archivar «{course.title}»?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Los estudiantes dejarán de verlo y nadie podrá avanzar. El contenido y el
                    progreso se conservan; puedes reactivarlo cuando quieras.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction variant="destructive-solid" onClick={() => setArchived(true)}>
                    Archivar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {course.status !== "published" && (
            <Button
              variant="outline"
              className="h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleting || archiving}
              onClick={openDelete}
            >
              <Trash2 aria-hidden />
              Eliminar definitivamente
            </Button>
          )}
        </CardContent>
      </Card>

      <DeleteForeverDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`¿Eliminar definitivamente «${course.title}»?`}
        description="No se puede deshacer. Si solo quieres ocultarlo, déjalo archivado."
        loading={!deleteImpact}
        blockers={deleteImpact?.blockers}
        pending={deleting && !!deleteImpact}
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
    </div>
  );
}
