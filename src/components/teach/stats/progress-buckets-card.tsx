import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatNumber } from "@/components/teach/format";
import { HBar } from "./hbar";

export type ProgressBucket = { label: string; count: number; isComplete: boolean };

/**
 * Histograma de 5 cubetas de avance como barras horizontales de un solo matiz
 * café. La cubeta "100%" es ESTADO (curso completado): verde éxito + icono
 * CircleCheck + etiqueta — nunca color solo.
 */
export function ProgressBucketsCard({
  buckets,
  enrolled,
  className,
}: {
  buckets: ProgressBucket[];
  enrolled: number;
  className?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <Card className={cn("anim-rise shadow-[0_1px_2px_rgb(15_23_42/0.05)]", className)}>
      <CardHeader>
        <CardTitle>Distribución de avance</CardTitle>
        <CardDescription>Cuántos estudiantes van en cada tramo del curso</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {buckets.map((bucket) => {
            const detail = bucket.isComplete
              ? `Curso completado (100%): ${formatNumber(bucket.count)} de ${formatNumber(enrolled)} estudiantes`
              : `Avance ${bucket.label}: ${formatNumber(bucket.count)} de ${formatNumber(enrolled)} estudiantes`;
            return (
              <li key={bucket.label} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex w-20 shrink-0 items-center justify-end gap-1 text-xs font-medium tabular-nums",
                    bucket.isComplete ? "text-success" : "text-muted-foreground"
                  )}
                  title={bucket.isComplete ? "Curso completado" : undefined}
                >
                  {bucket.isComplete && (
                    <CircleCheck className="size-3.5 shrink-0" aria-hidden />
                  )}
                  {bucket.label}
                </span>
                <HBar
                  className="flex-1"
                  percent={(bucket.count / max) * 100}
                  success={bucket.isComplete}
                  label={detail}
                />
                <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums">
                  {formatNumber(bucket.count)}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
