import { cn } from "@/lib/utils";

const BADGES = {
  submitted: { className: "bg-indigo-50 text-cta", text: "🕒 Entregada — en revisión" },
  late: { className: "bg-red-50 text-red-700", text: "⚠ Entregada con retraso" },
  graded: { className: "bg-green-100 text-green-700", text: "✓ Calificada" },
  returned: { className: "bg-amber-100 text-amber-800", text: "↺ Devuelta para corrección" },
} as const;

/** Insignia de estado de la entrega (mismos textos que la vista del alumno). */
export function MiniSubmissionBadge({ kind }: { kind: keyof typeof BADGES }) {
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-[9.5px] font-extrabold", BADGES[kind].className)}>{BADGES[kind].text}</span>;
}

/** Archivo como chip: extensión y nombre. */
export function MiniFileChip({ name, tone = "ok" }: { name: string; tone?: "ok" | "bad" }) {
  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[10px] font-semibold",
        tone === "bad" && "border-red-200 bg-red-50 text-red-700"
      )}
    >
      <span className="rounded bg-red-50 px-1 text-[8px] font-extrabold text-red-600">{ext}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Zona para arrastrar archivos con la línea de tipos aceptados. */
export function MiniDropzone({ hint, active = false }: { hint: string; active?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed px-3 py-2.5 text-center transition-colors duration-300",
        active ? "border-cta bg-indigo-50/60" : "border-slate-300 bg-slate-50"
      )}
    >
      <span className="text-[15px]" aria-hidden>
        ⤒
      </span>
      <p className="text-[10.5px] font-semibold text-slate-700">Arrastra tus archivos aquí</p>
      <p className="text-[9px] text-slate-500">{hint}</p>
    </div>
  );
}

/** Aviso en caja (ámbar o rojo), como los de la entrega. */
export function MiniNotice({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[9.5px] leading-snug",
        tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"
      )}
    >
      <span aria-hidden>⚠</span>
      <span>{children}</span>
    </p>
  );
}
