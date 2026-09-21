import { cn } from "@/lib/utils";

/** Patrón fijo de «código QR» (7 × 7) para los diplomas de las escenas. */
const QR_ROWS = ["1110111", "1010101", "1110111", "0001000", "1101011", "0101101", "1110110"];

export function MiniQr({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 7 7" className={className} shapeRendering="crispEdges" aria-hidden>
      {QR_ROWS.flatMap((row, y) =>
        [...row].map((cell, x) => (cell === "1" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0f172a" /> : null))
      )}
    </svg>
  );
}

const fade = (on: boolean | undefined) => (on === false ? "opacity-0" : "opacity-100");

/**
 * Diploma en miniatura.
 * - `validityLine`: texto; `null` = oculto conservando el espacio (vitalicio); sin prop = no hay renglón.
 * - `reveal`: armado por partes (nombre, folio y QR aparecen); con él se muestra el QR.
 */
export function MiniCertificate({
  name,
  course,
  validityLine,
  folio,
  reveal,
  className,
}: {
  name: string;
  course: string;
  validityLine?: string | null;
  folio: string;
  reveal?: { name: boolean; folio: boolean; qr: boolean };
  className?: string;
}) {
  return (
    <div className={cn("w-[150px] rounded-md border-2 border-brand-deep bg-[#fffdf7] px-2 py-2 text-center", className)}>
      <div className="text-[7.5px] tracking-[0.2em] text-amber-700">CONSTANCIA</div>
      <div className={cn("mt-1.5 font-serif text-[12px] font-bold transition-opacity duration-500", fade(reveal?.name))}>{name}</div>
      <div className="mt-0.5 text-[8.5px] text-slate-500">{course}</div>
      {validityLine !== undefined && (
        <div
          className={cn(
            "mt-1.5 min-h-[22px] text-[8.5px] leading-tight text-slate-600 transition-opacity duration-300",
            validityLine === null && "opacity-0"
          )}
        >
          {validityLine ?? "—"}
        </div>
      )}
      {reveal ? (
        <div className="mt-1.5 flex items-end justify-between gap-1 text-left">
          <span className={cn("text-[7px] text-slate-400 transition-opacity duration-500", fade(reveal.folio))}>Folio {folio}</span>
          <MiniQr className={cn("size-7 shrink-0 transition-opacity duration-500", fade(reveal.qr))} />
        </div>
      ) : (
        <div className="mt-1 text-[7px] text-slate-400">Folio {folio}</div>
      )}
    </div>
  );
}

/** Línea de tiempo: aprobación, vencimiento (si hay) y la marca «hoy». */
export function MiniTimeline({
  issuedLabel,
  expiryLabel,
  expiryPos,
  todayPos,
  className,
}: {
  issuedLabel: string;
  expiryLabel: string | null;
  expiryPos: number | null;
  todayPos: number;
  className?: string;
}) {
  const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;
  return (
    <div className={cn("relative h-9", className)}>
      <div className="absolute inset-x-0 top-[13px] h-1 rounded bg-slate-200" />
      {expiryPos !== null && (
        <div className="absolute top-[13px] h-1 rounded bg-emerald-300" style={{ left: "10%", width: pct(expiryPos - 0.1) }} />
      )}
      <span className="absolute top-[10px] size-2.5 -translate-x-1/2 rounded-full bg-green-600" style={{ left: "10%" }} />
      <span className="absolute left-0 top-[22px] whitespace-nowrap text-[8.5px] text-slate-500">{issuedLabel}</span>
      {expiryPos !== null && expiryLabel && (
        <>
          <span className="absolute top-[10px] size-2.5 -translate-x-1/2 rounded-full bg-slate-600" style={{ left: pct(expiryPos) }} />
          <span className="absolute top-[22px] -translate-x-1/2 whitespace-nowrap text-[8.5px] text-slate-500" style={{ left: pct(expiryPos) }}>
            {expiryLabel}
          </span>
        </>
      )}
      <span className="absolute top-0 h-[26px] w-0.5 bg-cta transition-[left] duration-100 ease-linear" style={{ left: pct(todayPos) }}>
        <span className="absolute -left-2 -top-3 text-[8.5px] font-extrabold text-cta">hoy</span>
      </span>
    </div>
  );
}

/** Celular en miniatura para mostrar lo que ve quien escanea el QR. */
export function MiniPhone({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative h-[170px] w-[92px] rounded-[16px] border-[3px] border-slate-800 bg-slate-800 p-0.5 shadow-lg", className)}>
      <div className="relative size-full overflow-hidden rounded-[12px] bg-white">{children}</div>
      <span className="absolute left-1/2 top-1 h-1 w-6 -translate-x-1/2 rounded-full bg-slate-700" />
    </div>
  );
}
