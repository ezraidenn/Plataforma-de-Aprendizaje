import type { Metadata } from "next";
import { requireTeacher } from "@/server/auth/guards";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { ownScope } from "@/server/auth/view-scope";
import { gradingQueue } from "@/server/services/grading";
import { listTeacherCourses } from "@/server/services/courses";
import { titleWithOwner, VIEW_OWN } from "@/lib/view-context";
import { GradingView, type QueueEntry } from "@/components/teach/grading/grading-view";
import { SwitchContextButton } from "@/components/teach/switch-context-button";

export const metadata: Metadata = { title: "Por calificar" };

export default async function GradingPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string; submission?: string }>;
}) {
  const user = await requireTeacher();
  const scope = await getViewScope(user);
  const { attempt, submission } = await searchParams;
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

  // Deep-link desde notificaciones: ?attempt= o ?submission= preseleccionan
  const initialSelectedKey =
    attempt && entries.some((e) => e.kind === "exam" && e.key === attempt)
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
      <GradingView entries={entries} courses={courses} initialSelectedKey={initialSelectedKey} />
    </>
  );
}
