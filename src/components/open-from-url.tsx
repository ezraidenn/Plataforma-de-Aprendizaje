"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Avisa una sola vez cuando la URL trae `?<param>=1`. Sirve para llegar desde
 * OTRA página con el diálogo (o el menú) ya abierto: los botones de la guía de
 * primeros pasos lo usan. Dentro de la misma página no se navega: se avisa con
 * `requestOpenDialog` (ver `src/lib/open-dialog.ts`).
 *
 * `onOpen` vive en una ref: cambiar su identidad entre renders nunca vuelve a
 * disparar la apertura.
 */
function Reader({ param, onOpen }: { param: string; onOpen: () => void }) {
  const fromUrl = useSearchParams().get(param) === "1";
  const handler = useRef(onOpen);
  handler.current = onOpen;
  const fired = useRef(false);
  useEffect(() => {
    // Una sola apertura por visita con el parámetro puesto
    if (!fromUrl) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    fired.current = true;
    handler.current();
  }, [fromUrl]);
  return null;
}

/** `useSearchParams` obliga a una frontera de suspensión: va incluida aquí. */
export function OpenFromUrl({ param, onOpen }: { param: string; onOpen: () => void }) {
  return (
    <Suspense fallback={null}>
      <Reader param={param} onOpen={onOpen} />
    </Suspense>
  );
}
