"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Vista previa de PDF con pdf.js (todas las páginas, scroll vertical). No
 * depende del visor del navegador, así que funciona aunque Chrome tenga
 * activado "descargar PDF en vez de abrirlos". Sin seguimiento de lectura.
 */
export function PdfPreview({
  url,
  className,
  maxHeight = 560,
}: {
  url: string;
  className?: string;
  maxHeight?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | null = null;
    setPdf(null);
    setError(false);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        task = pdfjs.getDocument({ url, withCredentials: true });
        const doc = await task.promise;
        if (cancelled) return;
        setPdf(doc);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={scrollRef}
      className={cn("overflow-auto rounded-xl border bg-muted/40 p-3", className)}
      style={{ maxHeight }}
    >
      {error && (
        <p className="flex items-center gap-2 p-4 text-sm text-destructive">
          <TriangleAlert className="size-4" aria-hidden />
          No se pudo mostrar el PDF. Descárgalo para verlo.
        </p>
      )}
      {!pdf && !error && (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-label="Cargando PDF" />
        </div>
      )}
      {pdf && width > 0 && (
        <div className="space-y-3">
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={i} pdf={pdf} index={i + 1} width={width - 24} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({ pdf, index, width }: { pdf: PDFDocumentProxy; index: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.max(0.1, width / base.width);
      const viewport = page.getViewport({ scale: scale * dpr });
      // Render fuera de pantalla: nunca dos render() sobre el mismo canvas
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.floor(viewport.width);
      offscreen.height = Math.floor(viewport.height);
      await page.render({ canvas: offscreen, viewport }).promise;
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.style.width = `${Math.floor(offscreen.width / dpr)}px`;
      canvas.style.height = `${Math.floor(offscreen.height / dpr)}px`;
      canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdf, index, width]);
  return <canvas ref={ref} className="mx-auto block rounded-md bg-white shadow-sm" aria-label={`Página ${index}`} />;
}
