"use client";

import { memo, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_ICON_PX, MIN_TEXT_PX, elementView, iconSizeRange, shownAtMinimum } from "@/lib/image-layout";
import { TEXT_SIZE_RANGE, clamp, normalizeRotation, round4, type ImageElement } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Panel «Seleccionado» del editor de «arrastrar a la imagen»: tamaño y giro
 * del elemento elegido en la lista o por uno de sus lugares. Son del elemento
 * (no del lugar): cambian todos sus lugares y la sombra que ve el alumno, así
 * ninguna sombra delata cuál va dónde. Sin nada elegido (o con lugares de
 * varios elementos), los controles se ven apagados con una indicación (el
 * panel no cambia de alto al elegir). Cambiar algo aquí nunca coloca nada en
 * la foto. Para deshacer, arrastrar un deslizante es un solo paso (`onBegin`
 * al tomarlo, `onCommit` al soltarlo) y lo escrito en un campo también
 * (`onCommit` al salir de él o con Enter).
 */

type Range = readonly [number, number];

/** Pasos del deslizante de tamaño. Va en escala logarítmica: cada paso crece lo mismo en proporción. */
const SIZE_STEPS = 200;
const toStep = (size: number, [min, max]: Range) => Math.round((Math.log(size / min) / Math.log(max / min)) * SIZE_STEPS);
const fromStep = (step: number, [min, max]: Range) => round4(min * (max / min) ** (step / SIZE_STEPS));
/** Fracción del ancho → porcentaje con un decimal (0.0571 → 5.7). */
const toPercent = (size: number) => Math.round(size * 1000) / 10;

export const ElementPanel = memo(function ElementPanel({
  element,
  name,
  several,
  aspect,
  fitWidth,
  onChange,
  onBegin,
  onCommit,
}: {
  /** El elemento elegido, o null si no hay nada elegido. */
  element: ImageElement | null;
  /** Su nombre («Ícono 2» o el texto de la etiqueta). */
  name: string;
  /** Sin `element`: cuántos lugares hay seleccionados de varios elementos (tamaño y giro no aplican). */
  several?: number;
  /** Alto / ancho de la foto: acota el tamaño de los íconos para que quepan en ella. */
  aspect: number;
  /** Ancho de la foto del editor al 100 % (px): para avisar si se ve al mínimo (no cambia con el zoom). */
  fitWidth: number;
  onChange: (patch: Pick<ImageElement, "size" | "rotation">) => void;
  /** Se tomó un deslizante: hasta soltarlo, un solo paso del historial. */
  onBegin: () => void;
  /** Se soltó el deslizante, o se salió del campo: lo siguiente ya es otro paso. */
  onCommit: () => void;
}) {
  const headingId = useId();
  const view = element ? elementView(element) : null;
  const icon = element?.kind !== "text";
  const range: Range = icon ? iconSizeRange(aspect) : TEXT_SIZE_RANGE;
  const pct: Range = [toPercent(range[0]), toPercent(range[1])];
  // El giro tal como se guardó (−180 no salta a 180 mientras se arrastra); si no, normalizado
  const raw = element?.rotation;
  const rotation = view ? Math.round(typeof raw === "number" && raw >= -180 && raw <= 180 ? raw : view.rotation) : 0;
  const atMinimum = !!view && shownAtMinimum(view.kind, view.size, fitWidth);
  const off = !view;
  return (
    <section aria-labelledby={headingId} className="space-y-2.5 rounded-xl border bg-muted/30 p-2.5">
      <p id={headingId} className="flex min-w-0 items-baseline gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className="shrink-0">Seleccionado</span>
        {element ? (
          <span className="truncate text-xs normal-case tracking-normal text-foreground">· {name}</span>
        ) : several ? (
          // Sin cortar: en la columna angosta pasa a otra línea
          <span className="min-w-0 text-xs normal-case tracking-normal text-foreground">
            · {several} lugares de varios elementos
          </span>
        ) : null}
      </p>
      {/* Con key: al elegir otro elemento, lo que se estaba escribiendo no pasa al nuevo */}
      <div key={element?.id ?? "nada"} className="space-y-2.5">
        <Control
          label="Tamaño"
          // Un ícono se mide por su lado mayor: así un tamaño se ve igual con cualquier forma
          detail={view ? (icon ? "lado mayor" : "letra") : undefined}
          unit="%"
          unitLabel="% del ancho de la foto"
          disabled={off}
          value={view ? toPercent(view.size) : null}
          step={0.5}
          fieldRange={pct}
          fix={(n) => clamp(n, ...pct)}
          onValue={(n) => onChange({ size: round4(clamp(n, ...pct) / 100) })}
          onBegin={onBegin}
          onCommit={onCommit}
          slider={{
            min: 0,
            max: SIZE_STEPS,
            value: view ? clamp(toStep(view.size, range), 0, SIZE_STEPS) : 0,
            onChange: (step) => onChange({ size: fromStep(step, range) }),
            valueText: view
              ? `${icon ? "Lado mayor: " : ""}${toPercent(view.size)} % del ancho de la foto`
              : undefined,
          }}
          note={
            atMinimum &&
            `En esta pantalla se ve al mínimo legible (${view.kind === "icon" ? `${MIN_ICON_PX} px` : `letra de ${MIN_TEXT_PX} px`}).`
          }
        />
        <Control
          label="Giro"
          unit="°"
          unitLabel="grados"
          disabled={off}
          value={view ? rotation : null}
          step={1}
          fieldRange={[-180, 180]}
          // Fuera de ±180 se lleva a su equivalente (270 → −90)
          fix={(n) => Math.round(n >= -180 && n <= 180 ? n : normalizeRotation(n))}
          onValue={(n) => onChange({ rotation: Math.round(n) })}
          onBegin={onBegin}
          onCommit={onCommit}
          slider={{
            min: -180,
            max: 180,
            value: rotation,
            onChange: (deg) => onChange({ rotation: deg }),
            valueText: view ? `${rotation} grados` : undefined,
          }}
          extra={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!view || rotation === 0}
              aria-label="0° (quitar el giro)"
              title="Quitar el giro"
              onClick={() => {
                onChange({ rotation: 0 });
                onCommit();
              }}
            >
              0°
            </Button>
          }
        />
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        {element
          ? "Es del elemento: todos sus lugares y la sombra que ve el alumno cambian juntos."
          : several
            ? "El tamaño y el giro son de cada elemento: selecciona lugares de uno solo (o elígelo en la lista) para cambiarlos."
            : "Elige un lugar en la foto o un elemento de la lista para cambiar su tamaño y su giro."}
      </p>
    </section>
  );
});

