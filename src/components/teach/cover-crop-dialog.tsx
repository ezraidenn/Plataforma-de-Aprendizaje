"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crop, Loader2, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Salida: 1200 × 500 (12:5), igual que el encuadre de las tarjetas. */
export const COVER_W = 1200;
export const COVER_H = 500;
const RATIO = COVER_W / COVER_H;

type View = { scale: number; x: number; y: number }; // x,y = desplazamiento del centro (px del marco)

/**
 * Editor de encuadre estilo Canva: arrastra la imagen para centrarla, acerca
 * con la rueda, el slider o los botones; doble clic = reajustar (cubrir el
 * marco centrado). Exporta un JPEG recortado de 1200×500.
 */
export function CoverCropDialog({
  src,
  open,
  onOpenChange,
  onConfirm,
  busy = false,
}: {
  /** URL o data URL de la imagen original */
  src: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (file: File) => void;
  busy?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [frameW, setFrameW] = useState(600);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [minScale, setMinScale] = useState(1);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const frameH = frameW / RATIO;

  // Escala mínima = "cubrir" el marco; centrada
  const fit = useCallback(
    (img: HTMLImageElement, w: number) => {
      const h = w / RATIO;
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      setMinScale(s);
      setView({ scale: s, x: 0, y: 0 });
    },
    []
  );

  // Cargar la imagen
  useEffect(() => {
    if (!src || !open) return;
    setLoaded(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setLoaded(true);
      fit(img, frameRef.current?.clientWidth ?? 600);
    };
    img.src = src;
    return () => {
      imgRef.current = null;
    };
  }, [src, open, fit]);

  // Medir el marco (responsive)
  useEffect(() => {
    if (!open) return;
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setFrameW(w);
      if (imgRef.current) fit(imgRef.current, w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, fit]);

  /** Mantiene la imagen cubriendo el marco (sin bordes vacíos). */
  const clamp = useCallback(
    (v: View): View => {
      const img = imgRef.current;
      if (!img) return v;
      const scale = Math.min(Math.max(v.scale, minScale), minScale * 6);
      const iw = img.naturalWidth * scale;
      const ih = img.naturalHeight * scale;
      const maxX = Math.max(0, (iw - frameW) / 2);
      const maxY = Math.max(0, (ih - frameH) / 2);
      return {
        scale,
        x: Math.min(maxX, Math.max(-maxX, v.x)),
        y: Math.min(maxY, Math.max(-maxY, v.y)),
      };
    },
    [minScale, frameW, frameH]
  );

  const zoomTo = (scale: number) => setView((v) => clamp({ ...v, scale }));
  const zoomBy = (factor: number) => setView((v) => clamp({ ...v, scale: v.scale * factor }));

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const d = drag.current;
    setView((v) => clamp({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08);
  }

  function confirm() {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = COVER_W;
    canvas.height = COVER_H;
    const ctx = canvas.getContext("2d")!;
    // Relación marco→salida
    const k = COVER_W / frameW;
    const iw = img.naturalWidth * view.scale * k;
    const ih = img.naturalHeight * view.scale * k;
    const dx = COVER_W / 2 - iw / 2 + view.x * k;
    const dy = COVER_H / 2 - ih / 2 + view.y * k;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, dx, dy, iw, ih);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onConfirm(new File([blob], "portada-curso.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9
    );
  }

  const img = imgRef.current;
  const zoomPct = Math.round((view.scale / minScale) * 100);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="size-4" aria-hidden /> Encuadrar imagen
          </DialogTitle>
          <DialogDescription>
            Arrastra para mover, usa la rueda o el control para acercar. Doble clic reajusta.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={frameRef}
          role="img"
          aria-label="Vista previa del encuadre"
          className="relative w-full touch-none select-none overflow-hidden rounded-xl border bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#f8fafc_0%_50%)] bg-[length:16px_16px]"
          style={{ aspectRatio: `${COVER_W} / ${COVER_H}`, cursor: drag.current ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onDoubleClick={() => img && fit(img, frameW)}
        >
          {loaded && img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src ?? ""}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: img.naturalWidth * view.scale,
                height: img.naturalHeight * view.scale,
                transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px))`,
              }}
            />
          )}
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" aria-label="Cargando imagen" />
            </div>
          )}
          {/* Guías de tercios */}
          <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <span key={i} className="border border-white/25" />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Alejar" onClick={() => zoomBy(1 / 1.15)} disabled={!loaded}>
            <Minus className="size-4" />
          </Button>
          <input
            type="range"
            aria-label="Zoom"
            min={minScale}
            max={minScale * 6}
            step={minScale / 100}
            value={view.scale}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="h-2 flex-1 accent-[var(--section)]"
            disabled={!loaded}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Acercar" onClick={() => zoomBy(1.15)} disabled={!loaded}>
            <Plus className="size-4" />
          </Button>
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{zoomPct}%</span>
          <Button type="button" variant="outline" size="sm" onClick={() => img && fit(img, frameW)} disabled={!loaded}>
            <Maximize2 className="size-4" aria-hidden /> Reajustar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setView((v) => clamp({ ...v, x: 0, y: 0 }))} disabled={!loaded}>
            <RotateCcw className="size-4" aria-hidden /> Centrar
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={!loaded || busy} className="bg-section text-white hover:bg-section-strong">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Crop className="size-4" aria-hidden />}
            Usar este encuadre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
