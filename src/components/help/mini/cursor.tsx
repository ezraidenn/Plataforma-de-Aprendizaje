import { cn } from "@/lib/utils";

/**
 * Puntero del ratón que llega al elemento que lo contiene (el padre debe ser
 * `relative`) y hace clic. `at`: ya llegó; `pressed`: está haciendo clic.
 */
export function MiniCursor({ at, pressed = false }: { at: boolean; pressed?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-1/2 top-1/2 z-20 size-5 drop-shadow-[0_1px_1px_rgb(0_0_0/0.35)] transition-all duration-700 ease-out",
        at ? "translate-x-0 translate-y-0 opacity-100" : "translate-x-10 translate-y-8 opacity-0",
        pressed && "scale-75"
      )}
    >
      <path d="M5 3l14 8-6 1.5L10 19z" fill="#0f172a" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
