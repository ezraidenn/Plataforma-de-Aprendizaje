import { cn } from "@/lib/utils";

/** Marco de 220 px donde corre una escena. Decorativo: el sentido va en la frase. */
export function SceneFrame({ topic, className, children }: { topic: string; className?: string; children: React.ReactNode }) {
  return (
    <div data-scene={topic} aria-hidden className={cn("relative h-[220px] overflow-hidden rounded-xl border bg-slate-50 text-slate-900", className)}>
      {children}
    </div>
  );
}

/** Mientras se descarga la escena (solo en la primera apertura). */
export function SceneSkeleton() {
  return <div className="absolute inset-3 animate-pulse rounded-lg bg-slate-200/60" />;
}
