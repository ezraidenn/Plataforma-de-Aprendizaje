"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ClipboardCheck, History, Inbox, TriangleAlert } from "lucide-react";
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
  listGradedRecentlyAction,
  loadExamGradingAction,
  loadSubmissionGradingAction,
  type ExamGradingDetail,
  type GradedEntry,
  type SubmissionGradingDetail,
} from "@/server/actions/teacher-grading";
import {
  formatDateTime,
  formatNumber,
  formatPoints,
  formatRelative,
} from "@/components/teach/format";
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

/**
 * Entrada ya calificada que hay que abrir nada más entrar (llega por
 * `?abrir=…&tipo=…` desde donde se ve la nota). Trae la firma para poder
 * escribir «Calificada por … el …» aunque la fila no esté en las 50 recientes.
 */
export type OpenTarget = {
  key: string;
  kind: "exam" | "assignment";
  gradedByName: string | null;
  gradedAtMs: number | null;
};

type TabValue = "all" | "exam" | "assignment" | "graded";

type SelectedRef = { key: string; kind: "exam" | "assignment" };

type LoadedDetail =
  | { kind: "exam"; detail: ExamGradingDetail }
  | { kind: "assignment"; detail: SubmissionGradingDetail };

const DAY_MS = 24 * 60 * 60 * 1000;

/** «9/10», «Devuelta» o «—»: lo que se enseña como nota en la lista. */
function scoreLabel(entry: GradedEntry): string {
  if (entry.status === "returned") return "Devuelta";
  if (entry.score === null) return "—";
  return entry.maxScore === null
    ? formatPoints(entry.score)
    : `${formatPoints(entry.score)}/${formatPoints(entry.maxScore)}`;
}

// ─── Vista principal (bandeja + panel) ───────────────────────────────────────

