/**
 * Geometría del lienzo de certificados: cajas de cada campo, guías
 * inteligentes (tipo Canva), medidas y operaciones de alineación /
 * distribución. Funciones puras: el editor solo las llama.
 */

export type Box = { left: number; top: number; width: number; height: number };

export type Rect = Box & { right: number; bottom: number; cx: number; cy: number };

export function toRect(b: Box): Rect {
  return {
    ...b,
    right: b.left + b.width,
    bottom: b.top + b.height,
    cx: b.left + b.width / 2,
    cy: b.top + b.height / 2,
  };
}

/** Caja (en puntos PDF) de un campo dado su anclaje. */
export function fieldBox(opts: {
  x: number;
  y: number;
  align: "left" | "center" | "right";
  width: number;
  height: number;
}): Rect {
  const left =
    opts.align === "center" ? opts.x - opts.width / 2 : opts.align === "right" ? opts.x - opts.width : opts.x;
  return toRect({ left, top: opts.y, width: opts.width, height: opts.height });
}

/** Ancla X a partir del borde izquierdo deseado (inverso de fieldBox). */
export function anchorXFromLeft(left: number, width: number, align: "left" | "center" | "right"): number {
  return align === "center" ? left + width / 2 : align === "right" ? left + width : left;
}

// ─── Guías inteligentes ──────────────────────────────────────────────────────

export type Guide = {
  axis: "x" | "y";
  /** Posición en puntos */
  at: number;
  /** Origen: página (centro/margen) u otro campo */
  kind: "center" | "margin" | "edge" | "spacing";
  /** Extensión de la línea (para dibujarla acotada a los elementos implicados) */
  from: number;
  to: number;
};

export type SnapResult = {
  dx: number;
  dy: number;
  guides: Guide[];
};

type Candidate = { at: number; kind: Guide["kind"]; from: number; to: number };

/**
 * Calcula el desplazamiento de ajuste para una caja en movimiento contra la
 * página y las demás cajas. Compara bordes y centros en ambos ejes; también
 * detecta separaciones iguales (simetría) con dos vecinos alineados.
 */
