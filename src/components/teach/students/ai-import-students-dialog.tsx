"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  FileUp,
  Loader2,
  Plus,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadTextFile } from "@/components/teach/csv-download";
import {
  analyzeStudentsChunkAction,
  importAiStudentsAction,
  validateAiStudentsAction,
  type AiStudentCheck,
} from "@/server/actions/ai-students";
import { studentDraftProblem, type StudentDraft } from "@/lib/student-draft";
import { formatBytes } from "@/lib/file-meta";
import {
  AI_ACCEPT,
  MAX_AI_FILES,
  MAX_SCANNED_PAGES,
  addAiFiles,
  aiFileKind,
  scannedTooLongMessage,
} from "@/lib/ai-import-files";

type Step = "file" | "working" | "review" | "result";
const NO_COURSE = "none";

type RowState = { kind: "problem" | "ok" | "duplicate" | "invalid" | "checking"; message: string };

const STATE_STYLE: Record<RowState["kind"], string> = {
  ok: "bg-success/10 text-success",
  duplicate: "bg-section-soft text-section-strong",
  invalid: "bg-destructive/10 text-destructive",
  problem: "bg-destructive/10 text-destructive",
  checking: "bg-muted text-muted-foreground",
};

/**
 * Importar estudiantes con IA: cualquier lista (Excel, CSV, Word, PDF, fotos o
 * PDF escaneados) → OpenAI saca nombre, correo y grupo → se revisa y corrige
 * en la tabla → se crean las cuentas (y, si se elige, se matriculan). Nada se
 * crea hasta el último paso, y pasa por las mismas reglas que el CSV.
 */
