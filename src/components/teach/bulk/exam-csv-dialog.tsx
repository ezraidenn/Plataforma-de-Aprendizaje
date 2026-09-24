"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Download, FileDown, Loader2, TriangleAlert, Upload } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { downloadTextFile } from "@/components/teach/csv-download";
import {
  StepIndicator,
  CsvDropzone,
  SuccessResult,
  PREVIEW_LIMIT,
  type WizardStep,
} from "@/components/teach/bulk/csv-wizard";
import {
  examCsvTemplateAction,
  exportExamCsvAction,
  validateExamCsvAction,
  importExamCsvAction,
  type ExamCsvPreviewRow,
  type ExamImportMode,
} from "@/server/actions/teacher-bulk";

type Preview = {
  rows: ExamCsvPreviewRow[];
  okCount: number;
  invalid: number;
  currentCount: number;
  currentImageCount: number;
};

/** "1 pregunta sobre imagen no cabe..." / "N preguntas sobre imagen no caben...", con la concordancia correcta. */
function imageOmittedText(n: number): string {
  return n === 1
    ? "1 pregunta sobre imagen no cabe en el Excel; en el examen se queda como está."
    : `${n} preguntas sobre imagen no caben en el Excel; en el examen se quedan como están.`;
}

/**
 * Encabezado del editor de examen: "Exportar CSV" (descarga directa) e
 * "Importar CSV" (asistente en 3 pasos: subir → revisar → resultado).
 */
