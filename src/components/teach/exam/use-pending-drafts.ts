"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Lo escrito en un campo de «agregar» (una ficha de completar, una tarjeta de
 * clasificar) que aún no se agregó con Enter. Cada campo lo avisa con
 * `useReportDraft`; el editor junta los suyos con `usePendingDrafts` y le dice
 * a la pregunta el primero: con algo pendiente, «Guardar» se deshabilita y lo
 * dice, así lo escrito no se pierde en silencio al guardar.
 */

export type ReportDraft = (key: string, text: string | null) => void;

export function usePendingDrafts(onPendingChange?: (text: string | null) => void): ReportDraft {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const report = useCallback<ReportDraft>(
    (key, text) =>
      setDrafts((prev) => {
        if ((prev[key] ?? null) === text) return prev;
        const next = { ...prev };
        if (text === null) delete next[key];
        else next[key] = text;
        return next;
      }),
    []
  );
  const first = Object.values(drafts)[0] ?? null;
  useEffect(() => {
    onPendingChange?.(first);
  }, [first, onPendingChange]);
  // Si el editor se cierra con algo escrito, «Guardar» no se queda deshabilitado
  useEffect(() => () => onPendingChange?.(null), [onPendingChange]);
  return report;
}

/** Un campo avisa lo que tiene escrito (sin los espacios de las orillas; vacío o cerrado, nada) mientras exista. */
export function useReportDraft(report: ReportDraft | undefined, key: string, draft: string | null) {
  const text = draft?.trim() || null;
  useEffect(() => {
    if (!report || text === null) return;
    report(key, text);
    return () => report(key, null);
  }, [report, key, text]);
}
