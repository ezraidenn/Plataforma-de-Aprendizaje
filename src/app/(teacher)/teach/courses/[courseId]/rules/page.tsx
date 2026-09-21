import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Info, ListChecks, Users } from "lucide-react";
import { db } from "@/server/db";
import { enrollments } from "@/server/db/schema";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { linearOrder } from "@/server/services/tree";
import {
  DEFAULT_RULES,
  evaluateForDisplay,
  type Condition,
  type RuleGroup,
} from "@/server/services/rules-engine";
import { RulesBuilder, type ExamOption } from "@/components/teach/rules/rules-builder";
import { TabHeading } from "@/components/teach/tab-heading";

export const metadata: Metadata = { title: "Reglas de aprobación" };

export default async function CourseRulesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const user = await requireTeacher();
  const { courseId } = await params;
  const course = getOwnedCourse(courseId, user);
  if (!course) notFound();

  // Exámenes del curso en orden lineal (para condiciones de examen)
  const examOptions: ExamOption[] = linearOrder(courseId)
    .filter((item) => item.kind === "exam")
    .map((item) => ({ id: item.id, title: item.title }));

  // Reglas guardadas o el punto de partida por defecto
  const saved = course.completionRules as RuleGroup | null;
  const hasSavedRules =
    saved !== null && Array.isArray(saved?.conditions) && saved.conditions.length > 0;
  const rules = hasSavedRules ? saved : DEFAULT_RULES;
  // Condiciones planas (Y u O); los grupos anidados (modo avanzado) se omiten
  const conditions = rules.conditions.filter((c): c is Condition => !("op" in c));

  // Vista previa de impacto con las reglas GUARDADAS, sobre matrículas activas
  const activeEnrollments = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.status, "active")))
    .all();
  let wouldPass = 0;
  for (const enrollment of activeEnrollments) {
    if (evaluateForDisplay(enrollment.id)?.passed) wouldPass++;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <TabHeading
        title="Reglas de aprobación"
        icon={ListChecks}
        description="Define cuándo aprueba un estudiante este curso."
      />

      {!hasSavedRules && (
        <div className="flex items-start gap-2 rounded-xl border border-section/30 bg-section-soft/60 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-section-strong" aria-hidden />
          <p>
            Este curso aún no tiene reglas guardadas. Te mostramos un punto de partida; ajústalo y
            guarda cuando estés conforme.
          </p>
        </div>
      )}

      <RulesBuilder
        courseId={courseId}
        initialConditions={conditions}
        initialOp={rules.op === "OR" ? "OR" : "AND"}
        examOptions={examOptions}
      />

      <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
          <Users className="size-5" aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-medium">Vista previa de impacto</p>
          {activeEnrollments.length === 0 ? (
            <p className="mt-0.5 text-muted-foreground">
              Aún no hay estudiantes inscritos en este curso.
            </p>
          ) : (
            <p className="mt-0.5">
              Con las reglas actuales, hoy aprobarían{" "}
              <strong>
                {wouldPass} de {activeEnrollments.length}
              </strong>{" "}
              inscritos.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            La vista previa usa las reglas guardadas; al guardar se recalcula. Nadie pierde una
            aprobación ya otorgada.
          </p>
        </div>
      </div>
    </div>
  );
}
