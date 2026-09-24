"use client";

import { useCallback, useState } from "react";

/** Avisos para lector de pantalla: `announce("…")` y, en el JSX, `<LiveRegion live={live} />`. */
export function useAnnouncer() {
  const [live, setLive] = useState({ text: "", n: 0 });
  const announce = useCallback((text: string) => setLive((l) => ({ text, n: l.n + 1 })), []);
  return { live, announce };
}

export function LiveRegion({ live }: { live: { text: string; n: number } }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {live.text}
      {/* Un carácter invisible alterno para que se repita el mismo aviso */}
      {live.n % 2 ? String.fromCharCode(0x200b) : ""}
    </p>
  );
}
