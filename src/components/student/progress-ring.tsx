import { Check } from "lucide-react";

/**
 * Anillo de progreso SVG (DISENO-UX §2.2): verde #22C55E, gris si 0%,
 * Check central si 100%. Componente puro: sirve en server y client.
 */
export function ProgressRing({
  percent,
  size = 40,
  strokeWidth = 4,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const done = clamped >= 100;

  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={done ? "Curso completado" : `${clamped}% completado`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill={done ? "var(--progress-ring)" : "none"}
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        {clamped > 0 && !done && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--progress-ring)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {done && (
        <Check
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white"
          style={{ width: size * 0.5, height: size * 0.5 }}
          strokeWidth={3}
          aria-hidden
        />
      )}
    </span>
  );
}
