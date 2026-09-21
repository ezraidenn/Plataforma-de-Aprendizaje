"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Download,
  FileDown,
  FileUp,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadTextFile } from "@/components/teach/csv-download";
import { OnBehalfNote } from "@/components/teach/on-behalf-note";
import {
  csvTemplateAction,
  importStudentsCsvAction,
  validateStudentsCsvAction,
  type CsvPreviewRow,
} from "@/server/actions/teacher-import";

const PREVIEW_LIMIT = 200;
const NO_COURSE = "none";

type Step = 1 | 2 | 3;

type Preview = {
  rows: CsvPreviewRow[];
  okCount: number;
  duplicates: number;
  invalid: number;
};

type ImportOutcome = {
  created: number;
  skipped: number;
  enrolled: number;
  resultCsv: string;
};

const ROW_STATUS: Record<
  CsvPreviewRow["status"],
  { icon: typeof CircleCheck; className: string; label: string | null }
> = {
  ok: { icon: CircleCheck, className: "text-success", label: "Se creará" },
  duplicate: { icon: CircleAlert, className: "text-warning", label: "Ya existe (se omitirá)" },
  invalid: { icon: TriangleAlert, className: "text-destructive", label: null }, // usa el motivo
};

function StepIndicator({ current }: { current: Step }) {
  const steps = ["Subir", "Revisar", "Resultado"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((label, i) => {
        const n = (i + 1) as Step;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-border" aria-hidden />}
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                active && "bg-section text-section-fg",
                done && "bg-cta text-cta-foreground",
                !active && !done && "bg-muted text-muted-foreground"
              )}
              aria-hidden
            >
              {done ? <Check className="size-3.5" /> : n}
            </span>
            <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Asistente de importación de estudiantes por CSV en 3 pasos (§2.13). */
export function ImportCsvDialog({
  courses,
}: {
  courses: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [enrollCourseId, setEnrollCourseId] = useState(NO_COURSE);
  const [enrollDuplicates, setEnrollDuplicates] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [downloadingTemplate, startTemplate] = useTransition();
  const [validating, startValidate] = useTransition();
  const [importing, startImport] = useTransition();

  function reset() {
    setStep(1);
    setDragging(false);
    setFileName("");
    setCsvText("");
    setPreview(null);
    setEnrollCourseId(NO_COURSE);
    setEnrollDuplicates(false);
    setOutcome(null);
  }

  function downloadTemplate() {
    startTemplate(async () => {
      const { template } = await csvTemplateAction();
      downloadTextFile("plantilla-estudiantes.csv", template);
    });
  }

  function handleFile(file: File) {
    const isCsv =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel";
    if (!isCsv) {
      toast.error("Elige un archivo .csv");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setFileName(file.name);
      setCsvText(text);
      startValidate(async () => {
        const result = await validateStudentsCsvAction(text);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setPreview({
          rows: result.rows,
          okCount: result.okCount,
          duplicates: result.duplicates,
          invalid: result.invalid,
        });
        setStep(2);
      });
    };
    reader.onerror = () => toast.error("No se pudo leer el archivo. Intenta de nuevo.");
    reader.readAsText(file);
  }

  function runImport() {
    if (!preview) return;
    startImport(async () => {
      const result = await importStudentsCsvAction({
        csvText,
        enrollCourseId: enrollCourseId === NO_COURSE ? null : enrollCourseId,
        enrollDuplicates: enrollDuplicates && enrollCourseId !== NO_COURSE,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setOutcome({
        created: result.created,
        skipped: result.skipped,
        enrolled: result.enrolled,
        resultCsv: result.resultCsv,
      });
      setStep(3);
      router.refresh();
      toast.success(
        result.created === 1
          ? "1 estudiante importado"
          : `${result.created} estudiantes importados`
      );
    });
  }

  function close() {
    setOpen(false);
    reset();
    router.refresh();
  }

  const enrollCourseTitle = courses.find((c) => c.id === enrollCourseId)?.title ?? "";
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
          <DialogTitle>Importar estudiantes</DialogTitle>
          <DialogDescription>
            Sube un CSV con nombre, correo y contraseña (opcional). Nada se guarda hasta
            el paso final.
          </DialogDescription>
        </DialogHeader>
        {step !== 3 && <OnBehalfNote subject="Los estudiantes importados" plural />}

        <StepIndicator current={step} />

        {step === 1 && (
          <div className="grid gap-3">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
                dragging ? "border-section bg-section-soft/50" : "border-border hover:bg-muted/40"
              )}
            >
              {validating ? (
                <Loader2 className="size-8 animate-spin text-section-strong" aria-hidden />
              ) : (
                <FileUp className="size-8 text-muted-foreground" aria-hidden />
              )}
              <span className="text-sm font-medium">
                {validating
                  ? "Validando el archivo…"
                  : "Arrastra tu archivo .csv aquí o haz clic para elegirlo"}
              </span>
              <span className="text-xs text-muted-foreground">
                Columnas: nombre, correo, contraseña (vacía = se genera) · máx. 5,000 filas
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={validating}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </label>
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
                Descargar plantilla CSV
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
                <span className="font-semibold text-cta">{preview.okCount} se crearán</span>
                {", "}
                <span className="font-semibold text-warning">
                  {preview.duplicates} se omitirán
                </span>
                {", "}
                <span className="font-semibold text-destructive">
                  {preview.invalid} con error
                </span>
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Línea</th>
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Nombre</th>
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Correo</th>
                    <th scope="col" className="sticky top-0 border-b bg-card px-3 py-2 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, PREVIEW_LIMIT).map((row) => {
                    const meta = ROW_STATUS[row.status];
                    const Icon = meta.icon;
                    return (
                      <tr
                        key={row.line}
                        className={cn(
                          "border-b last:border-0",
                          row.status === "duplicate" && "bg-warning/5",
                          row.status === "invalid" && "bg-destructive/5"
                        )}
                      >
                        <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                          {row.line}
                        </td>
                        <td className="max-w-48 truncate px-3 py-1.5">{row.fullName || "—"}</td>
                        <td className="max-w-56 truncate px-3 py-1.5 text-muted-foreground">
                          {row.email || "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <Icon className={cn("size-4 shrink-0", meta.className)} aria-hidden />
                            {meta.label ?? row.message}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {extraRows > 0 && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  …y {extraRows} filas más (también se procesarán)
                </p>
              )}
            </div>

            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <p className="text-sm font-medium">Matricular a todos en… (opcional)</p>
                <Select value={enrollCourseId} onValueChange={setEnrollCourseId}>
                  <SelectTrigger className="h-10 w-full" aria-label="Curso para matricular">
                    <SelectValue placeholder="Sin matricular" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_COURSE}>Sin matricular</SelectItem>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label
                className={cn(
                  "flex items-start gap-2 text-sm sm:pt-7",
                  enrollCourseId === NO_COURSE && "text-muted-foreground"
                )}
              >
                <Checkbox
                  checked={enrollDuplicates}
                  onCheckedChange={(v) => setEnrollDuplicates(v === true)}
                  disabled={enrollCourseId === NO_COURSE}
                  className="mt-0.5"
                />
                Matricular también a los que ya existen
              </label>
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
                  : `Importar ${preview.okCount} ${
                      preview.okCount === 1 ? "estudiante" : "estudiantes"
                    }`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && outcome && (
          <div className="grid gap-4">
            <div className="flex flex-col items-center gap-1.5 py-2 text-center">
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
                <CircleCheck className="size-9" aria-hidden />
              </span>
              <p className="font-heading text-xl font-semibold">
                {outcome.created}{" "}
                {outcome.created === 1 ? "estudiante creado" : "estudiantes creados"}
              </p>
              <p className="text-sm text-muted-foreground">
                {[
                  outcome.enrolled > 0
                    ? `${outcome.enrolled} ${
                        outcome.enrolled === 1 ? "matriculado" : "matriculados"
                      }${enrollCourseTitle ? ` en «${enrollCourseTitle}»` : ""}`
                    : null,
                  outcome.skipped > 0
                    ? `${outcome.skipped} ${outcome.skipped === 1 ? "omitido" : "omitidos"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
              <p className="flex items-start gap-2 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                El reporte incluye las contraseñas generadas. Guárdalo ahora: no se
                volverán a mostrar.
              </p>
              <Button
                type="button"
                onClick={() =>
                  downloadTextFile("resultado-importacion.csv", outcome.resultCsv)
                }
                className="h-11 w-full bg-cta text-cta-foreground hover:bg-cta/90"
              >
                <Download aria-hidden />
                Descargar reporte
              </Button>
            </div>

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