export function computeSnap(opts: {
  moving: Rect;
  others: Rect[];
  pageW: number;
  pageH: number;
  margin: number;
  tolerance: number;
}): SnapResult {
  const { moving, others, pageW, pageH, margin, tolerance } = opts;

  const xCands: Candidate[] = [
    { at: pageW / 2, kind: "center", from: 0, to: pageH },
    { at: margin, kind: "margin", from: 0, to: pageH },
    { at: pageW - margin, kind: "margin", from: 0, to: pageH },
  ];
  const yCands: Candidate[] = [
    { at: pageH / 2, kind: "center", from: 0, to: pageW },
    { at: margin, kind: "margin", from: 0, to: pageW },
    { at: pageH - margin, kind: "margin", from: 0, to: pageW },
  ];
  for (const o of others) {
    const fy = Math.min(o.top, moving.top);
    const ty = Math.max(o.bottom, moving.bottom);
    const fx = Math.min(o.left, moving.left);
    const tx = Math.max(o.right, moving.right);
    xCands.push(
      { at: o.left, kind: "edge", from: fy, to: ty },
      { at: o.cx, kind: "edge", from: fy, to: ty },
      { at: o.right, kind: "edge", from: fy, to: ty }
    );
    yCands.push(
      { at: o.top, kind: "edge", from: fx, to: tx },
      { at: o.cy, kind: "edge", from: fx, to: tx },
      { at: o.bottom, kind: "edge", from: fx, to: tx }
    );
  }

  const movingX = [moving.left, moving.cx, moving.right];
  const movingY = [moving.top, moving.cy, moving.bottom];

  let bestX: { delta: number; cand: Candidate } | null = null;
  for (const mx of movingX) {
    for (const c of xCands) {
      const delta = c.at - mx;
      if (Math.abs(delta) <= tolerance && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
        bestX = { delta, cand: c };
      }
    }
  }
  let bestY: { delta: number; cand: Candidate } | null = null;
  for (const my of movingY) {
    for (const c of yCands) {
      const delta = c.at - my;
      if (Math.abs(delta) <= tolerance && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
        bestY = { delta, cand: c };
      }
    }
  }

  const guides: Guide[] = [];
  let dx = bestX?.delta ?? 0;
  let dy = bestY?.delta ?? 0;

  // Separación igual (simetría): moving entre dos vecinos en la misma fila/columna
  if (!bestX) {
    const row = others.filter((o) => overlaps(o.top, o.bottom, moving.top, moving.bottom));
    const leftN = row.filter((o) => o.right <= moving.left + tolerance).sort((a, b) => b.right - a.right)[0];
    const rightN = row.filter((o) => o.left >= moving.right - tolerance).sort((a, b) => a.left - b.left)[0];
    if (leftN && rightN) {
      const total = rightN.left - leftN.right;
      const gap = (total - moving.width) / 2;
      const targetLeft = leftN.right + gap;
      const delta = targetLeft - moving.left;
      if (gap > 0 && Math.abs(delta) <= tolerance) {
        dx = delta;
        const y = moving.cy;
        guides.push(
          { axis: "x", at: leftN.right, kind: "spacing", from: y, to: y },
          { axis: "x", at: rightN.left, kind: "spacing", from: y, to: y }
        );
      }
    }
  }
  if (!bestY) {
    const col = others.filter((o) => overlaps(o.left, o.right, moving.left, moving.right));
    const topN = col.filter((o) => o.bottom <= moving.top + tolerance).sort((a, b) => b.bottom - a.bottom)[0];
    const botN = col.filter((o) => o.top >= moving.bottom - tolerance).sort((a, b) => a.top - b.top)[0];
    if (topN && botN) {
      const total = botN.top - topN.bottom;
      const gap = (total - moving.height) / 2;
      const targetTop = topN.bottom + gap;
      const delta = targetTop - moving.top;
      if (gap > 0 && Math.abs(delta) <= tolerance) {
        dy = delta;
        const x = moving.cx;
        guides.push(
          { axis: "y", at: topN.bottom, kind: "spacing", from: x, to: x },
          { axis: "y", at: botN.top, kind: "spacing", from: x, to: x }
        );
      }
    }
  }

  if (bestX) guides.push({ axis: "x", at: bestX.cand.at, kind: bestX.cand.kind, from: bestX.cand.from, to: bestX.cand.to });
  if (bestY) guides.push({ axis: "y", at: bestY.cand.at, kind: bestY.cand.kind, from: bestY.cand.from, to: bestY.cand.to });

  return { dx, dy, guides };
}

function overlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && b1 < a2;
}

// ─── Medidas (distancias a la página y al vecino más cercano) ───────────────

export type Measure = { axis: "x" | "y"; from: number; to: number; at: number; value: number };

/** Distancias del elemento a los bordes de página y a los vecinos más próximos. */
export function measures(moving: Rect, others: Rect[], pageW: number, pageH: number): Measure[] {
  const out: Measure[] = [];
  const row = others.filter((o) => overlaps(o.top, o.bottom, moving.top, moving.bottom));
  const col = others.filter((o) => overlaps(o.left, o.right, moving.left, moving.right));
  const leftN = row.filter((o) => o.right <= moving.left).sort((a, b) => b.right - a.right)[0];
  const rightN = row.filter((o) => o.left >= moving.right).sort((a, b) => a.left - b.left)[0];
  const topN = col.filter((o) => o.bottom <= moving.top).sort((a, b) => b.bottom - a.bottom)[0];
  const botN = col.filter((o) => o.top >= moving.bottom).sort((a, b) => a.top - b.top)[0];

  const l = leftN ? leftN.right : 0;
  const r = rightN ? rightN.left : pageW;
  const t = topN ? topN.bottom : 0;
  const b = botN ? botN.top : pageH;
  out.push({ axis: "x", from: l, to: moving.left, at: moving.cy, value: moving.left - l });
  out.push({ axis: "x", from: moving.right, to: r, at: moving.cy, value: r - moving.right });
  out.push({ axis: "y", from: t, to: moving.top, at: moving.cx, value: moving.top - t });
  out.push({ axis: "y", from: moving.bottom, to: b, at: moving.cx, value: b - moving.bottom });
  return out.filter((m) => m.value > 0.5);
}

