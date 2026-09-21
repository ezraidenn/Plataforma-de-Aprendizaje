"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Loader2,
  Maximize2,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KindChip } from "@/components/kind-meta";
import { sendHeartbeat } from "./heartbeat";
import { CountdownRing, StudyTimer, formatApprox, type StudyTimerState } from "./study-timer";
import type { HeartbeatResponse } from "./types";

const HEARTBEAT_MS = 10_000;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;
const ZOOM_STEP = 0.2;

/**
 * Visor de PDF página por página (DISENO-UX §2.4). Renderiza con pdf.js en
 * canvas; el heartbeat reporta la página actual y el SERVIDOR acredita.
 */
export function DocumentViewer({
  courseId,
  itemId,
  title,
  fileUrl,
  pageCount,
  minSecondsPerPage,
  initialPage,
  initialCreditedPages,
  onCompleted,
}: {
  courseId: string;
  itemId: string;
  title: string;
  fileUrl: string;
  pageCount: number;
  minSecondsPerPage: number;
  initialPage: number;
  initialCreditedPages: number[];
  onCompleted: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(() => Math.max(1, Math.min(initialPage, pageCount)));
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  const [credited, setCredited] = useState<Set<number>>(() => new Set(initialCreditedPages));
  // null = página ya acreditada (navegación libre); 0 = tiempo local cumplido
  const [countdown, setCountdown] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  // Vista previa del maestro: el servidor no registra nada
  const [preview, setPreview] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSeq = useRef(0);
  const pageRef = useRef(page);
  const creditedRef = useRef(credited);
  creditedRef.current = credited;

  // ─── Heartbeat ─────────────────────────────────────────────────────────────

  const applyResponse = useCallback(
    (res: HeartbeatResponse | null) => {
      if (!res) return;
      if (res.preview) {
        setPreview(true);
        return;
      }
      if (res.creditedPages.length > 0) {
        setCredited((prev) => {
          const next = new Set(prev);
          for (const p of res.creditedPages) next.add(p);
          return next;
        });
        // Reconciliación: si el servidor acreditó la página actual, se libera
        if (res.creditedPages.includes(pageRef.current)) setCountdown(null);
      }
      if (res.completed) onCompleted();
    },
    [onCompleted]
  );

  const beat = useCallback(
    async (pageOverride?: number) => {
      const res = await sendHeartbeat({
        courseId,
        itemId,
        kind: "document",
        page: pageOverride ?? pageRef.current,
      });
      applyResponse(res);
    },
    [courseId, itemId, applyResponse]
  );

  // Latido inicial + cada 10 s mientras la pestaña esté visible
  useEffect(() => {
    let interval: number | null = null;
    const start = () => {
      if (interval === null) interval = window.setInterval(() => void beat(), HEARTBEAT_MS);
    };
    const stop = () => {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      if (isVisible) start();
      else stop();
    };

    void beat();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [beat]);

  // ─── Cuenta regresiva local por página no acreditada ───────────────────────

  useEffect(() => {
    if (creditedRef.current.has(page)) {
      setCountdown(null);
      return;
    }
    setCountdown(minSecondsPerPage);
  }, [page, minSecondsPerPage]);

  const countdownActive = countdown !== null && countdown > 0;
  useEffect(() => {
    if (!countdownActive) return;
    const id = window.setInterval(() => {
      // La cuenta solo corre con la pestaña visible (igual que el servidor)
      if (document.visibilityState !== "visible") return;
      setCountdown((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [countdownActive, page]);

  // Al cumplirse el tiempo local, latido inmediato: la acreditación real
  // la confirma el servidor con su reloj.
  useEffect(() => {
    if (countdown === 0) void beat();
  }, [countdown, beat]);

  // ─── Carga del PDF (worker de pdf.js) ──────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // El bundler (Turbopack/webpack) emite el worker como asset estático
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        task = pdfjs.getDocument({ url: fileUrl, withCredentials: true });
        const doc = await task.promise;
        if (cancelled) return; // la limpieza destruye la tarea completa
        setPdf(doc);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [fileUrl]);

  // Ancho disponible para fit-width
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(Math.floor(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render de la página actual: se dibuja fuera de pantalla y se copia al
  // canvas visible para que la página anterior no parpadee (§3.2)
  useEffect(() => {
    if (!pdf || containerWidth <= 0) return;
    let cancelled = false;
    const seq = ++renderSeq.current;
    setRendering(true);
    (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.max(0.1, (containerWidth - 32) / base.width);
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: fit * zoom * dpr });

        const offscreen = document.createElement("canvas");
        offscreen.width = Math.floor(viewport.width);
        offscreen.height = Math.floor(viewport.height);
        await pdfPage.render({ canvas: offscreen, viewport }).promise;

        if (cancelled || seq !== renderSeq.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.style.width = `${Math.floor(offscreen.width / dpr)}px`;
        canvas.style.height = `${Math.floor(offscreen.height / dpr)}px`;
        canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
        setRendering(false);
      } catch {
        if (!cancelled && seq === renderSeq.current) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page, zoom, containerWidth]);

  // ─── Navegación ────────────────────────────────────────────────────────────

  const pageCredited = credited.has(page);
  const waitDone = countdown === null || countdown <= 0;

  // Contador visible: segundos de ESTA página + estimado de lo que falta del documento
  const timed = minSecondsPerPage > 0;
  const allRead = credited.size >= pageCount;
  const pageRemaining = pageCredited ? 0 : (countdown ?? minSecondsPerPage);
  const otherPending = Math.max(0, pageCount - credited.size - (pageCredited ? 0 : 1));
  const docRemaining = otherPending * minSecondsPerPage + pageRemaining;
  const previewPageDone = preview && !pageCredited && waitDone;
  const timerState: StudyTimerState =
    allRead || pageCredited || previewPageDone
      ? "done"
      : waitDone
        ? "syncing"
        : !visible
          ? "paused"
          : "running";
  const timerDoneLabel = allRead ? "Documento leído" : previewPageDone ? "Tiempo cumplido" : "Página leída";
  const timerDoneCaption = allRead
    ? undefined
    : previewPageDone
      ? "Vista previa: no se registra"
      : `Faltan ≈ ${formatApprox(otherPending * minSecondsPerPage)} en el documento`;
  const canGoNext = page < pageCount && (pageCredited || waitDone);
  const canGoPrev = page > 1;

  const goTo = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(target, pageCount));
      if (clamped === pageRef.current) return;
      pageRef.current = clamped;
      setPage(clamped);
      scrollRef.current?.scrollTo({ top: 0 });
      void beat(clamped);
    },
    [pageCount, beat]
  );

  const canGoNextRef = useRef(canGoNext);
  canGoNextRef.current = canGoNext;

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen?.();
    }
  }, []);

  // Teclado: ←/→ cambian página respetando el bloqueo; F pantalla completa
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "ArrowRight") {
        if (canGoNextRef.current) goTo(pageRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        goTo(pageRef.current - 1);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, toggleFullscreen]);

  // ─── UI ────────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="size-10 text-destructive" aria-hidden />
        <p className="max-w-sm text-muted-foreground">
          No pudimos abrir el documento. Revisa tu conexión con el servidor y
          vuelve a intentarlo.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div ref={containerRef} className="flex h-full flex-col bg-background">
        {/* Barra superior: título, "Página X de N" y controles de zoom */}
        <div className="flex items-center gap-3 border-b bg-card px-4 py-2">
          <KindChip kind="document" />
          <h2 className="min-w-0 flex-1 truncate font-heading text-sm font-semibold">
            {title}
          </h2>
          {timed && (
            <StudyTimer
              remaining={pageRemaining}
              total={minSecondsPerPage}
              state={timerState}
              caption={`En esta página · ≈ ${formatApprox(docRemaining)} en total`}
              pausedHint="Se reanuda al volver a esta pestaña"
              doneLabel={timerDoneLabel}
              doneCaption={timerDoneCaption}
            />
          )}
          <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
            <span className="sr-only sm:not-sr-only">Página {page} de {pageCount}</span>
            <span className="sm:hidden" aria-hidden>
              {page}/{pageCount}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Alejar"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            >
              <ZoomOut aria-hidden />
            </Button>
            <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Acercar"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            >
              <ZoomIn aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Pantalla completa"
              onClick={toggleFullscreen}
            >
              <Maximize2 aria-hidden />
            </Button>
          </div>
        </div>

        {/* Progreso segmentado: pinta páginas ACREDITADAS, no la posición */}
        <div className="border-b bg-card px-4 pb-2">
          <div
            className="flex h-1.5 gap-px overflow-hidden rounded-full"
            role="img"
            aria-label={`${credited.size} de ${pageCount} páginas leídas`}
          >
            {Array.from({ length: pageCount }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-full flex-1",
                  credited.has(i + 1) ? "bg-progress-ring" : "bg-muted"
                )}
              />
            ))}
          </div>
        </div>

        {/* La página, sin scroll de documento (una a la vez) */}
        <div
          ref={scrollRef}
          className="relative flex flex-1 justify-center overflow-auto bg-muted/60 p-4"
        >
          {!pdf && !loadError && (
            <div className="flex items-center gap-2 self-center text-muted-foreground">
              <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />
              <span>Abriendo el documento…</span>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className={cn(
              "h-fit max-w-full rounded-sm bg-white shadow-sm motion-safe:transition-opacity motion-safe:duration-150",
              rendering && "opacity-60",
              !pdf && "hidden"
            )}
            role="img"
            aria-label={`Página ${page} del documento ${title}`}
          />
        </div>

        {/* Navegación de páginas */}
        <div className="flex items-center justify-between gap-3 border-t bg-card px-4 py-2">
          <Button
            variant="outline"
            className="h-11 min-w-28"
            disabled={!canGoPrev}
            onClick={() => goTo(page - 1)}
          >
            <ChevronLeft aria-hidden />
            Anterior
          </Button>

          {page >= pageCount ? (
            // Última página: la lección se completa al acreditarse
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm",
                pageCredited ? "font-medium text-success" : "text-muted-foreground"
              )}
              aria-live="polite"
            >
              {pageCredited && <CircleCheck className="size-4 shrink-0" aria-hidden />}
              {pageCredited
                ? "Todas las páginas leídas"
                : "Última página — estamos registrando tu lectura…"}
            </p>
          ) : canGoNext ? (
            <Button
              className="anim-pop h-11 min-w-28 bg-cta text-cta-foreground hover:bg-cta/90 motion-safe:transition-colors motion-safe:duration-200"
              onClick={() => goTo(page + 1)}
            >
              Siguiente
              <ChevronRight aria-hidden />
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex rounded-lg">
                  <Button className="h-11 min-w-28" disabled aria-disabled="true">
                    <CountdownRing
                      remaining={countdown ?? minSecondsPerPage}
                      total={minSecondsPerPage}
                    />
                    Siguiente
                    <ChevronRight aria-hidden />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                Un momento… estamos registrando tu lectura
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
