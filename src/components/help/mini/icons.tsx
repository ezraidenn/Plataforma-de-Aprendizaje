/** Íconos de estado de la plataforma en miniatura (mismos colores que la vista del alumno). */
type IconProps = { className?: string };

export function MiniCheck({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#16a34a" />
      <path d="m8 12 3 3 5-6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MiniLock({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function MiniOpen({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="#94a3b8" strokeWidth="2" fill="none" />
    </svg>
  );
}

/** Anillo de avance (0–1) con punto central, como una lección «en curso». */
export function MiniRing({
  progress,
  className,
  color = "#4f46e5",
  track = "#e0e7ff",
}: IconProps & { progress: number; color?: string; track?: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const done = Math.min(1, Math.max(0, progress));
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r={r} stroke={track} strokeWidth="3" fill="none" />
      <circle
        cx="12"
        cy="12"
        r={r}
        stroke={color}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - done)}
        transform="rotate(-90 12 12)"
        className="transition-[stroke-dashoffset] duration-100 ease-linear"
      />
      <circle cx="12" cy="12" r="2.5" fill={color} />
    </svg>
  );
}
