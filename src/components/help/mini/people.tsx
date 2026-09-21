import { cn } from "@/lib/utils";

const AVATAR_TONES = [
  "bg-indigo-100 text-cta",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700",
] as const;

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

/** Fila de alumno como en «Estudiantes del curso»: avatar, nombre, detalle y «Aprobado» o su avance. */
export function MiniStudentRow({
  name,
  detail,
  percent,
  tone = 0,
  action,
  className,
}: {
  name: string;
  detail?: string;
  percent: number;
  tone?: number;
  /** Botón al final de la fila (p. ej. quitar del curso) */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 border-t border-slate-100 px-2.5 py-1 text-[10.5px]", className)}>
      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-extrabold", AVATAR_TONES[tone % AVATAR_TONES.length])}>
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block truncate">{name}</b>
        {detail && <span className="block truncate text-[9px] text-slate-500">{detail}</span>}
      </span>
      {percent >= 100 ? (
        <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-extrabold text-green-700">Aprobado</span>
      ) : (
        <span className="shrink-0 text-[9.5px] font-bold tabular-nums text-slate-500">{percent}%</span>
      )}
      {action}
    </div>
  );
}

/** Avatares apilados de un grupo. */
export function MiniAvatars({ names, className }: { names: readonly string[]; className?: string }) {
  return (
    <span className={cn("flex -space-x-1.5", className)}>
      {names.map((name, i) => (
        <span
          key={name}
          className={cn(
            "flex size-5 animate-in zoom-in items-center justify-center rounded-full border-2 border-white text-[8px] font-extrabold duration-300",
            AVATAR_TONES[i % AVATAR_TONES.length]
          )}
        >
          {initials(name)}
        </span>
      ))}
    </span>
  );
}