// ─── Alineación y distribución ───────────────────────────────────────────────

export type AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/**
 * Desplazamientos (dx, dy) por índice para alinear las cajas dadas. Con una
 * sola caja se alinea a la página; con varias, al rectángulo que las envuelve.
 */
export function alignDeltas(
  rects: { index: number; rect: Rect }[],
  op: AlignOp,
  pageW: number,
  pageH: number,
  margin: number
): Map<number, { dx: number; dy: number }> {
  const out = new Map<number, { dx: number; dy: number }>();
  if (rects.length === 0) return out;
  const single = rects.length === 1;
  const bounds = single
    ? toRect({ left: margin, top: margin, width: pageW - margin * 2, height: pageH - margin * 2 })
    : toRect({
        left: Math.min(...rects.map((r) => r.rect.left)),
        top: Math.min(...rects.map((r) => r.rect.top)),
        width: Math.max(...rects.map((r) => r.rect.right)) - Math.min(...rects.map((r) => r.rect.left)),
        height: Math.max(...rects.map((r) => r.rect.bottom)) - Math.min(...rects.map((r) => r.rect.top)),
      });
  // Para una sola caja, centrar usa el centro real de la página
  const cx = single ? pageW / 2 : bounds.cx;
  const cy = single ? pageH / 2 : bounds.cy;

  for (const { index, rect } of rects) {
    let dx = 0;
    let dy = 0;
    switch (op) {
      case "left": dx = bounds.left - rect.left; break;
      case "hcenter": dx = cx - rect.cx; break;
      case "right": dx = bounds.right - rect.right; break;
      case "top": dy = bounds.top - rect.top; break;
      case "vcenter": dy = cy - rect.cy; break;
      case "bottom": dy = bounds.bottom - rect.bottom; break;
    }
    out.set(index, { dx, dy });
  }
  return out;
}

/** Reparte separaciones iguales entre ≥3 cajas (horizontal o vertical). */
export function distributeDeltas(
  rects: { index: number; rect: Rect }[],
  axis: "x" | "y"
): Map<number, { dx: number; dy: number }> {
  const out = new Map<number, { dx: number; dy: number }>();
  if (rects.length < 3) return out;
  const sorted = [...rects].sort((a, b) => (axis === "x" ? a.rect.left - b.rect.left : a.rect.top - b.rect.top));
  const first = sorted[0].rect;
  const last = sorted[sorted.length - 1].rect;
  const span = axis === "x" ? last.right - first.left : last.bottom - first.top;
  const sizes = sorted.reduce((s, r) => s + (axis === "x" ? r.rect.width : r.rect.height), 0);
  const gap = (span - sizes) / (sorted.length - 1);
  let cursor = axis === "x" ? first.left : first.top;
  for (const { index, rect } of sorted) {
    const target = cursor;
    const cur = axis === "x" ? rect.left : rect.top;
    out.set(index, axis === "x" ? { dx: target - cur, dy: 0 } : { dx: 0, dy: target - cur });
    cursor += (axis === "x" ? rect.width : rect.height) + gap;
  }
  return out;
}

/** Puntos PDF → milímetros (para etiquetas legibles). */
export function ptToMm(pt: number): string {
  return `${(pt * 0.3528).toFixed(1)} mm`;
}
