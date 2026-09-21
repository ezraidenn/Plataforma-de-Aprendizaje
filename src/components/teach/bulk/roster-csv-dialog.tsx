"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  CircleCheck,
  FileDown,
  FileSpreadsheet,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
  exportRosterCsvAction,
  rosterCsvTemplateAction,
  validateRosterCsvAction,
  importRosterCsvAction,
  type RosterCsvPreviewRow,
} from "@/server/actions/teacher-bulk";

type Preview = {
  rows: RosterCsvPreviewRow[];
  toEnroll: number;
  toUnenroll: number;
  noop: number;
  invalid: number;
};

/**
 * Gestión masiva de matrícula: descarga la lista actual (reporte con progreso
 * que también sirve de plantilla), llena la columna "accion" en Excel
 * (matricular / quitar) y súbela de vuelta.
 */
export function RosterCsvDialog({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [outcome, setOutcome] = useState<{ enrolled: number; unenrolled: number } | null>(null);
  const [exporting, startExport] = useTransition();
  const [downloadingTemplate, startTemplate] = useTransition();
  const [validating, startValidate] = useTransition();
  const [importing, startImport] = useTransition();

  function reset() {
    setStep(1);
    setFileName("");
    setCsvText("");
    setPreview(null);
    setOutcome(null);
  }

  function exportCurrent() {
    startExport(async () => {
      const result = await exportRosterCsvAction(courseId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      downloadTextFile(result.filename, result.csv);
    });
  }

  function downloadTemplate() {
    startTemplate(async () => {
      const { template } = await rosterCsvTemplateAction();
      downloadTextFile("plantilla-matricula.csv", template);
    });
  }

  function handleText(text: string, name: string) {
    setFileName(name);
    setCsvText(text);
    startValidate(async () => {
      const result = await validateRosterCsvAction(courseId, text);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setPreview({
        rows: result.rows,
        toEnroll: result.toEnroll,
        toUnenroll: result.toUnenroll,
        noop: result.noop,
        invalid: result.invalid,
      });
      setStep(2);
    });
  }

  function runImport() {
    if (!preview) return;
    startImport(async () => {
      const result = await importRosterCsvAction({ courseId, csvText });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setOutcome({ enrolled: result.enrolled, unenrolled: result.unenrolled });
      setStep(3);
      router.refresh();
      toast.success("Cambios de matrícula aplicados");
    });
  }

  function close() {
    setOpen(false);
    reset();
    router.refresh();
  }

  const totalChanges = preview ? preview.toEnroll + preview.toUnenroll : 0;
  const extraRows = preview ? Math.max(0, preview.rows.length - PREVIEW_LIMIT) : 0;

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
          <FileSpreadsheet aria-hidden />
          Gestión masiva (CSV)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Gestión masiva de matrícula</DialogTitle>
          <DialogDescription>
            Matricula y da de baja en bloque con un CSV. Nada se aplica hasta el paso final.
          </DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {step === 1 && (
          <div className="grid gap-3">
            <div className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
              <div className="grid content-start gap-2">
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
                  Descargar lista actual
                </Button>
                <p className="text-xs text-muted-foreground">
                  Incluye progreso y estado: sirve de reporte y de plantilla. Llena la
                  columna «accion» con matricular o quitar.
                </p>
              </div>
              <div className="grid content-start gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={downloadTemplate}
                  disabled={downloadingTemplate}
                >
                  {downloadingTemplate ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <FileDown aria-hidden />
                  )}
                  Descargar plantilla vacía
                </Button>
                <p className="text-xs text-muted-foreground">
                  Solo correo y accion, para empezar desde cero.
                </p>
              </div>
            </div>

            <CsvDropzone
              busy={validating}
              hint="Columnas: correo y accion (matricular / quitar) · máx. 5,000 filas"
              onText={handleText}
            />
          </div>
        )}

        {step === 2 && preview && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {fileName && <span className="font-medium text-foreground">{fileName}</span>}
              </p>
              <p className="text-sm">
                <span className="font-semibold text-cta">{preview.toEnroll} a matricular</span>
                {" · "}
                <span className="font-semibold text-warning">
                  {preview.toUnenroll} a dar de baja
                </span>
                {" · "}
                <span className="font-semibold text-muted-foreground">
                  {preview.noop} sin efecto
                </span>
                {" · "}
                <span className="font-semibold text-destructive">
                  {preview.invalid} con error
                </span>
              </p>
            </div>

            {preview.rows.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                El archivo no trae acciones. Llena la columna «accion» con matricular o
                quitar y vuelve a subirlo.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Fila</th>
                      <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Correo</th>
                      <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Acción</th>
                      <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                      <tr
                        key={row.line}
                        className={cn(
                          "border-b last:border-0",
                          row.status === "invalid" && "bg-destructive/5",
                          row.status === "noop" && "opacity-70"
                        )}
                      >
                        <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                          {row.line}
                        </td>
                        <td className="max-w-56 truncate px-3 py-1.5">{row.email || "—"}</td>
                        <td className="px-3 py-1.5">
                          {row.action === "enroll" ? (
                            <Badge variant="secondary" className="bg-cta/10 text-cta">
                              Matricular
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                              Quitar
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.status === "ok" ? (
                            <span className="inline-flex items-center gap-1.5">
                              <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
                              {row.message}
                            </span>
                          ) : row.status === "noop" ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <CircleAlert className="size-4 shrink-0" aria-hidden />
                              {row.message}
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

            {preview.toUnenroll > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                Los dados de baja conservan su progreso y pueden reactivarse después.
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
                disabled={importing || totalChanges === 0}
                className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90"
              >
                {importing && <Loader2 className="animate-spin" aria-hidden />}
                {importing ? "Aplicando…" : "Aplicar cambios"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && outcome && (
          <div className="grid gap-4">
            <SuccessResult
              title={`${outcome.enrolled} ${
                outcome.enrolled === 1 ? "matriculado" : "matriculados"
              } · ${outcome.unenrolled} ${outcome.unenrolled === 1 ? "baja" : "bajas"}`}
              detail="La lista del curso ya está actualizada."
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
