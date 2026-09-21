import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  BookOpen,
  ChevronRight,
  Circle,
  CircleCheck,
  FolderOpen,
  X,
} from "lucide-react";
import { requireStudent } from "@/server/auth/guards";
import { getCourse } from "@/server/services/courses";
import { courseProgress, getEnrollment } from "@/server/services/progress";
import {
  evaluateForDisplay,
  type Condition,
  type ConditionResult,
} from "@/server/services/rules-engine";
import { hiddenResultsExamIds } from "@/server/services/exam-results";
import { buildStudentTree } from "@/components/student/course-tree-data";
import { CourseTree } from "@/components/student/course-tree";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

/** La condición depende de un examen cuyos resultados el alumno aún no ve. */
function dependsOnHiddenExam(c: Condition, hidden: Set<string>): boolean {
  if (c.type === "exam_specific") return hidden.has(c.item_id);
  if (c.type === "exam_average") {
    return c.scope === "all" ? hidden.size > 0 : c.scope.some((id) => hidden.has(id));
  }
  return false;
}

/** "65% < 80%" o "sin intento aún" para condiciones pendientes. */
function pendingDetail(r: ConditionResult): string | null {
  const c = r.condition;
  if (r.value === null) {
    return c.type === "exam_average" || c.type === "exam_specific"
      ? "sin intento aún"
      : null;
  }
  return "min_percent" in c ? `${r.value}% < ${c.min_percent}%` : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return { title: getCourse(courseId)?.title ?? "Curso" };
}

/**
 * Índice del curso (DISENO-UX §2.3): la vista de "mapa". Header con progreso
 * global y botón Continuar; debajo, el árbol completo con estados y candados.
 */
export default async function CourseIndexPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const user = await requireStudent();
  const { courseId } = await params;

  const course = getCourse(courseId);
  if (!course || course.status !== "published") redirect("/dashboard");

  const enrollment = getEnrollment(courseId, user.id);
  if (!enrollment || enrollment.status === "dropped") redirect("/dashboard");

  const summary = courseProgress(courseId, user.id);
  const nodes = buildStudentTree(courseId, user.id);
  const done = summary.percent >= 100;
  const evaluation = evaluateForDisplay(enrollment.id);
  const hiddenExams = hiddenResultsExamIds(courseId);

  return (
    <div className="space-y-6">
      {/* Header del curso */}
      <PageHeader
        icon={BookOpen}
        eyebrow="Curso"
        title={course.title}
        description={course.description ?? undefined}
        actions={
          !done && summary.nextItem ? (
            <Button
              asChild
              className="h-11 min-w-36 bg-cta text-cta-foreground hover:bg-cta/90"
            >
              <Link href={`/courses/${courseId}/items/${summary.nextItem.id}`}>
                {summary.percent > 0 ? "Continuar" : "Empezar"}
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* Progreso y aprobación (semánticos: verde/rojo) */}
      <Card className="anim-rise anim-d1">
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Progress
              value={summary.percent}
              className="h-2 max-w-md"
              aria-label={`Progreso del curso: ${summary.percent}%`}
            />
            <span className="shrink-0 text-sm text-muted-foreground">
              {summary.completedRequired} de {summary.totalRequired} lecciones ·{" "}
              {summary.percent}%
            </span>
          </div>

          {/* Desglose de aprobación (DISENO-UX §2.3): qué falta y qué ya está */}
          {evaluation && evaluation.results.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center gap-2">
                <p className="font-heading text-sm font-semibold">Para aprobar este curso</p>
                {evaluation.passed && (
                  <Badge className="gap-1 bg-success text-success-foreground">
                    <BadgeCheck className="size-3.5" aria-hidden />
                    Curso aprobado
                  </Badge>
                )}
              </div>
              <ul className="space-y-1.5">
                {evaluation.results.map((r, i) => {
                  // Resultados ocultos: ni % ni ✗ roja, solo «resultados pendientes»
                  const hidden =
                    !r.passed && r.value !== null && dependsOnHiddenExam(r.condition, hiddenExams);
                  const detail = pendingDetail(r);
                  return (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      {r.passed ? (
                        <CircleCheck
                          className="size-5 shrink-0 fill-progress-ring stroke-white"
                          aria-hidden
                        />
                      ) : r.value === null || hidden ? (
                        <Circle className="size-5 shrink-0 text-locked" aria-hidden />
                      ) : (
                        <X className="size-5 shrink-0 text-destructive" aria-hidden />
                      )}
                      <span className={r.passed ? undefined : "text-muted-foreground"}>
                        {r.passed
                          ? r.label
                          : hidden
                            ? `${r.label} — resultados pendientes`
                            : `Te falta: ${r.label}${detail ? ` — ${detail}` : ""}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Árbol completo del curso */}
      <Card className="anim-rise anim-d2">
        <CardContent>
          <h2 className="mb-3 flex items-center gap-2.5 font-heading text-base font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-section-soft text-section-strong">
              <FolderOpen className="size-4" aria-hidden />
            </span>
            Contenido del curso
          </h2>
          {nodes.length > 0 ? (
            <CourseTree nodes={nodes} />
          ) : (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
                <FolderOpen className="size-8" aria-hidden />
              </span>
              <p className="max-w-sm text-muted-foreground">
                Este curso aún no tiene lecciones. Tu instructor está preparando
                el contenido.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
