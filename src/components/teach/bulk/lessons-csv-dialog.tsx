"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, FileDown, Loader2, Table2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { downloadTextFile } from "@/components/teach/csv-download";
import {
  StepIndicator,
  CsvDropzone,
  SuccessResult,
  PREVIEW_LIMIT,
  type WizardStep,
} from "@/components/teach/bulk/csv-wizard";
import {
  exportLessonsCsvAction,
  validateLessonsCsvAction,
  importLessonsCsvAction,
  type LessonsCsvPreviewRow,
} from "@/server/actions/teacher-bulk";

type Preview = {
  rows: LessonsCsvPreviewRow[];
  okCount: number;
  unchanged: number;
  invalid: number;
};

/**
 * Edición masiva de lecciones: descarga el CSV del curso, edítalo en Excel
 * y súbelo de vuelta. Solo cambia propiedades (título, requerido, secuencia,
 * visible, segundos mínimos); la estructura se maneja en el editor visual.
 */
export function LessonsCsvDialog({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [updated, setUpdated] = useState(0);
  const [exporting, startExport] = useTransition();
  const [validating, startValidate] = useTransition();
  const [importing, startImport] = useTransition();

  function reset() {
    setStep(1);
    setFileName("");
    setCsvText("");
    setPreview(null);
    setUpdated(0);
  }

  function exportCurrent() {
    startExport(async () => {
      const result = await exportLessonsCsvAction(courseId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      downloadTextFile(result.filename, result.csv);
    });
  }

  function handleText(text: string, name: string) {
    setFileName(name);
    setCsvText(text);
    startValidate(async () => {
      const result = await validateLessonsCsvAction(courseId, text);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setPreview({
        rows: result.rows,
        okCount: result.okCount,
        unchanged: result.unchanged,
        invalid: result.invalid,
      });
      setStep(2);
    });
  }

  function runImport() {
    if (!preview) return;
    startImport(async () => {
      const result = await importLessonsCsvAction({ courseId, csvText });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setUpdated(result.updated);
      setStep(3);
      router.refresh();
      toast.success(
        result.updated === 1
          ? "1 lección actualizada"
          : `${result.updated} lecciones actualizadas`
      );
    });
  }

  function close() {
    setOpen(false);
    reset();
    router.refresh();
  }

  // La vista previa solo muestra lo relevante: cambios y errores
  const visibleRows = preview
    ? preview.rows.filter((row) => row.status !== "unchanged")
    : [];
  const extraRows = Math.max(0, visibleRows.length - PREVIEW_LIMIT);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && importing) return; // no cerrar a media importación
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11">
          <Table2 aria-hidden />
          Edición masiva (CSV)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edición masiva de lecciones</DialogTitle>
          <DialogDescription>
            Descarga las lecciones, edítalas en Excel y sube el archivo. Nada se guarda
            hasta el paso final.
          </DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {step === 1 && (
          <div className="grid gap-3">
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">1. Descarga las lecciones actuales</p>
                <p className="text-xs text-muted-foreground">
                  Ese archivo es tu punto de partida para editar.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={exportCurrent}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <FileDown aria-hidden />
                )}
                Descargar lecciones actuales
              </Button>
            </div>

            <CsvDropzone
              busy={validating}
              hint="2. Sube aquí el archivo editado · máx. 1,000 filas"
              onText={handleText}
            />

            <p className="text-xs text-muted-foreground">
              Edita título, requerido (SI/NO), secuencia (heredar/obligatoria/libre), visible
              y segundos mínimos. NO toques la columna id.
            </p>
          </div>
        )}

        {step === 2 && preview && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {fileName && <span className="font-medium text-foreground">{fileName}</span>}
              </p>
              <p className="text-sm">
                <span className="font-semibold text-cta">
                  {preview.okCount === 1 ? "1 cambio" : `${preview.okCount} cambios`}
                </span>
                {", "}
                <span className="font-semibold text-muted-foreground">
                  {preview.unchanged} sin cambios
                </span>
                {", "}
                <span className="font-semibold text-destructive">
                  {preview.invalid} con error
                </span>
              </p>
            </div>

            {visibleRows.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                El archivo no trae cambios. Edita alguna columna en Excel y vuelve a subirlo.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Fila</th>
                      <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Lección</th>
                      <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Cambios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.slice(0, PREVIEW_LIMIT).map((row) => (
                      <tr
                        key={row.line}
                        className={cn(
                          "border-b last:border-0",
                          row.status === "invalid" && "bg-destructive/5"
                        )}
                      >
                        <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                          {row.line}
                        </td>
                        <td className="max-w-52 truncate px-3 py-1.5 font-medium">
                          {row.title || "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.status === "ok" ? (
                            <span className="inline-flex items-start gap-1.5">
                              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                              <span>{row.changes.join(" · ")}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-start gap-1.5">
                              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                              {row.message}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {extraRows > 0 && (
                  <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    …y {extraRows} filas más (también se procesarán)
                  </p>
                )}
              </div>
            )}

            {preview.invalid > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                Las filas con error no se aplicarán; puedes continuar solo con las válidas.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => {
                  setStep(1);
                  setPreview(null);
                  setFileName("");
                  setCsvText("");
                }}
                disabled={importing}
              >
                Elegir otro archivo
              </Button>
              <Button
                type="button"
                onClick={runImport}
                disabled={importing || preview.okCount === 0}
                className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90"
              >
                {importing && <Loader2 className="animate-spin" aria-hidden />}
                {importing
                  ? "Aplicando…"
                  : `Aplicar ${preview.okCount} ${preview.okCount === 1 ? "cambio" : "cambios"}`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <SuccessResult
              title={
                updated === 1 ? "1 lección actualizada" : `${updated} lecciones actualizadas`
              }
              detail="Los cambios ya se ven en el editor de contenido."
            />
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" onClick={close}>
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
