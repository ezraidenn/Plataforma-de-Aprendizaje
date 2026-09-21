"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crop, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CourseCover } from "@/components/course-cover";
import { uploadFile } from "@/lib/upload-client";
import { setCourseCoverAction } from "@/server/actions/teacher-courses";
import { CoverCropDialog } from "./cover-crop-dialog";
import { HelpTip } from "@/components/help/help-tip";

/**
 * Foto del curso (opcional). Al elegir una imagen se abre el editor de
 * encuadre (arrastrar / zoom / reajustar); la foto actual también se puede
 * reencuadrar. Sin foto, el curso muestra un degradado propio y estable.
 */
export function CourseCoverCard({
  courseId,
  coverFileId,
}: {
  courseId: string;
  coverFileId: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(coverFileId);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [busy, startBusy] = useTransition();
  // Cache-buster: el fileId cambia en cada guardado, así que basta con él

  function pick(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error("La imagen debe ser PNG, JPG o WEBP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("La imagen no debe pesar más de 10 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(String(reader.result));
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  }

  function recrop() {
    if (!current) return;
    setCropSrc(`/api/files/${current}`);
    setCropOpen(true);
  }

  function save(file: File) {
    startBusy(async () => {
      try {
        const fileId = await uploadFile(file, "cover");
        const result = await setCourseCoverAction(courseId, fileId);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setCurrent(fileId);
        setCropOpen(false);
        setCropSrc(null);
        toast.success("Imagen del curso actualizada");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo subir la imagen");
      }
    });
  }

  function remove() {
    startBusy(async () => {
      const result = await setCourseCoverAction(courseId, null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCurrent(null);
      toast.success("Imagen quitada: el curso usará su color propio");
      router.refresh();
    });
  }

  return (
    <Card className="anim-rise anim-d1 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 font-heading text-base">
          Imagen del curso
          <HelpTip topic="course.cover" />
        </CardTitle>
        <CardDescription>
          Opcional. Se muestra en las tarjetas y en el encabezado del curso. Sin imagen, el curso
          usa un color propio para distinguirse. Puedes encuadrarla: arrastrar, acercar y centrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <button
          type="button"
          onClick={() => (current ? recrop() : inputRef.current?.click())}
          className="group relative block h-40 w-full overflow-hidden rounded-xl border bg-secondary text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={current ? "Reencuadrar imagen" : "Subir imagen"}
        >
          <CourseCover courseId={courseId} coverFileId={current} iconClassName="size-10" />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
            <span className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium">
              {current ? <Crop className="size-4" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
              {current ? "Reencuadrar" : "Subir imagen"}
            </span>
          </span>
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
              <Loader2 className="size-6 animate-spin" aria-label="Guardando" />
            </span>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="bg-section text-white hover:bg-section-strong"
          >
            <ImagePlus className="size-4" aria-hidden />
            {current ? "Cambiar imagen" : "Subir imagen"}
          </Button>
          {current && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={recrop}>
                <Crop className="size-4" aria-hidden />
                Reencuadrar
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={remove}>
                <Trash2 className="size-4" aria-hidden />
                Quitar imagen
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <CoverCropDialog
        src={cropSrc}
        open={cropOpen}
        onOpenChange={(o) => {
          setCropOpen(o);
          if (!o) setCropSrc(null);
        }}
        onConfirm={save}
        busy={busy}
      />
    </Card>
  );
}
