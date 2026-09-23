import type { Metadata } from "next";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { ownScope } from "@/server/auth/view-scope";
import { gradedRecently, gradingQueue } from "@/server/services/grading";
import { listTeacherCourses } from "@/server/services/courses";
import { titleWithOwner, VIEW_OWN } from "@/lib/view-context";
import {
  GradingView,
  type OpenTarget,
  type QueueEntry,
} from "@/components/teach/grading/grading-view";
import { SwitchContextButton } from "@/components/teach/switch-context-button";

export const metadata: Metadata = { title: "Por calificar" };

export default async function GradingPage({
  searchParams,
}: {
  searchParams: Promise<{
    attempt?: string;
    submission?: string;
    abrir?: string;
    tipo?: string;
    curso?: string;
  }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const { attempt, submission, abrir, tipo, curso } = await searchParams;
  const showOwner = scope.kind === "all";
  const scoped = listTeacherCourses(scope);
  // En «General», cada curso lleva a su dueño: «NOM-035 · Maestro A»
  const ownerByCourse = showOwner
    ? new Map(scoped.map((r) => [r.course.id, r.ownerName]))
    : new Map<string, string>();
  const withOwner = (courseId: string, title: string) =>
    titleWithOwner(title, ownerByCourse.get(courseId), showOwner);

  const queue = gradingQueue(scope);
  const entries: QueueEntry[] = queue.map((e) =>
    e.kind === "exam"
      ? {
          kind: "exam",
          key: e.attemptId,
          courseId: e.courseId,
          courseTitle: withOwner(e.courseId, e.courseTitle),
          itemTitle: e.itemTitle,
          studentName: e.studentName,
          submittedAtMs: e.submittedAt.getTime(),
          pendingQuestions: e.pendingQuestions,
          isLate: false,
        }
      : {
          kind: "assignment",
          key: e.submissionId,
          courseId: e.courseId,
          courseTitle: withOwner(e.courseId, e.courseTitle),
          itemTitle: e.itemTitle,
          studentName: e.studentName,
          submittedAtMs: e.submittedAt.getTime(),
          pendingQuestions: 0,
          isLate: e.isLate,
        }
  );

  const courses = scoped.map(({ course }) => ({
    id: course.id,
    title: withOwner(course.id, course.title),
  }));

  // «Corregir» desde donde se ve la nota: ?abrir=<id>&tipo=exam|assignment
  // (y, si se sabe, &curso= para encontrarla aunque sea vieja). Si resulta que
  // todavía está pendiente, se abre en la cola de siempre.
  const openKind = tipo === "exam" || tipo === "assignment" ? tipo : null;
  const openPending =
    abrir && openKind ? entries.find((e) => e.kind === openKind && e.key === abrir) : undefined;
  let initialOpen: OpenTarget | null = null;
  if (abrir && openKind && !openPending) {
    const row = gradedRecently(scope, { limit: 200, courseId: curso }).find(
      (e) => e.kind === openKind && (e.kind === "exam" ? e.attemptId : e.submissionId) === abrir
    );
    if (row) {
      initialOpen = {
        key: abrir,
        kind: openKind,
        gradedByName: row.gradedByName ?? null,
        gradedAtMs: row.gradedAt?.getTime() ?? null,
      };
    }
  }

  // Deep-link desde notificaciones: ?attempt= o ?submission= preseleccionan
  const initialSelectedKey = openPending
    ? openPending.key
    : attempt && entries.some((e) => e.kind === "exam" && e.key === attempt)
      ? attempt
      : submission && entries.some((e) => e.kind === "assignment" && e.key === submission)
        ? submission
        : null;
  // La notificación del admin apunta a UNA entrega de sus propios cursos: si no
  // aparece en la cola actual pero SÍ está en su propia cola, el contexto
  // activo no es «Mi contenido»
  const missingFromScope =
    user.role === "admin" &&
    scope.kind !== "own" &&
    Boolean(attempt || submission) &&
    initialSelectedKey === null;
  const ownQueue = missingFromScope ? gradingQueue(ownScope(user)) : [];
  const outOfContext =
    missingFromScope &&
    (attempt
      ? ownQueue.some((e) => e.kind === "exam" && e.attemptId === attempt)
      : ownQueue.some((e) => e.kind === "assignment" && e.submissionId === submission));

  return (
    <>
      {outOfContext && (
        <p className="mb-4 rounded-xl border border-primary/20 bg-brand-tint px-4 py-3 text-sm text-primary">
          Esta entrega está fuera de esta vista ·{" "}
          <SwitchContextButton value={VIEW_OWN}>Ver en Mi contenido</SwitchContextButton>
        </p>
      )}
      <GradingView
        entries={entries}
        courses={courses}
        initialSelectedKey={initialSelectedKey}
        initialOpen={initialOpen}
      />
    </>
  );
}