export function AiImportStudentsDialog({
  courses,
  defaultCourseId,
}: {
  courses: { id: string; title: string }[];
  /** Curso fijo (desde la pestaña Estudiantes de un curso) */
  defaultCourseId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [rows, setRows] = useState<StudentDraft[]>([]);
  const [checks, setChecks] = useState<Record<string, AiStudentCheck>>({});
  const [checking, setChecking] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [courseId, setCourseId] = useState(defaultCourseId ?? NO_COURSE);
  const [enrollDuplicates, setEnrollDuplicates] = useState(true);
  const [useGroups, setUseGroups] = useState(true);
  const [result, setResult] = useState<{ created: number; skipped: number; enrolled: number; resultCsv: string } | null>(null);
  const [busy, startBusy] = useTransition();
  const cancelled = useRef(false);
  const checkVersion = useRef(0);

  // Estado de cada fila: primero lo que se ve en el navegador (nombre/correo),
  // luego lo que dice el servidor (ya existe, correo repetido, de personal…)
  const stateOf = (r: StudentDraft): RowState => {
    const problem = studentDraftProblem(r);
    if (problem) return { kind: "problem", message: problem };
    const c = checks[r.key];
    if (!c || checking) return c ? { kind: c.status, message: c.message } : { kind: "checking", message: "Revisando…" };
    return { kind: c.status, message: c.status === "ok" ? "Se creará" : c.message };
  };
  const states = rows.map(stateOf);
  const toCreate = states.filter((s) => s.kind === "ok").length;
  const existing = states.filter((s) => s.kind === "duplicate").length;
  const withErrors = states.filter((s) => s.kind === "problem" || s.kind === "invalid").length;
  const hasGroups = rows.some((r) => r.group.trim());
  const course = courseId !== NO_COURSE ? courseId : null;
  const enrollsExisting = !!course && enrollDuplicates && existing > 0;
  const canImport = !busy && !checking && (toCreate > 0 || enrollsExisting);

  // Revisión en el servidor, 0.6 s después del último cambio
  useEffect(() => {
    if (step !== "review" || rows.length === 0) return;
    const version = ++checkVersion.current;
    setChecking(true);
    const timer = window.setTimeout(async () => {
      const snapshot = rows.map((r) => ({ key: r.key, fullName: r.fullName, email: r.email }));
      const res = await validateAiStudentsAction({ rows: snapshot });
      if (version !== checkVersion.current) return;
      setChecking(false);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setChecks(Object.fromEntries(snapshot.map((r, i) => [r.key, res.checks[i]])));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [rows, step]);

  function reset() {
    setStep("file");
    setFiles([]);
    setRows([]);
    setChecks({});
    setFailures([]);
    setResult(null);
    setCourseId(defaultCourseId ?? NO_COURSE);
    setEnrollDuplicates(true);
    setUseGroups(true);
    setProgress({ done: 0, total: 0, label: "" });
  }

  function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const { files: next, rejected } = addAiFiles(files, Array.from(list));
    setFiles(next);
    for (const message of rejected) toast.error(message);
  }

  /** Fotos (juntas) o un PDF escaneado → estudiantes, por la ruta de visión. */
  async function readVision(list: File[]): Promise<{ drafts: StudentDraft[] } | { error: string }> {
    const form = new FormData();
    form.set("kind", "estudiantes");
    for (const f of list) form.append("files", f, f.name);
    try {
      const res = await fetch("/api/teach/ai-vision", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { drafts?: StudentDraft[]; error?: string };
      if (!res.ok || !body.drafts) return { error: body.error ?? "No se pudo leer el archivo." };
      return { drafts: body.drafts };
    } catch {
      return { error: "Se perdió la conexión con el servidor." };
    }
  }

  async function analyze() {
    if (files.length === 0) return;
    cancelled.current = false;
    setStep("working");
    setFailures([]);

    const images = files.filter((f) => aiFileKind(f.name) === "image");
    const steps: ({ kind: "doc"; file: File } | { kind: "images" })[] = [];
    for (const f of files) {
      if (aiFileKind(f.name) === "doc") steps.push({ kind: "doc", file: f });
      else if (f === images[0]) steps.push({ kind: "images" });
    }
    const multi = files.length > 1;
    const imagesLabel = images.length === 1 ? images[0].name : `${images.length} imágenes`;
    const found: StudentDraft[] = [];
    const failed: string[] = [];
    const add = (drafts: StudentDraft[], source: string) =>
      found.push(...drafts.map((d) => (multi ? { ...d, source } : d)));

    for (let s = 0; s < steps.length && !cancelled.current; s++) {
      const current = steps[s];
      const at = (label: string, fraction = 0) => setProgress({ done: s + fraction, total: steps.length, label });

      if (current.kind === "images") {
        at(images.length === 1 ? `Leyendo «${images[0].name}»…` : `Leyendo ${images.length} imágenes…`);
        const r = await readVision(images);
        if ("error" in r) failed.push(`${imagesLabel}: ${r.error}`);
        else add(r.drafts, imagesLabel);
        continue;
      }

      const f = current.file;
      at(`Leyendo «${f.name}» (${s + 1} de ${steps.length})…`);
      let extracted: { chunks?: string[]; scanned?: boolean; pages?: number; error?: string };
      try {
        const res = await fetch("/api/teach/ai-extract?para=estudiantes", {
          method: "POST",
          headers: { "X-File-Name": encodeURIComponent(f.name) },
          body: f,
        });
        extracted = (await res.json()) as typeof extracted;
        if (!res.ok) throw new Error(extracted.error ?? "No se pudo leer el archivo.");
      } catch (err) {
        failed.push(`${f.name}: ${err instanceof Error ? err.message : "No se pudo leer el archivo."}`);
        continue;
      }

      if (extracted.scanned) {
        const pages = extracted.pages ?? 0;
        if (pages > MAX_SCANNED_PAGES) {
          failed.push(scannedTooLongMessage(f.name, pages));
          continue;
        }
        at(`Leyendo el PDF escaneado «${f.name}»…`);
        const r = await readVision([f]);
        if ("error" in r) failed.push(`${f.name}: ${r.error}`);
        else add(r.drafts, f.name);
        continue;
      }

      const chunks = extracted.chunks ?? [];
      for (let i = 0; i < chunks.length && !cancelled.current; i++) {
        at(
          chunks.length > 1 ? `Interpretando «${f.name}», parte ${i + 1} de ${chunks.length}…` : `Interpretando «${f.name}»…`,
          i / chunks.length
        );
        const r = await analyzeStudentsChunkAction({ chunk: chunks[i] });
        if ("error" in r) failed.push(`${f.name}${chunks.length > 1 ? ` (parte ${i + 1})` : ""}: ${r.error}`);
        else add(r.drafts, f.name);
      }
    }

    if (cancelled.current) {
      setStep("file");
      return;
    }
    if (found.length === 0) {
      toast.error(failed[0] ?? "No encontré personas en los archivos.");
      setFailures(failed);
      setStep("file");
      return;
    }
    setRows(found);
    setChecks({});
    setFailures(failed);
    setStep("review");
  }

  function update(key: string, patch: Partial<StudentDraft>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function runImport() {
    startBusy(async () => {
      const res = await importAiStudentsAction({
        rows: rows.map((r) => ({ fullName: r.fullName, email: r.email, group: r.group })),
        enrollCourseId: course,
        enrollDuplicates: enrollsExisting,
        useGroups: !!course && hasGroups && useGroups,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setResult(res);
      setStep("result");
      router.refresh();
    });
  }

  const importLabel =
    toCreate > 0
      ? `Crear ${toCreate === 1 ? "1 cuenta" : `${toCreate} cuentas`}${course ? " y matricular" : ""}`
      : "Matricular";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) cancelled.current = true;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11">
          <Sparkles aria-hidden />
          Importar con IA
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          "flex max-h-[92vh] flex-col gap-4 overflow-hidden sm:max-w-5xl",
          step === "review" && "h-[92vh]"
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-section-strong" aria-hidden />
            Importar estudiantes con IA
          </DialogTitle>
          <DialogDescription>
            Sube tu lista en cualquier formato (Excel, Word, PDF, CSV, fotos o capturas): la IA saca nombre, correo y
            grupo de cada persona. La revisas y corriges antes de crear las cuentas.
          </DialogDescription>
        </DialogHeader>

        {step === "file" && (
          <div className="space-y-4">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "hover:bg-accent"
              )}
            >
              <FileUp className="size-8 text-muted-foreground" aria-hidden />
              <span className="font-medium">Arrastra aquí hasta {MAX_AI_FILES} archivos o haz clic para elegirlos</span>
              <span className="text-xs text-muted-foreground">
                Excel, CSV, Word, PDF, texto o imágenes (JPG, PNG, WEBP) · hasta 10 MB cada uno
              </span>
              <input
                type="file"
                multiple
                accept={AI_ACCEPT}
                className="sr-only"
                aria-label="Archivos con la lista de estudiantes"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>

            {files.length > 0 && (
              <ul className="max-h-60 space-y-1.5 overflow-auto">
                {files.map((f) => {
                  const Icon = aiFileKind(f.name) === "image" ? FileImage : FileText;
                  return (
                    <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Quitar «${f.name}»`}
                        onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              El texto y las imágenes se envían a OpenAI para procesarlos. Nada sale del servidor hasta que pulses «Analizar».
            </p>
            {failures.length > 0 && (
              <ul className="space-y-1 text-[13px] text-destructive">
                {failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button
                onClick={() => void analyze()}
                disabled={files.length === 0}
                className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
              >
                <Sparkles aria-hidden />
                Analizar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "working" && (
          <div className="space-y-4 py-6" role="status" aria-live="polite">
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {progress.label}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-cta transition-[width] duration-500"
                style={{ width: progress.total ? `${Math.round(((progress.done + 0.5) / progress.total) * 100)}%` : "8%" }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Una lista larga puede tardar un par de minutos.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => (cancelled.current = true)}>
                Cancelar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="text-sm" role="status" aria-live="polite">
              Encontré <b>{rows.length}</b> {rows.length === 1 ? "persona" : "personas"}
              {" · "}
              <span className="text-success">{toCreate} nuevas</span>
              {existing > 0 && <> · <span className="text-section-strong">{existing} ya tienen cuenta</span></>}
              {withErrors > 0 && <> · <span className="text-destructive">{withErrors} necesitan corrección</span></>}
              {checking && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  revisando…
                </span>
              )}
            </p>
            {failures.length > 0 && (
              <ul className="space-y-0.5 text-[13px] text-destructive">
                {failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-secondary text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-10 px-2 py-2 text-right">#</th>
                    <th className="px-2 py-2">Nombre completo</th>
                    <th className="px-2 py-2">Correo</th>
                    <th className="w-44 px-2 py-2">Grupo</th>
                    <th className="w-48 px-2 py-2">Estado</th>
                    <th className="w-10 px-2 py-2">
                      <span className="sr-only">Quitar</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => {
                    const st = states[i];
                    return (
                      <tr key={r.key} className={cn("align-top", (st.kind === "problem" || st.kind === "invalid") && "bg-destructive/5")}>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.fullName}
                            onChange={(e) => update(r.key, { fullName: e.target.value })}
                            aria-label={`Nombre de la fila ${i + 1}`}
                            className="h-9"
                          />
                          {(r.issues.length > 0 || r.source) && (
                            <p className="mt-1 text-xs text-amber-800">
                              {[...r.issues, ...(r.source ? [`De: ${r.source}`] : [])].join(" · ")}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.email}
                            type="email"
                            onChange={(e) => update(r.key, { email: e.target.value })}
                            aria-label={`Correo de la fila ${i + 1}`}
                            className="h-9"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.group}
                            maxLength={80}
                            onChange={(e) => update(r.key, { group: e.target.value })}
                            aria-label={`Grupo de la fila ${i + 1}`}
                            placeholder="—"
                            className="h-9"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant="secondary" className={cn("whitespace-normal text-left text-[11px]", STATE_STYLE[st.kind])}>
                            {st.message}
                          </Badge>
                        </td>
                        <td className="px-1 py-1.5">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Quitar la fila ${i + 1}`}
                            onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                          >
                            <X aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() =>
                  setRows((prev) => [...prev, { key: nanoid(8), fullName: "", email: "", group: "", issues: [] }])
                }
              >
                <Plus aria-hidden />
                Agregar fila
              </Button>
            </div>

            <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ai-students-course">Matricular en</Label>
                <Select value={courseId} onValueChange={setCourseId} disabled={!!defaultCourseId}>
                  <SelectTrigger id="ai-students-course" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!defaultCourseId && <SelectItem value={NO_COURSE}>No matricular (solo crear cuentas)</SelectItem>}
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {course && (
                <div className="space-y-2 self-end">
                  {existing > 0 && (
                    <label className="flex items-start gap-2 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={enrollDuplicates}
                        onCheckedChange={(v) => setEnrollDuplicates(v === true)}
                      />
                      Matricular también a los {existing} que ya tienen cuenta
                    </label>
                  )}
                  {hasGroups && (
                    <label className="flex items-start gap-2 text-sm">
                      <Checkbox className="mt-0.5" checked={useGroups} onCheckedChange={(v) => setUseGroups(v === true)} />
                      <span>
                        Usar los grupos de la lista
                        <span className="block text-xs text-muted-foreground">
                          Se crean en el curso si no existen; los que no traen grupo quedan sin grupo.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="items-center gap-2 sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {withErrors > 0
                  ? `Las ${withErrors} filas con errores se omitirán si no las corriges.`
                  : "Las contraseñas se generan solas y las descargas al final."}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="h-11" onClick={() => setStep("file")} disabled={busy}>
                  Volver
                </Button>
                <Button className="h-11 bg-cta px-5 text-cta-foreground hover:bg-cta/90" onClick={runImport} disabled={!canImport}>
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
                  {busy ? "Importando…" : importLabel}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div className="space-y-1 text-sm">
                <p className="font-semibold">
                  {result.created === 1 ? "Se creó 1 cuenta" : `Se crearon ${result.created} cuentas`}
                  {result.enrolled > 0 && ` · ${result.enrolled} matriculado(s)`}
                </p>
                {result.skipped > 0 && (
                  <p className="text-muted-foreground">{result.skipped} fila(s) omitida(s): el archivo de resultados dice por qué.</p>
                )}
              </div>
            </div>
            {result.created > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Descarga ahora las credenciales: las contraseñas temporales no se volverán a mostrar.
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => downloadTextFile("estudiantes-importados.csv", result.resultCsv)}
              >
                <Download aria-hidden />
                Descargar credenciales (CSV)
              </Button>
              <Button
                className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Listo
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
