"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { SceneFrame, SceneSkeleton } from "@/components/help/scene-frame";
import { SceneClockPaused } from "@/components/help/use-scene-clock";
import { GUIDE_SCENES } from "./scenes/registry";

/**
 * Escena animada de un paso de la guía. Se descarga y se monta cuando su marco
 * entra en pantalla por primera vez; después se queda montada y su reloj se
 * pausa mientras no se ve. Así la animación corre solo a la vista, sin
 * volver a descargarse ni reiniciarse cada vez que pasas por el paso.
 */
export function GuideScene({ id, title }: { id: string; title: string }) {
  const Scene = GUIDE_SCENES[id];
  // El marco es un <figure>: HTMLElement, no HTMLDivElement
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting) setMounted(true);
      },
      { rootMargin: "150px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!Scene) return null;
  return (
    <figure ref={ref} className="mt-3 max-w-[520px]">
      <SceneFrame topic={id}>
        {mounted ? (
          <Suspense fallback={<SceneSkeleton />}>
            <SceneClockPaused.Provider value={!visible}>
              <Scene />
            </SceneClockPaused.Provider>
          </Suspense>
        ) : (
          <SceneSkeleton />
        )}
      </SceneFrame>
      <figcaption className="mt-1.5 text-[11.5px] text-muted-foreground">
        Animación · {title}
      </figcaption>
    </figure>
  );
}
