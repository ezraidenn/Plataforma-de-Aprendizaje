"use client";

import { ptToMm, type Guide, type Measure } from "./canvas-geometry";

const GUIDE_COLOR = "#e11d48"; // rosa/rojo tipo Canva
const MEASURE_COLOR = "#0ea5e9";

/**
 * Guías inteligentes y medidas mientras se arrastra. Se dibuja como SVG sobre
 * el lienzo (coordenadas en px = pt × scale), sin capturar el puntero.
 */
export function CanvasGuides({
  guides,
  measures,
  scale,
  pageW,
  pageH,
}: {
  guides: Guide[];
  measures: Measure[];
  scale: number;
  pageW: number;
  pageH: number;
}) {
  if (guides.length === 0 && measures.length === 0) return null;
  const W = pageW * scale;
  const H = pageH * scale;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-visible"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
    >
      {measures.map((m, i) => {
        const a = m.from * scale;
        const b = m.to * scale;
        const at = m.at * scale;
        const mid = (a + b) / 2;
        const label = ptToMm(m.value);
        return m.axis === "x" ? (
          <g key={`m${i}`}>
            <line
              x1={a}
              y1={at}
              x2={b}
              y2={at}
              stroke={MEASURE_COLOR}
              strokeDasharray="3 3"
            />
            <line
              x1={a}
              y1={at - 4}
              x2={a}
              y2={at + 4}
              stroke={MEASURE_COLOR}
            />
            <line
              x1={b}
              y1={at - 4}
              x2={b}
              y2={at + 4}
              stroke={MEASURE_COLOR}
            />
            {Math.abs(b - a) > 18 && (
              <MeasureLabel x={mid} y={at - 9} text={label} />
            )}
          </g>
        ) : (
          <g key={`m${i}`}>
            <line
              x1={at}
              y1={a}
              x2={at}
              y2={b}
              stroke={MEASURE_COLOR}
              strokeDasharray="3 3"
            />
            <line
              x1={at - 4}
              y1={a}
              x2={at + 4}
              y2={a}
              stroke={MEASURE_COLOR}
            />
            <line
              x1={at - 4}
              y1={b}
              x2={at + 4}
              y2={b}
              stroke={MEASURE_COLOR}
            />
            {Math.abs(b - a) > 18 && (
              <MeasureLabel x={at + 9} y={mid} text={label} anchor="start" />
            )}
          </g>
        );
      })}
      {guides.map((g, i) => {
        const at = g.at * scale;
        const isSpacing = g.kind === "spacing";
        const from = isSpacing ? 0 : g.from * scale;
        const to = isSpacing ? (g.axis === "x" ? H : W) : g.to * scale;
        const dash =
          g.kind === "center" ? "6 4" : g.kind === "margin" ? "2 3" : undefined;
        return g.axis === "x" ? (
          <line
            key={`g${i}`}
            x1={at}
            y1={from}
            x2={at}
            y2={to}
            stroke={GUIDE_COLOR}
            strokeWidth={1}
            strokeDasharray={dash}
          />
        ) : (
          <line
            key={`g${i}`}
            x1={from}
            y1={at}
            x2={to}
            y2={at}
            stroke={GUIDE_COLOR}
            strokeWidth={1}
            strokeDasharray={dash}
          />
        );
      })}
    </svg>
  );
}

function MeasureLabel({
  x,
  y,
  text,
  anchor = "middle",
}: {
  x: number;
  y: number;
  text: string;
  anchor?: "middle" | "start";
}) {
  const w = text.length * 6 + 8;
  const left = anchor === "middle" ? x - w / 2 : x;
  return (
    <g>
      <rect
        x={left}
        y={y - 8}
        width={w}
        height={14}
        rx={3}
        fill={MEASURE_COLOR}
      />
      <text
        x={left + w / 2}
        y={y + 2.5}
        fontSize={9}
        fill="#fff"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui"
      >
        {text}
      </text>
    </g>
  );
}

/** Reglas en milímetros alrededor del lienzo (arriba e izquierda). */
export function CanvasRulers({
  scale,
  pageW,
  pageH,
  size,
  children,
}: {
  scale: number;
  pageW: number;
  pageH: number;
  size: number;
  children: React.ReactNode;
}) {
  const W = pageW * scale;
  const H = pageH * scale;
  const mmPx = (1 / 0.3528) * scale; // px por mm
  const ticks = (lengthPx: number) => {
    const out: { px: number; major: boolean; label?: number }[] = [];
    const totalMm = Math.floor(lengthPx / mmPx);
    for (let mm = 0; mm <= totalMm; mm += 5) {
      const major = mm % 10 === 0;
      out.push({
        px: mm * mmPx,
        major,
        label: major && mm % 20 === 0 ? mm : undefined,
      });
    }
    return out;
  };
  return (
    <div className="relative" style={{ paddingLeft: size, paddingTop: size }}>
      {/* Regla superior */}
      <svg
        aria-hidden
        className="absolute left-0 top-0 text-slate-400"
        width={W + size}
        height={size}
        style={{ left: 0 }}
      >
        <rect x={0} y={0} width={W + size} height={size} fill="#f8fafc" />
        {ticks(W).map((t, i) => (
          <g key={i}>
            <line
              x1={size + t.px}
              y1={size}
              x2={size + t.px}
              y2={size - (t.major ? 8 : 4)}
              stroke="currentColor"
              strokeWidth={1}
            />
            {t.label !== undefined && (
              <text x={size + t.px + 2} y={9} fontSize={8} fill="currentColor">
                {t.label}
              </text>
            )}
          </g>
        ))}
        <line
          x1={size}
          y1={size - 0.5}
          x2={W + size}
          y2={size - 0.5}
          stroke="#cbd5e1"
        />
      </svg>
      {/* Regla izquierda */}
      <svg
        aria-hidden
        className="absolute left-0 top-0 text-slate-400"
        width={size}
        height={H + size}
      >
        <rect x={0} y={0} width={size} height={H + size} fill="#f8fafc" />
        {ticks(H).map((t, i) => (
          <g key={i}>
            <line
              x1={size}
              y1={size + t.px}
              x2={size - (t.major ? 8 : 4)}
              y2={size + t.px}
              stroke="currentColor"
              strokeWidth={1}
            />
            {t.label !== undefined && (
              <text
                x={9}
                y={size + t.px - 2}
                fontSize={8}
                fill="currentColor"
                transform={`rotate(-90 9 ${size + t.px - 2})`}
              >
                {t.label}
              </text>
            )}
          </g>
        ))}
        <line
          x1={size - 0.5}
          y1={size}
          x2={size - 0.5}
          y2={H + size}
          stroke="#cbd5e1"
        />
      </svg>
      {children}
    </div>
  );
}