export function ExamCsvActions({
  itemId,
  questionCount,
}: {
  itemId: string;
  questionCount: number;
}) {
  const [exporting, startExport] = useTransition();

  function exportCsv() {
    startExport(async () => {
      const result = await exportExamCsvAction(itemId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      downloadTextFile(result.filename, result.csv);
      toast.success("Examen exportado. Edítalo en Excel y vuelve a subirlo.");
      if (result.omitted > 0) toast.info(imageOmittedText(result.omitted));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={exportCsv}
        disabled={exporting || questionCount === 0}
        title={questionCount === 0 ? "Aún no hay preguntas que exportar" : undefined}
      >
        {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Exportar CSV
      </Button>
      <ExamCsvDialog itemId={itemId} />
    </div>
  );
}

/** Asistente de importación de preguntas de examen por CSV. */
export function ExamCsvDialog({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<ExamImportMode>("replace");
  const [outcome, setOutcome] = useState<{ imported: number; skipped: number; kept: number } | null>(null);
  const [downloadingTemplate, startTemplate] = useTransition();
  const [validating, startValidate] = useTransition();
  const [importing, startImport] = useTransition();

  function reset() {
    setStep(1);
    setFileName("");
    setCsvText("");
    setPreview(null);
    setMode("replace");
    setOutcome(null);
  }

  function downloadTemplate() {
    startTemplate(async () => {
      const { template } = await examCsvTemplateAction();
      downloadTextFile("plantilla-examen.csv", template);
    });
  }

  function handleText(text: string, name: string) {
    setFileName(name);
    setCsvText(text);
    startValidate(async () => {
      const result = await validateExamCsvAction(itemId, text);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setPreview({
        rows: result.rows,
        okCount: result.okCount,
        invalid: result.invalid,
        currentCount: result.currentCount,
        currentImageCount: result.currentImageCount,
      });
      setStep(2);
    });
  }

  function runImport() {
    if (!preview) return;
    startImport(async () => {
      const result = await importExamCsvAction({ itemId, csvText, mode });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setOutcome({ imported: result.imported, skipped: result.skipped, kept: result.kept });
      setStep(3);
      router.refresh();
      toast.success(
        result.imported === 1
          ? "1 pregunta importada"
          : `${result.imported} preguntas importadas`
      );
    });
  }

  function close() {
    setOpen(false);
    reset();
    router.refresh();
  }

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
          <Upload aria-hidden />
          Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar preguntas desde CSV</DialogTitle>
          <DialogDescription>
            Sube el banco de preguntas hecho en Excel. Nada se guarda hasta el paso final.
          </DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {step === 1 && (
          <div className="grid gap-3">
            <CsvDropzone
              busy={validating}
              hint="Columnas: tipo, pregunta, puntos, opciones y correctas · máx. 200 filas"
              onText={handleText}
            />
            <p className="text-xs text-muted-foreground">
              Edita en Excel y vuelve a subir. Tipos: opción única, múltiple, V/F, respuesta
              corta, relacionar, abierta.
            </p>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={downloadTemplate}
                disabled={downloadingTemplate}
                className="text-primary"
              >
                {downloadingTemplate ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <FileDown aria-hidden />
                )}
                Descargar plantilla
              </Button>
            </div>
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
                  {preview.okCount === 1 ? "1 lista" : `${preview.okCount} listas`}
                </span>
                {", "}
                <span className="font-semibold text-destructive">
                  {preview.invalid} con error
                </span>
              </p>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Fila</th>
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Tipo</th>
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Pregunta</th>
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                    <tr
                      key={row.line}
                      className={cn(
                        "border-b last:border-0",
                        row.status === "invalid" && "bg-destructive/5"
                      )}
                    >
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{row.line}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="outline" className="font-normal">
                          {row.typeLabel || "—"}
                        </Badge>
                      </td>
                      <td className="max-w-64 truncate px-3 py-1.5">{row.preview || "—"}</td>
                      <td className="px-3 py-1.5">
                        {row.status === "ok" ? (
                          <span className="inline-flex items-center gap-1.5">
                            <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
                            Lista
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

            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-medium">¿Qué hacemos con las preguntas del examen?</p>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as ExamImportMode)}
                className="gap-2"
              >
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="replace" className="mt-0.5" />
                  <span>
                    <span className="font-medium">Reemplazar preguntas actuales</span>
                    <span className="block text-xs text-muted-foreground">
                      El examen queda solo con las preguntas del archivo.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="append" className="mt-0.5" />
                  <span>
                    <span className="font-medium">Agregar al final</span>
                    <span className="block text-xs text-muted-foreground">
                      Las preguntas del archivo se suman a las que ya existen.
                    </span>
                  </span>
                </label>
              </RadioGroup>
              {mode === "replace" && (preview.currentCount > 0 || preview.currentImageCount > 0) && (
                <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    {preview.currentCount > 0 && (
                      <>
                        Se {preview.currentCount === 1
                          ? "borrará la pregunta actual"
                          : `borrarán las ${preview.currentCount} preguntas actuales`}
                        ; los intentos ya enviados conservan sus preguntas.{" "}
                      </>
                    )}
                    {preview.currentImageCount > 0 &&
                      (preview.currentImageCount === 1
                        ? "1 pregunta sobre imagen se conserva tal como está: el CSV no la puede traer."
                        : `${preview.currentImageCount} preguntas sobre imagen se conservan tal como están: el CSV no las puede traer.`)}
                  </span>
                </p>
              )}
            </div>

            {preview.invalid > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                Las filas con error no se importarán; puedes continuar solo con las válidas.
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
                  ? "Importando…"
                  : `Importar ${preview.okCount} ${preview.okCount === 1 ? "pregunta" : "preguntas"}`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && outcome && (
          <div className="grid gap-4">
            <SuccessResult
              title={
                outcome.imported === 1
                  ? "1 pregunta importada"
                  : `${outcome.imported} preguntas importadas`
              }
              detail={[
                mode === "replace"
                  ? "El examen quedó con las preguntas del archivo"
                  : "Se agregaron al final del examen",
                mode === "replace" && outcome.kept > 0
                  ? `se conservaron ${outcome.kept} ${outcome.kept === 1 ? "pregunta sobre imagen" : "preguntas sobre imagen"}`
                  : null,
                outcome.skipped > 0
                  ? `${outcome.skipped} ${outcome.skipped === 1 ? "fila omitida" : "filas omitidas"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
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
