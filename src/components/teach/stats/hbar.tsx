import { cn } from "@/lib/utils";

/**
 * Barra horizontal de UNA sola medida (guía de dataviz): un solo matiz café
 * para toda la serie, track en --border, extremos redondeados y el dato exacto
 * en title + aria-label (el color nunca carga el significado solo).
 * `success` se reserva para ESTADO (p. ej. la cubeta "100 %"), siempre
 * acompañado de icono + etiqueta fuera de la barra.
 */
export function HBar({
  percent,
  label,
  success = false,
  marker = null,
  className,
}: {
  /** 0–100: ancho del relleno. */
  percent: number;
  /** Dato exacto para el tooltip nativo y lectores de pantalla. */
  label: string;
  /** Relleno verde éxito (estado), no un color de serie. */
  success?: boolean;
  /** Línea de referencia vertical (p. ej. calificación mínima). */
  marker?: { percent: number; label: string } | null;
  className?: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  const markerLeft = marker ? Math.max(0, Math.min(100, marker.percent)) : 0;
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={cn("relative h-2.5 rounded-full bg-border", className)}
    >
      <div
        aria-hidden
        className={cn("h-full rounded-full", success ? "bg-success" : "bg-section")}
        style={{ width: `${width}%` }}
      />
      {marker && (
        <span
          aria-hidden
          title={marker.label}
          className="absolute -inset-y-0.5 z-10 w-0.5 rounded-full bg-foreground/40"
          style={{ left: `calc(${markerLeft}% - 1px)` }}
        />
      )}
    </div>
  );
}
