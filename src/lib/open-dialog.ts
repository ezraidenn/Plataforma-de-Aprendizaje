"use client";

import { useEffect, useRef } from "react";

/**
 * Bus mínimo para abrir un diálogo que ya está montado en ESTA pantalla.
 *
 * Por qué existe: los botones de la guía de primeros pasos apuntaban a la misma
 * ruta con otro parámetro (`/teach/dashboard?nuevo=1`). El enrutador de Next
 * descarta esa navegación blanda —misma ruta, solo cambia la búsqueda— y el
 * clic no hacía nada. Cuando el destino es la página actual no hace falta
 * navegar: basta avisar al diálogo con un evento del navegador.
 *
 * `?nuevo=1` y compañía siguen sirviendo para llegar desde OTRA página.
 */
export const OPEN_DIALOG_EVENT = "lms:open-dialog";

export type OpenDialogName = "new-course" | "new-student" | "enroll" | "add-item";

export function requestOpenDialog(name: OpenDialogName) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_DIALOG_EVENT, { detail: name }));
}

/** Escucha las peticiones de apertura dirigidas a `name`. */
export function useOpenDialogRequest(name: OpenDialogName, onOpen: () => void) {
  // En una ref para no volver a suscribirse en cada render del diálogo
  const handler = useRef(onOpen);
  handler.current = onOpen;
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<OpenDialogName>).detail === name) handler.current();
    };
    window.addEventListener(OPEN_DIALOG_EVENT, listener);
    return () => window.removeEventListener(OPEN_DIALOG_EVENT, listener);
  }, [name]);
}

/**
 * Quita `name` de la URL al cerrar, para que recargar no vuelva a abrir lo
 * mismo. No hace nada si el parámetro ya no estaba: así no deshace una
 * navegación ajena.
 *
 * Usa `history.replaceState` (que Next integra con su enrutador) en lugar de
 * `router.replace`: la navegación blanda que solo cambia la búsqueda de la
 * misma ruta es justo la que el enrutador descarta. Además evita volver a
 * pedir la pantalla al servidor solo por limpiar un parámetro.
 */
export function clearUrlParam(name: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  // El estado va en `null` a propósito: si se le pasa el de Next (lleva `__NA`),
  // su parche de `replaceState` lo toma por llamada interna y no actualiza su
  // URL canónica, de modo que el siguiente `router.refresh()` devolvería el
  // parámetro a la barra de direcciones.
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
