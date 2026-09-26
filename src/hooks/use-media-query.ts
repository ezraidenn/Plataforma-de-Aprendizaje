"use client";

import { useCallback, useSyncExternalStore } from "react";

/** ¿Se cumple la media query? Durante el render del servidor devuelve `serverValue`. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}
