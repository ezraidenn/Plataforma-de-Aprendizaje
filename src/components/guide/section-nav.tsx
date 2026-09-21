"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { GuideSection } from "@/content/guide/types";

/**
 * Navegador de secciones siempre visible:
 * - Escritorio: columna lateral sticky con la sección activa resaltada.
 * - Celular: tira de chips deslizable pegada bajo la barra superior (44 px,
 *   en flujo: no tapa contenido). El chip activo se centra solo.
 * La sección activa se detecta por posición de scroll (la última cuyo inicio
 * ya pasó el tercio superior de la ventana).
 */
export function SectionNav({ sections, prefix }: { sections: GuideSection[]; prefix: string }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.33;
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = s.id;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections]);

  // Centrar el chip activo en móvil
  useEffect(() => {
    const el = chipsRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    // Compensa la barra superior (56 px) y la tira móvil (44 px)
    const offset = window.innerWidth < 1024 ? 56 + 44 + 8 : 56 + 12;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <>
      {/* Móvil / tablet: tira de chips sticky bajo la barra de sección */}
      <div
        ref={chipsRef}
        className="sticky top-14 z-20 -mx-4 flex h-11 items-center gap-1.5 overflow-x-auto border-b bg-background/85 px-4 backdrop-blur [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
        role="navigation"
        aria-label="Secciones de la guía"
      >
        {sections.map((s, i) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-id={s.id}
            data-section={s.section}
            onClick={go(s.id)}
            aria-current={active === s.id ? "true" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors",
              active === s.id
                ? "border-transparent bg-section text-white"
                : "border-border bg-card text-muted-foreground"
            )}
          >
            <span className="tabular-nums">{i + 1}</span>
            <span className="max-w-[9rem] truncate">{s.title}</span>
          </a>
        ))}
      </div>

      {/* Escritorio: columna lateral sticky */}
      <nav
        aria-label="Secciones de la guía"
        className="sticky top-[4.5rem] hidden max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border bg-card p-2 shadow-[0_1px_2px_rgb(15_23_42/0.05)] lg:block"
      >
        <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {prefix}
        </p>
        <ul className="space-y-0.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                data-section={s.section}
                onClick={go(s.id)}
                aria-current={active === s.id ? "true" : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active === s.id
                    ? "bg-section-soft text-section-strong"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-section transition-opacity",
                    active === s.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
                    active === s.id ? "bg-section text-white" : "bg-secondary"
                  )}
                >
                  {i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
