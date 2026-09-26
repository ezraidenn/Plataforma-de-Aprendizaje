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
import { plural } from "@/lib/plural";
import { replaceWarning } from "@/lib/replace-warning";
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
  currentNotInCsvCount: number;
};

/** Por qué una pregunta no cabe en el CSV, para los avisos. */
const WHY_NOT_IN_CSV =
  "las preguntas sobre imagen y las de clasificar con íconos o con «:», «;» o «|» en sus grupos o tarjetas se editan solo en el editor";

/** "1 pregunta no cabe..." / "N preguntas no caben...", con la concordancia correcta. */
function notInCsvOmittedText(n: number): string {
  return plural(
    n,
    "1 pregunta no cabe en el CSV; en el examen se queda como está.",
    `${n} preguntas no caben en el CSV; en el examen se quedan como están.`
  );
}

/** Por qué no se puede exportar: sin preguntas, o solo preguntas que no caben en el CSV. */
function exportBlockedText(questionCount: number, notInCsvCount: number): string {
  if (questionCount === 0) return "Aún no hay preguntas que exportar.";
  return `${plural(
    notInCsvCount,
    "Este examen solo tiene 1 pregunta, que no cabe en el CSV",
    `Este examen solo tiene ${notInCsvCount} preguntas, que no caben en el CSV`
  )}: ${WHY_NOT_IN_CSV}.`;
}

/**
 * Encabezado del editor de examen: "Exportar CSV" (descarga directa) e
 * "Importar CSV" (asistente en 3 pasos: subir → revisar → resultado).
 */
export function ExamCsvActions({
  itemId,
  questionCount,
  notInCsvCount,
}: {
  itemId: string;
  questionCount: number;
  /** Preguntas que no caben en el CSV (`csvRepresentable`): no cuentan para exportar. */
  notInCsvCount: number;
}) {
  const [exporting, startExport] = useTransition();
  const exportable = questionCount - notInCsvCount;
  const blocked = exportable === 0;
  // Solo cuando el motivo es «puras preguntas que no caben» hay un texto corto
  // visible junto a los botones (enlazado por aria-describedby); sin preguntas
  // no hace falta: el botón ya se explica solo.
  const noteId = "exam-csv-export-note";
  const showNote = blocked && questionCount > 0 && notInCsvCount > 0;

  function exportCsv() {
    if (exporting) return;
    if (blocked) {
      toast.info(exportBlockedText(questionCount, notInCsvCount));
      return;
    }
    startExport(async () => {
      const result = await exportExamCsvAction(itemId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      downloadTextFile(result.filename, result.csv);
      toast.success("Examen exportado. Edítalo en Excel y vuelve a subirlo.");
      if (result.omitted > 0) toast.info(notInCsvOmittedText(result.omitted));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Sin `disabled` nativo: sigue enfocable y pulsable por teclado, mouse o
          táctil, y al pulsarlo explica por qué con un toast (no basta con el
          `title`, que ni el teclado ni los lectores de pantalla alcanzan). */}
      <Button
        type="button"
        variant="outline"
        className={cn("h-11", blocked && "opacity-50")}
        onClick={exportCsv}
        aria-disabled={exporting || blocked}
        aria-describedby={showNote ? noteId : undefined}
      >
        {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Exportar CSV
      </Button>
      <ExamCsvDialog itemId={itemId} />
      {showNote && (
        <p id={noteId} className="w-full text-xs text-muted-foreground">
          Este examen solo tiene preguntas que no caben en el CSV: {WHY_NOT_IN_CSV}.
        </p>
      )}
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
        currentNotInCsvCount: result.currentNotInCsvCount,
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
              corta, relacionar, ordenar, clasificar, completar y abierta.
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
                      {preview.currentNotInCsvCount > 0
                        ? `El examen queda con las preguntas del archivo y ${plural(preview.currentNotInCsvCount, "la que ya tiene que no cabe en el CSV", `las ${preview.currentNotInCsvCount} que ya tiene que no caben en el CSV`)}.`
                        : "El examen queda solo con las preguntas del archivo."}
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
              {mode === "replace" && (preview.currentCount > 0 || preview.currentNotInCsvCount > 0) && (
                <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    {replaceWarning(preview.currentCount, preview.currentNotInCsvCount)}
                    {preview.currentCount > 0 && " Los intentos ya enviados conservan sus preguntas."}
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
                  ? plural(outcome.kept, "se conservó 1 pregunta que no cabe en el CSV", `se conservaron ${outcome.kept} preguntas que no caben en el CSV`)
                  : null,
                outcome.skipped > 0 ? plural(outcome.skipped, "1 fila omitida", `${outcome.skipped} filas omitidas`) : null,
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