export function GradingView({
  entries: serverEntries,
  courses,
  initialSelectedKey,
  initialOpen = null,
}: {
  entries: QueueEntry[];
  courses: { id: string; title: string }[];
  initialSelectedKey: string | null;
  initialOpen?: OpenTarget | null;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(serverEntries);
  const [courseFilter, setCourseFilter] = useState("all");
  const [tab, setTab] = useState<TabValue>(initialOpen ? "graded" : "all");
  const [selected, setSelected] = useState<SelectedRef | null>(() => {
    if (initialOpen) return { key: initialOpen.key, kind: initialOpen.kind };
    const initial = initialSelectedKey
      ? serverEntries.find((e) => e.key === initialSelectedKey)
      : null;
    return initial ? { key: initial.key, kind: initial.kind } : null;
  });
  // La entrada que llegó por la URL no se descarta aunque no esté en la lista
  // cargada (puede ser más vieja que las 50 recientes)
  const [pinned, setPinned] = useState<OpenTarget | null>(initialOpen);
  const [detail, setDetail] = useState<LoadedDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [graded, setGraded] = useState<GradedEntry[] | null>(null);
  const [loadingGraded, setLoadingGraded] = useState(false);
  const [gradedReload, setGradedReload] = useState(0);

  const isGraded = tab === "graded";

  // Sincronizar con el servidor tras router.refresh() (estado derivado)
  const serverEntriesRef = useRef(serverEntries);
  if (serverEntriesRef.current !== serverEntries) {
    serverEntriesRef.current = serverEntries;
    setEntries(serverEntries);
  }

  // En «General» el título del curso lleva a su dueño: se reutiliza el que ya
  // preparó el servidor para el filtro
  const courseTitleById = useMemo(
    () => new Map(courses.map((c) => [c.id, c.title])),
    [courses]
  );

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (courseFilter === "all" || e.courseId === courseFilter) &&
          (tab === "all" || tab === "graded" || e.kind === tab)
      ),
    [entries, courseFilter, tab]
  );

  // ── Lo ya calificado: se pide al entrar a la pestaña y tras cada corrección
  useEffect(() => {
    if (!isGraded) return;
    let cancelled = false;
    setLoadingGraded(true);
    (async () => {
      const result = await listGradedRecentlyAction({
        courseId: courseFilter === "all" ? undefined : courseFilter,
      });
      if (cancelled) return;
      setLoadingGraded(false);
      if ("error" in result) {
        toast.error(result.error);
        setGraded([]);
        return;
      }
      setGraded(result.entries);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGraded, courseFilter, gradedReload]);

  const gradedRows = useMemo(() => graded ?? [], [graded]);

  /** Lo que se está listando ahora mismo, sea la cola o lo ya calificado. */
  const rows = useMemo<SelectedRef[]>(
    () =>
      isGraded
        ? gradedRows.map((r) => ({ key: r.key, kind: r.kind }))
        : filtered.map((e) => ({ key: e.key, kind: e.kind })),
    [isGraded, gradedRows, filtered]
  );

  // La primera entrada visible se abre sola; si la seleccionada sale del
  // filtro (o se calificó), pasa a la primera disponible. La que llegó por la
  // URL se respeta aunque no aparezca en la lista.
  useEffect(() => {
    if (isGraded && graded === null) return;
    if (selected && (selected.key === pinned?.key || rows.some((r) => r.key === selected.key))) {
      return;
    }
    setSelected(rows[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, isGraded, graded]);

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

  /** Elegir a mano suelta la entrada que venía fijada por la URL. */
  const pick = useCallback((ref: SelectedRef) => {
    setPinned((p) => (p && p.key === ref.key ? p : null));
    setSelected(ref);
  }, []);

  function changeTab(value: TabValue) {
    setPinned(null);
    // Cruzar entre la cola y lo calificado cambia de lista: se suelta la
    // selección para no enseñar un pendiente con el botón de corregir
    if ((value === "graded") !== (tab === "graded")) setSelected(null);
    setTab(value);
  }

  /** Quita la entrada calificada y avanza a la siguiente de la bandeja. */
  function handleDone(outcome: { message: string; warning?: string }) {
    toast.success(outcome.message);
    // El certificado ya emitido (o el curso ya completado) no es un error: es
    // algo que el maestro tiene que leer, así que se queda un buen rato
    if (outcome.warning) toast.warning(outcome.warning, { duration: 15000 });

    if (isGraded) {
      // La lista se refresca sola: la nota nueva aparece sin recargar
      setGradedReload((n) => n + 1);
      router.refresh();
      return;
    }

    const currentKey = selected?.key ?? null;
    const idx = filtered.findIndex((e) => e.key === currentKey);
    const next = filtered[idx + 1] ?? filtered[idx - 1] ?? null;
    setEntries((prev) => prev.filter((e) => e.key !== currentKey));
    setSelected(next && next.key !== currentKey ? { key: next.key, kind: next.kind } : null);
    router.refresh();
  }

  // Firma de quién calificó y cuándo, para la línea gris sobre el panel
  const signature = isGraded
    ? (gradedRows.find((r) => r.key === selected?.key) ??
      (pinned && pinned.key === selected?.key ? pinned : null))
    : null;

  const emptyQueue = entries.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Por calificar"
        // El número es el de lo PENDIENTE: en «Calificadas» no viene a cuento
        title={
          emptyQueue || isGraded
            ? "Cola de calificación"
            : `Cola de calificación (${formatNumber(entries.length)})`
        }
        description={
          isGraded
            ? "Lo que ya calificaste. Ábrelo para corregir una nota puesta por error."
            : "Tareas entregadas y exámenes con preguntas abiertas pendientes de revisión."
        }
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
            <Tabs value={tab} onValueChange={(v) => changeTab(v as TabValue)}>
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
                <TabsTrigger value="graded" className="px-3">
                  Calificadas
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        }
      />

      {emptyQueue && !isGraded ? (
        // ── Cola totalmente vacía ──────────────────────────────────────────
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-20 text-center shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
            <CircleCheck className="size-8" aria-hidden />
          </span>
          <p className="font-heading text-lg font-semibold">Todo calificado. Nada pendiente.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Cuando un estudiante entregue una tarea o envíe un examen con preguntas abiertas,
            aparecerá aquí.
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            ¿Pusiste mal una nota?{" "}
            <button
              type="button"
              onClick={() => changeTab("graded")}
              className="font-medium text-section-strong underline underline-offset-2 hover:no-underline"
            >
              Ábrela en Calificadas
            </button>{" "}
            y corrígela: se guarda la nota nueva y el alumno se entera.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* Bandeja */}
          <div className="anim-rise max-h-[75vh] overflow-y-auto rounded-xl border bg-card p-2 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            {isGraded ? (
              graded === null && loadingGraded ? (
                <div className="space-y-2 p-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : gradedRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <span className="anim-pop flex size-12 items-center justify-center rounded-full bg-section-soft text-section-strong">
                    <History className="size-6" aria-hidden />
                  </span>
                  <p className="max-w-56 text-sm text-muted-foreground">
                    Todavía no hay calificaciones puestas. En cuanto califiques algo aparecerá
                    aquí para poder corregirlo.
                  </p>
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {gradedRows.map((entry) => (
                    <li key={`${entry.kind}-${entry.key}`}>
                      <GradedRow
                        entry={entry}
                        courseTitle={courseTitleById.get(entry.courseId) ?? entry.courseTitle}
                        selected={entry.key === selected?.key}
                        onSelect={() => pick({ key: entry.key, kind: entry.kind })}
                      />
                    </li>
                  ))}
                </ul>
              )
            ) : filtered.length === 0 ? (
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
                      onSelect={() => pick({ key: entry.key, kind: entry.kind })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Panel de calificación */}
          <div className="min-h-80">
            {signature && detail && !loadingDetail && (
              <p className="mb-2 text-xs text-muted-foreground" suppressHydrationWarning>
                {signature.gradedByName
                  ? `Calificada por ${signature.gradedByName}`
                  : "Calificada"}
                {signature.gradedAtMs !== null
                  ? ` el ${formatDateTime(new Date(signature.gradedAtMs))}`
                  : ""}
              </p>
            )}
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
                mode={isGraded ? "regrade" : "grade"}
                onDone={handleDone}
              />
            ) : detail?.kind === "assignment" ? (
              <AssignmentGradingPanel
                key={detail.detail.submissionId}
                detail={detail.detail}
                mode={isGraded ? "regrade" : "grade"}
                onDone={handleDone}
              />
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
                <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                  <Inbox className="size-8" aria-hidden />
                </span>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {isGraded
                    ? "Selecciona una calificación de la lista para corregirla."
                    : "Selecciona una entrega de la lista para calificarla."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
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

// ─── Fila de lo ya calificado ────────────────────────────────────────────────

function GradedRow({
  entry,
  courseTitle,
  selected,
  onSelect,
}: {
  entry: GradedEntry;
  courseTitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = kindMeta(entry.kind);
  const returned = entry.status === "returned";

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
        <span className="block truncate text-sm font-medium">
          {entry.studentName} · {entry.itemTitle}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{courseTitle}</span>
          {entry.isLate && (
            <Badge variant="destructive" className="h-4 shrink-0 px-1.5 text-[10px]">
              Tardía
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" suppressHydrationWarning>
          {entry.gradedAtMs !== null ? `Calificada ${formatRelative(entry.gradedAtMs)}` : "Calificada"}
          {entry.gradedByName ? ` · por ${entry.gradedByName}` : ""}
        </span>
      </span>
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
          returned ? "bg-warning/10 text-warning" : "bg-secondary text-foreground"
        )}
      >
        {scoreLabel(entry)}
      </span>
    </button>
  );
}
