import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KindChip } from "@/components/kind-meta";
import { formatNumber } from "@/components/teach/format";
import { HBar } from "./hbar";

export type ExamStat = {
  itemId: string;
  title: string;
  avgPercent: number | null;
  passRate: number | null;
  passScore: number | null;
  attemptsCount: number;
  studentsWithScore: number;
  maxScore: number;
};

/**
 * Promedio del grupo por examen: barra café con marcador de referencia
 * vertical en la calificación mínima (si existe). Los valores exactos van
 * como texto; sin calificaciones aún, se dice con palabras.
 */
export function ExamStatsCard({
  exams,
  className,
}: {
  exams: ExamStat[];
  className?: string;
}) {
  return (
    <Card className={cn("anim-rise anim-d2 shadow-[0_1px_2px_rgb(15_23_42/0.05)]", className)}>
      <CardHeader>
        <CardTitle>Exámenes</CardTitle>
        <CardDescription>
          Promedio del grupo por examen; la línea marca la calificación mínima
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {exams.map((exam) => {
          const chips = [
            `${formatNumber(exam.attemptsCount)} ${exam.attemptsCount === 1 ? "intento" : "intentos"}`,
            `con calificación: ${formatNumber(exam.studentsWithScore)}`,
          ];
          const barLabel =
            `Promedio del grupo: ${exam.avgPercent}%` +
            (exam.passScore !== null ? ` · Mínimo para aprobar: ${exam.passScore}%` : "");
          return (
            <div key={exam.itemId} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <KindChip kind="exam" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium" title={exam.title}>
                  {exam.title}
                </p>
                {chips.map((chip) => (
                  <span
                    key={chip}
                    className="shrink-0 rounded-full border bg-card px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              {exam.avgPercent === null ? (
                <p className="text-sm text-muted-foreground">Sin intentos calificados</p>
              ) : (
                <>
                  <HBar
                    percent={exam.avgPercent}
                    label={barLabel}
                    marker={
                      exam.passScore !== null
                        ? { percent: exam.passScore, label: `Mínimo: ${exam.passScore}%` }
                        : null
                    }
                  />
                  <p className="text-sm tabular-nums">
                    Promedio: <span className="font-medium">{exam.avgPercent}%</span>
                    {exam.passRate !== null && (
                      <>
                        {" "}
                        · Aprobación: <span className="font-medium">{exam.passRate}%</span>
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
