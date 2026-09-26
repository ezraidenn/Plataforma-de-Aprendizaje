"use client";

import { Suspense, useEffect, useId, useRef, useState, type ComponentType } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Caption } from "./caption";
import { SCENES } from "./registry";
import { SceneFrame, SceneSkeleton } from "./scene-frame";
import { HELP_TOPICS, type HelpTopicId, type HelpValues } from "./topics";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 200;
/** A partir de este ancho la tarjeta sale a un lado; debajo, sale abajo y se ajusta al ancho. */
const WIDE_QUERY = "(min-width: 768px)";

/**
 * «?» junto a un ajuste. Abre una tarjeta con la escena animada que muestra
 * qué mueve el ajuste usando su valor actual (aunque no esté guardado).
 * - Ratón: abre 150 ms después de entrar; cierra 200 ms después de salir del
 *   «?» o de la tarjeta. Un clic la deja fija.
 * - Toque / teclado (Enter o Espacio): abre y cierra.
 * - Esc o clic fuera: cierra. Al abrir no se mueve el foco (se puede seguir
 *   escribiendo el valor y la escena se reinicia con él).
 */
export function HelpTip<K extends HelpTopicId>({
  topic,
  value,
  className,
}: {
  topic: K;
  /** Valor actual del ajuste; si falta se usa el de ejemplo */
  value?: HelpValues[K];
  className?: string;
}) {
  const def = HELP_TOPICS[topic];
  const current = value ?? def.example;
  const Scene = SCENES[topic] as unknown as ComponentType<{ value: HelpValues[K] }>;
  const caption = (def.caption as (v: HelpValues[K]) => string)(current);

  const wide = useMediaQuery(WIDE_QUERY, true);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const captionId = useId();
  const contentId = useId();

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    const t = timer;
    return () => {
      if (t.current !== null) window.clearTimeout(t.current);
    };
  }, []);

  /** Solo el ratón abre y cierra por hover; en táctil manda el toque. */
  const hover = (e: React.PointerEvent, next: boolean) => {
    if (e.pointerType !== "mouse") return;
    clearTimer();
    if (!next && pinned.current) return;
    timer.current = window.setTimeout(() => setOpen(next), next ? OPEN_DELAY_MS : CLOSE_DELAY_MS);
  };

  const onClick = () => {
    clearTimer();
    if (open && !pinned.current) {
      pinned.current = true; // se abrió por hover: el clic la fija
      return;
    }
    pinned.current = !open;
    setOpen(!open);
  };

  const onOpenChange = (next: boolean) => {
    clearTimer();
    if (!next) pinned.current = false;
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Cómo funciona: ${def.label}`}
          aria-describedby={captionId}
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onPointerEnter={(e) => hover(e, true)}
          onPointerLeave={(e) => hover(e, false)}
          onClick={onClick}
          className={cn(
            "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-cta/10 text-[11px] font-extrabold leading-none text-cta transition-colors duration-150 hover:bg-cta hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta",
            open && "bg-cta text-white",
            className
          )}
        >
          ?
        </button>
      </PopoverAnchor>
      <span id={captionId} className="sr-only">
        {caption.split("**").join("")}
      </span>
      <PopoverContent
        id={contentId}
        side={wide ? "right" : "bottom"}
        align={wide ? "start" : "center"}
        sideOffset={10}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (buttonRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        onPointerEnter={(e) => hover(e, true)}
        onPointerLeave={(e) => hover(e, false)}
        className="w-[min(340px,calc(100vw-24px))] gap-0 rounded-2xl p-3 shadow-[0_18px_40px_-12px_rgb(15_23_42/0.35),0_4px_10px_-4px_rgb(15_23_42/0.12)]"
      >
        <div className="mb-2 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-[0.12em] text-cta">
          <span>{def.kicker}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 tracking-normal text-muted-foreground">▶ en bucle</span>
        </div>
        <SceneFrame topic={topic}>
          <Suspense fallback={<SceneSkeleton />}>
            <Scene key={JSON.stringify(current)} value={current} />
          </Suspense>
        </SceneFrame>
        <Caption text={caption} className="mt-2.5 px-0.5 text-[12.5px] leading-snug text-slate-700" />
      </PopoverContent>
    </Popover>
  );
}
