"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ICON_SIZE_RANGE, TEXT_SIZE_RANGE, elementView, normalizeRotation } from "@/lib/image-layout";
import { round4, type ImageElement } from "@/lib/image-questions";
import { cn } from "@/lib/utils";

/**
 * Panel «Seleccionado» del editor de «arrastrar a la imagen»: tamaño y giro
 * del elemento elegido en la lista o por uno de sus lugares. Son del elemento
 * (no del lugar): cambian todos sus lugares y la sombra que ve el alumno, así
 * ninguna sombra delata cuál va dónde. Sin nada elegido, los controles se ven
 * apagados con una indicación (el panel no cambia de alto al elegir).
 */

type Range = readonly [number, number];

/** Pasos del deslizante de tamaño. Va en escala logarítmica: cada paso crece lo mismo en proporción. */
const SIZE_STEPS = 200;
const toStep = (size: number, [min, max]: Range) => Math.round((Math.log(size / min) / Math.log(max / min)) * SIZE_STEPS);
const fromStep = (step: number, [min, max]: Range) => round4(min * (max / min) ** (step / SIZE_STEPS));
/** Fracción del ancho → porcentaje con un decimal (0.0571 → 5.7). */
const toPercent = (size: number) => Math.round(size * 1000) / 10;
const clamp = (n: number, [min, max]: Range) => Math.min(max, Math.max(min, n));

export function ElementPanel({
  element,
  name,
  onChange,
}: {
  /** El elemento elegido, o null si no hay nada elegido. */
  element: ImageElement | null;
  /** Su nombre («Ícono 2» o el texto de la etiqueta). */
  name: string;
  onChange: (patch: Pick<ImageElement, "size" | "rotation">) => void;
}) {
  const headingId = useId();
  const view = element ? elementView(element) : null;
  const range: Range = element?.kind === "text" ? TEXT_SIZE_RANGE : ICON_SIZE_RANGE;
  const pct: Range = [toPercent(range[0]), toPercent(range[1])];
  const off = !view;
  return (
    <section aria-labelledby={headingId} className="space-y-2.5 rounded-xl border bg-muted/30 p-2.5">
      <p id={headingId} className="flex min-w-0 items-baseline gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className="shrink-0">Seleccionado</span>
        {element && <span className="truncate text-xs normal-case tracking-normal text-foreground">· {name}</span>}
      </p>
      {/* Con key: al elegir otro elemento, lo que se estaba escribiendo no pasa al nuevo */}
      <div key={element?.id ?? "nada"} className="space-y-2.5">
        <Control
          label="Tamaño"
          unit="%"
          unitLabel="% del ancho de la foto"
          disabled={off}
          value={view ? toPercent(view.size) : null}
          fieldRange={pct}
          fix={(n) => clamp(n, pct)}
          onValue={(n) => onChange({ size: round4(clamp(n, pct) / 100) })}
          slider={{
            min: 0,
            max: SIZE_STEPS,
            value: view ? clamp(toStep(view.size, range), [0, SIZE_STEPS]) : 0,
            onChange: (step) => onChange({ size: fromStep(step, range) }),
            valueText: view ? `${toPercent(view.size)} % del ancho de la foto` : undefined,
          }}
        />
        <Control
          label="Giro"
          unit="°"
          unitLabel="grados"
          disabled={off}
          value={view ? Math.round(view.rotation) : null}
          fieldRange={[-180, 180]}
          // Fuera de ±180 se lleva a su equivalente (270 → −90)
          fix={(n) => Math.round(normalizeRotation(n))}
          onValue={(n) => onChange({ rotation: Math.round(n) })}
          slider={{
            min: -180,
            max: 180,
            value: view ? Math.round(view.rotation) : 0,
            onChange: (deg) => onChange({ rotation: deg }),
            valueText: view ? `${Math.round(view.rotation)} grados` : undefined,
          }}
          extra={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!view || Math.round(view.rotation) === 0}
              aria-label="Quitar el giro"
              title="Quitar el giro"
              onClick={() => onChange({ rotation: 0 })}
            >
              0°
            </Button>
          }
        />
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        {element
          ? "Es del elemento: todos sus lugares y la sombra que ve el alumno cambian juntos."
          : "Elige un lugar en la foto o un elemento de la lista para cambiar su tamaño y su giro."}
      </p>
    </section>
  );
}

/** Una propiedad: nombre, campo numérico con su unidad y, debajo, el deslizante. */
function Control({
  label,
  unit,
  unitLabel,
  disabled,
  value,
  fieldRange,
  fix,
  onValue,
  slider,
  extra,
}: {
  label: string;
  unit: string;
  /** La unidad dicha en voz alta. */
  unitLabel: string;
  disabled: boolean;
  /** Lo que muestra el campo (null: nada elegido). */
  value: number | null;
  /** Lo que se aplica mientras se escribe; fuera de esto, se espera a salir del campo. */
  fieldRange: Range;
  /** Al salir del campo (o con Enter): un número cualquiera → uno válido. */
  fix: (n: number) => number;
  onValue: (n: number) => void;
  slider: { min: number; max: number; value: number; onChange: (n: number) => void; valueText?: string };
  extra?: React.ReactNode;
}) {
  const sliderId = useId();
  /** Lo que se escribe, mientras el campo tiene el foco; null: se muestra el valor. */
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (text: string) => (text.trim() === "" ? NaN : Number(text.replace(",", ".")));
  const settle = () => {
    const n = draft === null ? NaN : parse(draft);
    if (Number.isFinite(n)) onValue(fix(n));
    setDraft(null);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={sliderId} className={cn("flex-1 text-xs font-medium", disabled && "text-muted-foreground")}>
          {label}
        </label>
        {extra}
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min={fieldRange[0]}
          max={fieldRange[1]}
          disabled={disabled}
          aria-label={`${label} en ${unitLabel}`}
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
            }
          }}
          // Sin las flechitas del navegador: tapaban el número (las flechas del teclado siguen)
          className="h-7 w-14 px-1.5 text-right text-xs tabular-nums [appearance:textfield] md:text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
        onChange={(e) => slider.onChange(Number(e.target.value))}
        className="block h-4 w-full cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
      />
    </div>
  );
}
