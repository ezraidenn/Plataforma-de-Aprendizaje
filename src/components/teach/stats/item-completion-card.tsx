import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { KindChip } from "@/components/kind-meta";
import { formatNumber } from "@/components/teach/format";
import { HBar } from "./hbar";

export type ItemCompletionRow = {
  itemId: string;
  title: string;
  kind: string;
  completedCount: number;
  percent: number;
};

/**
 * Completitud por lección: barras horizontales de un solo matiz café. La
 * identidad de cada fila la dan la etiqueta + el icono de tipo (KindChip),
 * nunca el color de la barra. El valor exacto va como texto al final.
 */
export function ItemCompletionCard({
  items,
  enrolled,
  courseId,
  className,
}: {
  items: ItemCompletionRow[];
  enrolled: number;
  courseId: string;
  className?: string;
}) {
  return (
    <Card className={cn("anim-rise anim-d1 shadow-[0_1px_2px_rgb(15_23_42/0.05)]", className)}>
      <CardHeader>
        <CardTitle>Completitud por lección</CardTitle>
        <CardDescription>
          Matriculados que completaron cada lección obligatoria, en el orden del curso
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
              Este curso aún no tiene lecciones obligatorias que medir.
            </p>
            <Link
              href={`/teach/courses/${courseId}/content`}
              className={buttonVariants({ variant: "outline" })}
            >
              Ir al contenido
            </Link>
          </div>
        ) : (
          <ul className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
            {items.map((item, i) => {
              const detail = `${item.title}: completada por ${formatNumber(item.completedCount)} de ${formatNumber(enrolled)} estudiantes (${item.percent}%)`;
              return (
                <li
                  key={item.itemId}
                  className={cn(
                    "flex items-center gap-3",
                    i < 5 && `anim-rise anim-d${i + 1}`
                  )}
                >
                  <KindChip kind={item.kind} />
                  <span
                    className="w-32 shrink-0 truncate text-sm sm:w-52"
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  <HBar className="min-w-14 flex-1" percent={item.percent} label={detail} />
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:text-sm">
                    {formatNumber(item.completedCount)} de {formatNumber(enrolled)} ·{" "}
                    <span className="font-medium text-foreground">{item.percent}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
