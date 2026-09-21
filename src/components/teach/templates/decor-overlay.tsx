import type { DecorPreset } from "@/lib/certificate-decor";
import { cn } from "@/lib/utils";

/**
 * Overlay SVG de adornos del certificado. Dibuja EXACTAMENTE las mismas
 * primitivas fraccionales (lib/certificate-decor) que el servidor estampa con
 * pdf-lib en renderCertificatePdf → la vista previa es fiel al PDF real.
 *
 * El viewBox está en puntos PDF (pageW × pageH), así que los anchos de trazo
 * coinciden 1:1 con el PDF y escalan igual al reducir el lienzo. En los paths,
 * el `transform` replica lo que hace pdf-lib: origen en (x·pageW, y·pageH) y
 * escala `scale · pageW · 0.01` (el path vive en una caja de 100 unidades);
 * como en PDF, la escala también afecta el grosor del trazo.
 *
 * Va SOBRE el fondo y DEBAJO de los campos; nunca captura el puntero.
 */
export function DecorOverlay({
  preset,
  pageW,
  pageH,
  thumbnail = false,
  className,
}: {
  preset: DecorPreset | null;
  pageW: number;
  pageH: number;
  /** Miniaturas (~120px): trazos a 1px de pantalla para que se distingan */
  thumbnail?: boolean;
  className?: string;
}) {
  if (!preset) return null;
  const vector = thumbnail ? ("non-scaling-stroke" as const) : undefined;

  return (
    <svg
      viewBox={`0 0 ${pageW} ${pageH}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    >
      {preset.elements.map((el, i) => {
        if (el.type === "rect") {
          return (
            <rect
              key={i}
              x={el.x * pageW}
              y={el.y * pageH}
              width={el.w * pageW}
              height={el.h * pageH}
              fill={el.fill ?? "none"}
              stroke={el.stroke}
              strokeWidth={el.strokeWidth}
              opacity={el.opacity}
              vectorEffect={el.stroke ? vector : undefined}
            />
          );
        }
        if (el.type === "line") {
          return (
            <line
              key={i}
              x1={el.x1 * pageW}
              y1={el.y1 * pageH}
              x2={el.x2 * pageW}
              y2={el.y2 * pageH}
              stroke={el.color}
              strokeWidth={el.width}
              opacity={el.opacity}
              vectorEffect={vector}
            />
          );
        }
        if (el.type === "circle") {
          return (
            <circle
              key={i}
              cx={el.cx * pageW}
              cy={el.cy * pageH}
              r={el.r * pageW}
              fill={el.fill ?? "none"}
              stroke={el.stroke}
              strokeWidth={el.strokeWidth}
              opacity={el.opacity}
              vectorEffect={el.stroke ? vector : undefined}
            />
          );
        }
        // path: caja de 100 unidades, misma escala que pdf-lib (drawSvgPath)
        const s = el.scale * pageW * 0.01;
        return (
          <path
            key={i}
            d={el.d}
            transform={`translate(${el.x * pageW} ${el.y * pageH}) scale(${s})`}
            fill="none"
            stroke={el.color}
            strokeWidth={el.width}
            opacity={el.opacity}
            vectorEffect={vector}
          />
        );
      })}
    </svg>
  );
}
