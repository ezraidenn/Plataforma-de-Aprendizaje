import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "outline" | "disabled" | "orange";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "border-cta bg-cta text-white",
  outline: "bg-white text-slate-900",
  disabled: "border-indigo-200 bg-indigo-50 text-indigo-300",
  orange: "border-orange-600 bg-orange-600 text-white",
};

/** Botón de la plataforma en miniatura (decorativo, no interactivo). */
export function MiniButton({
  children,
  variant = "outline",
  glow = false,
  className,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  glow?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-all duration-300",
        BUTTON[variant],
        glow && "shadow-[0_0_0_5px_rgb(79_70_229/0.22)]",
        className
      )}
    >
      {children}
    </span>
  );
}

type BadgeTone = "ok" | "warn" | "bad" | "muted";

const BADGE: Record<BadgeTone, string> = {
  ok: "bg-green-100 text-green-700",
  warn: "bg-amber-100 text-amber-700",
  bad: "bg-red-50 text-red-700",
  muted: "bg-slate-100 text-slate-600",
};

export function MiniBadge({ tone, children, className }: { tone: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold transition-colors duration-300", BADGE[tone], className)}>
      {children}
    </span>
  );
}

/** Aviso oscuro abajo a la derecha, como los toasts de la plataforma. */
export function MiniToast({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "absolute bottom-2 right-2 max-w-[85%] rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10.5px] font-semibold leading-snug text-white shadow-lg transition-all duration-300",
        show ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"
      )}
    >
      {children}
    </span>
  );
}
