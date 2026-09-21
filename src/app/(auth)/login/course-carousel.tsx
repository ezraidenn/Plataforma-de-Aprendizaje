"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CourseCover } from "@/components/course-cover";

export type CarouselCourse = {
  id: string;
  title: string;
  coverFileId: string | null;
  itemCount: number;
};

const AUTOPLAY_MS = 5000;

/**
 * Carrusel de cursos disponibles para el panel del login: tarjeta sólida (se
 * lee sobre cualquier foto de portada), flechas a los lados y puntos. Gira
 * solo cada 5 s, se pausa con el cursor o el foco dentro y respeta
 * prefers-reduced-motion. Usar las flechas reinicia el giro automático.
 */
export function CourseCarousel({ courses }: { courses: CarouselCourse[] }) {
  const [index, setIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const n = courses.length;

  const goTo = (target: number, dir: 1 | -1) => {
    if (n <= 1) return;
    const next = ((target % n) + n) % n;
    if (next === index) return;
    setPrevIndex(index);
    setDirection(dir);
    setIndex(next);
  };

  // setTimeout por índice: cualquier cambio (automático o manual) reinicia la espera
  useEffect(() => {
    if (n <= 1 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => {
      setPrevIndex(index);
      setDirection(1);
      setIndex((index + 1) % n);
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [index, n, paused]);

  if (n === 0) return null;
  const current = courses[index] ?? courses[0];

  return (
    <div
      className="w-full max-w-lg"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") goTo(index - 1, -1);
        else if (e.key === "ArrowRight") goTo(index + 1, 1);
      }}
      role="region"
      aria-roledescription="carrusel"
      aria-label="Cursos disponibles"
    >
      <p className="text-halo mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-100">
        Cursos disponibles
      </p>

      <div className="group relative">
        {/* Tarjeta sólida (sin vidrio): azul noche + sombra profunda */}
        <div className="relative h-32 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#1e1b4b_100%)] shadow-[0_22px_45px_-14px_rgb(0_0_0/0.8),0_4px_12px_-4px_rgb(0_0_0/0.5)] ring-1 ring-white/15">
          {courses.map((c, i) => {
            const active = i === index;
            const leaving = i === prevIndex && !active;
            return (
              <div
                key={c.id}
                aria-hidden={!active}
                className={cn(
                  "absolute inset-0 flex items-center gap-4 py-4 pl-8 pr-9 transition-all duration-500 ease-out",
                  active
                    ? "translate-x-0 opacity-100"
                    : leaving
                      ? direction > 0
                        ? "-translate-x-10 opacity-0"
                        : "translate-x-10 opacity-0"
                      : direction > 0
                        ? "translate-x-10 opacity-0"
                        : "-translate-x-10 opacity-0"
                )}
              >
                <span className="size-24 shrink-0 overflow-hidden rounded-xl shadow-md ring-1 ring-white/10">
                  <CourseCover courseId={c.id} coverFileId={c.coverFileId} title={c.title} iconClassName="size-8" />
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-lg font-semibold leading-snug text-white">
                    {c.title}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-300">
                    <BookOpen className="size-4" aria-hidden />
                    {c.itemCount} {c.itemCount === 1 ? "lección" : "lecciones"}
                  </span>
                </span>
              </div>
            );
          })}
          <span className="sr-only" aria-live="polite">
            {current.title}
          </span>
        </div>

        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1, -1)}
              aria-label="Curso anterior"
              className="absolute left-0 top-1/2 -translate-x-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/55 text-white/90 opacity-60 shadow-[0_4px_10px_-4px_rgb(0_0_0/0.6)] ring-1 ring-white/20 backdrop-blur-sm transition-[opacity,background-color] duration-200 group-hover:opacity-100 hover:bg-slate-950/80 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1, 1)}
              aria-label="Curso siguiente"
              className="absolute right-0 top-1/2 translate-x-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/55 text-white/90 opacity-60 shadow-[0_4px_10px_-4px_rgb(0_0_0/0.6)] ring-1 ring-white/20 backdrop-blur-sm transition-[opacity,background-color] duration-200 group-hover:opacity-100 hover:bg-slate-950/80 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </>
        )}
      </div>

      {n > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2" role="tablist" aria-label="Ir al curso">
          {courses.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={c.title}
              onClick={() => goTo(i, i > index ? 1 : -1)}
              className={cn(
                "h-2 rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.6)] transition-all duration-300",
                i === index ? "w-7 bg-cyan-300" : "w-2 bg-white/55 hover:bg-white/85"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
