"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock, Pencil, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatPoints,
} from "@/components/teach/format";
import {
  studentDetailAction,
  type StudentDetailItem,
} from "@/server/actions/teacher-reports";
import { KIND_ICON, KIND_LABEL, STATE_META } from "./item-meta";

export type SheetTarget = {
  studentId: string;
  studentName: string;
  email: string;
  coursePercent: number;
  /** Ítem al que se ancla el panel al abrir desde una celda */
  focusItemId: string | null;
};

const ATTEMPT_STATUS: Record<string, string> = {
  in_progress: "en curso",
  submitted: "por calificar",
  graded: "calificado",
};

const SUBMISSION_STATUS: Record<string, { label: string; className: string }> = {
  submitted: { label: "Enviada", className: "bg-section-soft text-section-strong" },
  graded: { label: "Calificada", className: "bg-cta/10 text-cta" },
  returned: { label: "Devuelta", className: "bg-warning/10 text-warning" },
};

/**
 * Enlace a la cola de calificación con esta nota ya abierta, para corregirla.
 * Es el único sitio donde el maestro ve la nota de un examen o de una tarea,
 * así que es de aquí de donde tiene que poder ir a cambiarla.
 */
function CorregirLink({
  courseId,
  kind,
  id,
  label,
}: {
  courseId: string;
  kind: "exam" | "assignment";
  id: string;
  label: string;
}) {
  return (
    <Link
      href={`/teach/grading?abrir=${encodeURIComponent(id)}&tipo=${kind}&curso=${encodeURIComponent(courseId)}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-section-strong transition-colors hover:bg-section-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={label}
    >
      <Pencil className="size-3" aria-hidden />
      Corregir
    </Link>
  );
}

/** Panel lateral de drill-down por alumno (DISENO-UX §2.11). */
export function StudentDetailSheet({
  courseId,
  target,
  open,
  onOpenChange,
}: {
  courseId: string;
  target: SheetTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-lg">
        {target && (
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="pr-8">{target.studentName}</SheetTitle>
              <SheetDescription>
                {target.email} · {target.coursePercent}% del curso
              </SheetDescription>
            </SheetHeader>
            <DetailBody
              courseId={courseId}
              studentId={target.studentId}
              focusItemId={target.focusItemId}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: StudentDetailItem[] };

function DetailBody({
  courseId,
  studentId,
  focusItemId,
}: {
  courseId: string;
  studentId: string;
  focusItemId: string | null;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const focusRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    studentDetailAction(courseId, studentId)
      .then((result) => {
        if (cancelled) return;
        if ("error" in result) setState({ status: "error", message: result.error });
        else setState({ status: "ready", items: result.items });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "error",
            message: "No se pudo cargar el detalle. Revisa tu conexión con el servidor.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, studentId, retry]);

  // Anclar el scroll al ítem clicado en la matriz
  useEffect(() => {
    if (state.status === "ready" && focusItemId) {
      focusRef.current?.scrollIntoView({ block: "center" });
    }
  }, [state, focusItemId]);

  if (state.status === "loading") {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="size-8 text-destructive" aria-hidden />
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <ol className="space-y-2">
        {state.items.map((item) => (
          <DetailItemRow
            key={item.itemId}
            courseId={courseId}
            item={item}
            focused={item.itemId === focusItemId}
            ref={item.itemId === focusItemId ? focusRef : undefined}
          />
        ))}
      </ol>
    </div>
  );
}

function DetailItemRow({
  courseId,
  item,
  focused,
  ref,
}: {
  courseId: string;
  item: StudentDetailItem;
  focused: boolean;
  ref?: React.Ref<HTMLLIElement>;
}) {
  const KindIcon = KIND_ICON[item.kind];
  const stateMeta = STATE_META[item.status];
  const StateIcon = stateMeta.icon;
  const showPercent =
    item.kind === "document" || item.kind === "video" || item.kind === "text";

  return (
    <li
      ref={ref}
      className={cn(
        "rounded-lg border bg-card p-3",
        focused && "border-section bg-section-soft/50"
      )}
    >
      <div className="flex items-start gap-2">
        <KindIcon
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium" title={item.title}>
              {item.title}
            </p>
            {!item.required && (
              <span className="shrink-0 text-xs text-muted-foreground">Opcional</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="sr-only">{KIND_LABEL[item.kind]}</span>
            <span className="inline-flex items-center gap-1">
              <StateIcon className={cn("size-3.5", stateMeta.className)} aria-hidden />
              {stateMeta.label}
            </span>
            {showPercent && <span>{Math.round(item.percent)}% visto</span>}
            {item.totalSeconds > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                {formatDuration(item.totalSeconds)}
              </span>
            )}
            {item.completedAt !== null && (
              <span>Completado: {formatDate(new Date(item.completedAt))}</span>
            )}
          </div>

          {item.kind === "exam" && (
            <AttemptList courseId={courseId} title={item.title} attempts={item.attempts ?? []} />
          )}
          {item.kind === "assignment" && (
            <SubmissionInfo
              courseId={courseId}
              title={item.title}
              submission={item.submission ?? null}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function AttemptList({
  courseId,
  title,
  attempts,
}: {
  courseId: string;
  title: string;
  attempts: NonNullable<StudentDetailItem["attempts"]>;
}) {
  if (attempts.length === 0) {
    return <p className="text-xs text-muted-foreground">Sin intentos todavía</p>;
  }
  return (
    <ul className="space-y-1 rounded-md bg-muted/50 p-2">
      {attempts.map((attempt) => {
        const percent =
          attempt.finalScore !== null && attempt.maxScore
            ? Math.round((attempt.finalScore / attempt.maxScore) * 1000) / 10
            : null;
        return (
          <li
            key={attempt.attemptNumber}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground">
              Intento {attempt.attemptNumber} · {ATTEMPT_STATUS[attempt.status] ?? attempt.status}
              {attempt.submittedAt !== null &&
                ` · ${formatDateTime(new Date(attempt.submittedAt))}`}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="font-medium tabular-nums">
                {attempt.finalScore !== null && attempt.maxScore !== null
                  ? `${formatPoints(attempt.finalScore)}/${formatPoints(attempt.maxScore)} pts${
                      percent !== null ? ` (${percent}%)` : ""
                    }`
                  : "—"}
              </span>
              {attempt.status === "graded" && (
                <CorregirLink
                  courseId={courseId}
                  kind="exam"
                  id={attempt.attemptId}
                  label={`Corregir la calificación del intento ${attempt.attemptNumber} de ${title}`}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SubmissionInfo({
  courseId,
  title,
  submission,
}: {
  courseId: string;
  title: string;
  submission: NonNullable<StudentDetailItem["submission"]> | null;
}) {
  if (!submission) {
    return <p className="text-xs text-muted-foreground">Sin entrega todavía</p>;
  }
  const meta = SUBMISSION_STATUS[submission.status] ?? {
    label: submission.status,
    className: "",
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/50 p-2 text-xs">
      <Badge variant="secondary" className={meta.className}>
        {meta.label}
      </Badge>
      {submission.score !== null && (
        <span className="font-medium tabular-nums">
          Calificación: {formatPoints(submission.score)}
        </span>
      )}
      {submission.isLate && (
        <span className="inline-flex items-center gap-1 text-warning">
          <TriangleAlert className="size-3.5" aria-hidden />
          Entrega tardía
        </span>
      )}
      <span className="text-muted-foreground">
        Enviada: {formatDateTime(new Date(submission.submittedAt))}
      </span>
      {submission.status === "graded" && (
        <CorregirLink
          courseId={courseId}
          kind="assignment"
          id={submission.submissionId}
          label={`Corregir la calificación de ${title}`}
        />
      )}
    </div>
  );
}
