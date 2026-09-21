import { Activity, CircleCheck, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration, formatNumber } from "@/components/teach/format";

/**
 * KPIs del curso como STAT TILES (guía de dataviz): número grande en
 * font-heading + etiqueta + hint, sin gráfica. "Aprobados" usa el verde
 * semántico de éxito (estado), el resto toma el color de la sección actual.
 */
export function StatTiles({
  enrolled,
  started,
  completed,
  completionRate,
  avgProgress,
  avgTotalSeconds,
}: {
  enrolled: number;
  started: number;
  completed: number;
  completionRate: number;
  avgProgress: number;
  avgTotalSeconds: number;
}) {
  const tiles: {
    label: string;
    value: string;
    hint: string;
    icon: LucideIcon;
    tone: "section" | "success";
  }[] = [
    {
      label: "Matriculados",
      value: formatNumber(enrolled),
      hint: "matrículas activas",
      icon: Users,
      tone: "section",
    },
    {
      label: "Han iniciado",
      value: formatNumber(started),
      hint: "con actividad registrada",
      icon: Activity,
      tone: "section",
    },
    {
      label: "Aprobados",
      value: formatNumber(completed),
      hint: `${completionRate}% de los matriculados`,
      icon: CircleCheck,
      tone: "success",
    },
    {
      label: "Avance promedio",
      value: `${avgProgress}%`,
      hint: `Tiempo promedio: ${formatDuration(avgTotalSeconds)}`,
      icon: TrendingUp,
      tone: "section",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile, i) => (
        <Card
          key={tile.label}
          className={cn(
            "anim-rise shadow-[0_1px_2px_rgb(15_23_42/0.05)]",
            ["anim-d1", "anim-d2", "anim-d3", "anim-d4"][i]
          )}
        >
          <CardContent className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">{tile.label}</p>
              <p className="font-heading text-2xl font-bold">{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.hint}</p>
            </div>
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                tile.tone === "success"
                  ? "bg-success/10 text-success"
                  : "bg-section-soft text-section-strong"
              )}
            >
              <tile.icon className="size-5" aria-hidden />
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
