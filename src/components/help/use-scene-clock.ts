"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cyclePhase, FINAL_PHASE } from "./scene-clock";

/** Preferencia del sistema «reducir movimiento» (false en el servidor). */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * Pausa el reloj de las escenas que estén debajo. Lo usa la guía para detener
 * una escena que salió de la vista sin desmontarla (así no se vuelve a
 * descargar ni parpadea al regresar). En el «?» nadie lo provee: no pausa.
 */
export const SceneClockPaused = createContext(false);

/**
 * Fase (0 → 1) del ciclo de una escena, actualizada ~10 veces por segundo
 * mientras está montada y no esté en pausa. Empieza en 0 cada vez que la
 * escena se monta (al abrir el tooltip o al cambiar el valor) y, tras una
 * pausa, continúa donde iba. Con «reducir movimiento» devuelve la fase final:
 * el resultado, sin animar.
 */
export function useSceneClock(cycleMs: number): number {
  const reduced = useReducedMotion();
  const paused = useContext(SceneClockPaused);
  const [phase, setPhase] = useState(0);
  // La fase actual sobrevive a la pausa para retomar el ciclo donde iba
  const phaseRef = useRef(0);
  phaseRef.current = phase;

  useEffect(() => {
    if (reduced || paused) return;
    const start = performance.now() - phaseRef.current * cycleMs;
    const id = window.setInterval(
      () => setPhase(cyclePhase(performance.now() - start, cycleMs)),
      100
    );
    return () => window.clearInterval(id);
  }, [cycleMs, reduced, paused]);

  return reduced ? FINAL_PHASE : phase;
}
