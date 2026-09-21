"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ClipboardCheck, Inbox, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { kindMeta } from "@/components/kind-meta";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadExamGradingAction,
  loadSubmissionGradingAction,
  type ExamGradingDetail,
  type SubmissionGradingDetail,
} from "@/server/actions/teacher-grading";
import { formatNumber, formatRelative } from "@/components/teach/format";
import { ExamGradingPanel } from "./exam-grading-panel";
import { AssignmentGradingPanel } from "./assignment-grading-panel";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type QueueEntry = {
  kind: "exam" | "assignment";
  /** attemptId (examen) o submissionId (tarea) */
  key: string;
  courseId: string;
  courseTitle: string;
  itemTitle: string;
  studentName: string;
  submittedAtMs: number;
  pendingQuestions: number;
  isLate: boolean;
};

type SelectedRef = { key: string; kind: "exam" | "assignment" };

type LoadedDetail =
  | { kind: "exam"; detail: ExamGradingDetail }
  | { kind: "assignment"; detail: SubmissionGradingDetail };

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Vista principal (bandeja + panel) ───────────────────────────────────────

export function GradingView({
  entries: serverEntries,
  courses,
  initialSelectedKey,
}: {
  entries: QueueEntry[];
  courses: { id: string; title: string }[];
  initialSelectedKey: string | null;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(serverEntries);
  const [courseFilter, setCourseFilter] = useState("all");
  const [tab, setTab] = useState<"exam" | "assignment" | "all">("all");
  const [selected, setSelected] = useState<SelectedRef | null>(() => {
    const initial = initialSelectedKey
      ? serverEntries.find((e) => e.key === initialSelectedKey)
      : null;
    return initial ? { key: initial.key, kind: initial.kind } : null;
  });
  const [detail, setDetail] = useState<LoadedDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Sincronizar con el servidor tras router.refresh() (estado derivado)
  const serverEntriesRef = useRef(serverEntries);
  if (serverEntriesRef.current !== serverEntries) {
    serverEntriesRef.current = serverEntries;
    setEntries(serverEntries);
  }

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (courseFilter === "all" || e.courseId === courseFilter) &&
          (tab === "all" || e.kind === tab)
      ),
    [entries, courseFilter, tab]
  );

  // La primera entrada visible se abre sola; si la seleccionada sale del
  // filtro (o se calificó), pasa a la primera disponible.
  useEffect(() => {
    if (!selected || !filtered.some((e) => e.key === selected.key)) {
      const first = filtered[0] ?? null;
      setSelected(first ? { key: first.key, kind: first.kind } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  // Cargar el detalle de la entrada seleccionada
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    (async () => {
      const result =
        selected.kind === "exam"
          ? await loadExamGradingAction(selected.key)
          : await loadSubmissionGradingAction(selected.key);
      if (cancelled) return;
      setLoadingDetail(false);
      if ("error" in result) {
        toast.error(result.error);
        setDetail(null);
        return;
      }
      setDetail(
        selected.kind === "exam"
          ? { kind: "exam", detail: result.detail as ExamGradingDetail }
          : { kind: "assignment", detail: result.detail as SubmissionGradingDetail }
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  /** Quita la entrada calificada y avanza a la siguiente de la bandeja. */
  function handleDone(message: string) {
    toast.success(message);
    const currentKey = selected?.key ?? null;
    const idx = filtered.findIndex((e) => e.key === currentKey);
    const next = filtered[idx + 1] ?? filtered[idx - 1] ?? null;
    setEntries((prev) => prev.filter((e) => e.key !== currentKey));
    setSelected(next && next.key !== currentKey ? { key: next.key, kind: next.kind } : null);
    router.refresh();
  }

  // ── Cola totalmente vacía ─────────────────────────────────────────────────
  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Por calificar"
          title="Cola de calificación"
          description="Tareas entregadas y exámenes con preguntas abiertas pendientes de revisión."
          icon={ClipboardCheck}
        />
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-20 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
            <CircleCheck className="size-8" aria-hidden />
          </span>
          <p className="font-heading text-lg font-semibold">Todo calificado. Nada pendiente.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Cuando un estudiante entregue una tarea o envíe un examen con preguntas abiertas,
            aparecerá aquí.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Por calificar"
        title={`Cola de calificación (${formatNumber(entries.length)})`}
        description="Tareas entregadas y exámenes con preguntas abiertas pendientes de revisión."
        icon={ClipboardCheck}
        actions={
          <>
            <Select value={courseFilter} onValueChange={setCourseFilter}>
              <SelectTrigger className="min-w-44" aria-label="Filtrar por curso">
                <SelectValue placeholder="Todos los cursos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los cursos</SelectItem>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="exam" className="px-3">
                  Exámenes
                </TabsTrigger>
                <TabsTrigger value="assignment" className="px-3">
                  Tareas
                </TabsTrigger>
                <TabsTrigger value="all" className="px-3">
                  Todo
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Bandeja */}
        <div className="anim-rise max-h-[75vh] overflow-y-auto rounded-xl border bg-card p-2 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="anim-pop flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <CircleCheck className="size-6" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">Nada pendiente con estos filtros.</p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((entry) => (
                <li key={entry.key}>
                  <QueueRow
                    entry={entry}
                    selected={entry.key === selected?.key}
                    onSelect={() => setSelected({ key: entry.key, kind: entry.kind })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Panel de calificación */}
        <div className="min-h-80">
          {loadingDetail ? (
            <div className="space-y-4 rounded-xl border bg-card p-5">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-11 w-48 rounded-lg" />
            </div>
          ) : detail?.kind === "exam" ? (
            <ExamGradingPanel
              key={detail.detail.attemptId}
              detail={detail.detail}
              onDone={handleDone}
            />
          ) : detail?.kind === "assignment" ? (
            <AssignmentGradingPanel
              key={detail.detail.submissionId}
              detail={detail.detail}
              onDone={handleDone}
            />
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
              <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <Inbox className="size-8" aria-hidden />
              </span>
              <p className="max-w-xs text-sm text-muted-foreground">
                Selecciona una entrega de la lista para calificarla.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Fila de la bandeja ──────────────────────────────────────────────────────

function QueueRow({
  entry,
  selected,
  onSelect,
}: {
  entry: QueueEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  // Icono del tipo (examen/tarea) siempre en su color de identidad
  const meta = kindMeta(entry.kind);
  const waitedTooLong = Date.now() - entry.submittedAtMs > DAY_MS;
  const subtext =
    entry.kind === "exam" && entry.pendingQuestions > 0
      ? `${entry.pendingQuestions} ${entry.pendingQuestions === 1 ? "pregunta" : "preguntas"} · ${formatRelative(entry.submittedAtMs)}`
      : formatRelative(entry.submittedAtMs);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-section-soft/50",
        selected &&
          "bg-section-soft before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-section"
      )}
    >
      <meta.Icon className={cn("mt-0.5 size-4 shrink-0", meta.textClass)} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {entry.studentName} · {entry.itemTitle}
          </span>
          {waitedTooLong && (
            <TriangleAlert
              className="size-3.5 shrink-0 text-warning"
              aria-label="Lleva más de 24 horas en espera"
            />
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate" suppressHydrationWarning>
            {subtext}
          </span>
          {entry.isLate && (
            <Badge variant="destructive" className="h-4 shrink-0 px-1.5 text-[10px]">
              Tardía
            </Badge>
          )}
        </span>
      </span>
    </button>
  );
}