/**
 * Una propiedad: nombre, campo numérico con su unidad y, debajo, el
 * deslizante. El campo es de texto (acepta coma decimal); las flechas del
 * teclado suben y bajan `step` (con Mayús, diez veces); Esc deshace lo escrito.
 */
function Control({
  label,
  detail,
  unit,
  unitLabel,
  disabled,
  value,
  step,
  fieldRange,
  fix,
  onValue,
  onBegin,
  onCommit,
  slider,
  extra,
  note,
}: {
  label: string;
  /** Qué mide, junto al nombre y más tenue («lado mayor»). */
  detail?: string;
  unit: string;
  /** La unidad dicha en voz alta. */
  unitLabel: string;
  disabled: boolean;
  /** Lo que muestra el campo (null: nada elegido). */
  value: number | null;
  step: number;
  /** Lo que se aplica mientras se escribe; fuera de esto, se espera a salir del campo. */
  fieldRange: Range;
  /** Al salir del campo (o con Enter): un número cualquiera → uno válido. */
  fix: (n: number) => number;
  onValue: (n: number) => void;
  onBegin: () => void;
  onCommit: () => void;
  slider: { min: number; max: number; value: number; onChange: (n: number) => void; valueText?: string };
  extra?: React.ReactNode;
  /** Una aclaración bajo el deslizante (false: ninguna). */
  note?: string | false;
}) {
  const sliderId = useId();
  const noteId = useId();
  /** Lo que se escribe, mientras el campo tiene el foco; null: se muestra el valor. */
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (text: string) => (text.trim() === "" ? NaN : Number(text.trim().replace(",", ".")));
  const settle = () => {
    const n = draft === null ? NaN : parse(draft);
    if (Number.isFinite(n)) onValue(fix(n));
    setDraft(null);
    onCommit();
  };
  // El gesto termina al soltar el puntero, aunque sea fuera del deslizante
  const grab = () => {
    onBegin();
    const release = () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      onCommit();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={sliderId} className={cn("flex-1 text-xs font-medium", disabled && "text-muted-foreground")}>
          {label}
          {detail && <span className="font-normal text-muted-foreground"> ({detail})</span>}
        </label>
        {extra}
        <Input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          aria-label={`${label}${detail ? ` (${detail})` : ""} en ${unitLabel}`}
          value={draft ?? (value === null ? "" : String(value))}
          placeholder="–"
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parse(e.target.value);
            if (Number.isFinite(n) && n >= fieldRange[0] && n <= fieldRange[1]) onValue(n);
          }}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              settle();
            } else if (e.key === "Escape") {
              // Solo deshace lo escrito: la selección sigue
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value !== null) {
              e.preventDefault();
              const typed = draft === null ? NaN : parse(draft);
              const base = Number.isFinite(typed) ? typed : value;
              const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              onValue(fix(Math.round((base + delta) * 10) / 10));
              setDraft(null);
            }
          }}
          className="h-7 w-14 px-1.5 text-right text-xs tabular-nums md:text-xs"
        />
        <span aria-hidden className="w-3 text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
      <input
        id={sliderId}
        type="range"
        min={slider.min}
        max={slider.max}
        step={1}
        value={slider.value}
        disabled={disabled}
        aria-valuetext={slider.valueText}
        aria-describedby={note ? noteId : undefined}
        onPointerDown={grab}
        // Con el teclado, sus pasos seguidos se juntan hasta salir de él
        onBlur={onCommit}
        onChange={(e) => slider.onChange(Number(e.target.value))}
        className="block h-4 w-full cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
      />
      {note && (
        <p id={noteId} className="text-[11px] leading-snug text-amber-700 dark:text-warning">
          {note}
        </p>
      )}
    </div>
  );
}
