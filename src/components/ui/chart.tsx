"use client";
import { useMemo, useRef, useState } from "react";

type Point = { x: number; y: number };

export function LineChartSkeleton({ points }: { points?: Point[] }) {
  const data = useMemo(() => points ?? generatePlaceholderData(), [points]);
  return (
    <svg
      className="h-64 w-full"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={0.5}
        points={data.map((p) => `${p.x},${40 - p.y}`).join(" ")}
      />
    </svg>
  );
}

export function LineChart({ values }: { values: Array<[number, number]> }) {
  const { path, area, scaleX, scaleY, domainX, domainY, margins } = useMemo(
    () => buildChart(values),
    [values]
  );
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    i: number;
    px: number;
    py: number;
  } | null>(null);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || values.length === 0) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const px = e.clientX - bounds.left;
    const py = e.clientY - bounds.top;
    // convert to viewBox coords (0..100, 0..40)
    const vbX = (px / bounds.width) * 100;
    const vbY = (py / bounds.height) * 40;
    // clamp to plot area
    const xClamped = Math.max(margins.left, Math.min(100 - margins.right, vbX));
    const yClamped = Math.max(margins.top, Math.min(40 - margins.bottom, vbY));
    // find nearest point by x
    const xVal = domainFromX(xClamped, scaleX, domainX);
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < values.length; i++) {
      const dx = Math.abs(values[i][0] - xVal);
      if (dx < best) {
        best = dx;
        nearest = i;
      }
    }
    const [tx, ty] = values[nearest];
    const svgXOnLine = toSvgX(tx, scaleX, margins, domainX);
    const svgYOnLine = toSvgY(ty, scaleY, margins, domainY);
    const dotPx = (svgXOnLine / 100) * bounds.width;
    const dotPy = (svgYOnLine / 40) * bounds.height;
    setHover({
      x: svgXOnLine,
      y: svgYOnLine,
      i: nearest,
      px: dotPx,
      py: dotPy,
    });
  }

  function onLeave() {
    setHover(null);
  }

  // minimal: remove ticks/labels, keep hover + tooltip only

  const tooltip = (() => {
    if (!hover) return null;
    const [ts, val] = values[hover.i];
    const usd = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(val);
    const date = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      year: "2-digit",
    }).format(new Date(ts * 1000));
    const sideRight = hover.px > (svgRef.current?.clientWidth || 0) / 2;
    const style: React.CSSProperties = {
      left: hover.px + (sideRight ? -12 : 12),
      top: hover.py - 8,
      transform: sideRight ? "translateX(-100%)" : undefined,
    };
    return (
      <div
        className="pointer-events-none absolute z-10 rounded-md border border-border bg-card/90 px-2 py-1 text-xs shadow-md whitespace-nowrap"
        style={style}
      >
        <div className="font-semibold">{usd}</div>
        <div className="opacity-70">{date}</div>
      </div>
    );
  })();

  const strokeColor = "var(--chart-2)"; // green from theme
  return (
    <div className="relative h-64 w-full">
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {/* minimal: no gridlines */}
        {/* area under line */}
        {area && (
          <path d={area} fill={strokeColor} fillOpacity={0.04} stroke="none" />
        )}
        {/* line path */}
        <path d={path} fill="none" stroke={strokeColor} strokeWidth={0.3} />
        {/* hover crosshair */}
        {hover && (
          <>
            <line
              x1={hover.x}
              y1={margins.top}
              x2={hover.x}
              y2={40 - margins.bottom}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeWidth={0.2}
            />
          </>
        )}
        {/* minimal: no axis labels */}
      </svg>
      {/* pixel-perfect hover dot to avoid SVG aspect distortion */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow"
          style={{ left: hover.px, top: hover.py, background: strokeColor }}
        />
      )}
      {tooltip}
    </div>
  );
}

export function MultiLineChart({
  values,
  deposits,
}: {
  values: Array<[number, number]>;
  deposits: Array<[number, number]>;
}) {
  const cfg = useMemo(
    () => buildMultiChart(values, deposits),
    [values, deposits]
  );
  const {
    pathValues,
    pathDeposits,
    area,
    scaleX,
    scaleY,
    domainX,
    domainY,
    margins,
  } = cfg;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    i: number;
    px: number;
    py: number;
  } | null>(null);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || values.length === 0) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const px = e.clientX - bounds.left;
    const py = e.clientY - bounds.top;
    const vbX = (px / bounds.width) * 100;
    const vbY = (py / bounds.height) * 40;
    const xClamped = Math.max(margins.left, Math.min(100 - margins.right, vbX));
    const yClamped = Math.max(margins.top, Math.min(40 - margins.bottom, vbY));
    const xVal = domainFromX(xClamped, scaleX, domainX);
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < values.length; i++) {
      const dx = Math.abs(values[i][0] - xVal);
      if (dx < best) {
        best = dx;
        nearest = i;
      }
    }
    const [tx, ty] = values[nearest];
    const svgXOnLine = toSvgX(tx, scaleX, margins, domainX);
    const svgYOnLine = toSvgY(ty, scaleY, margins, domainY);
    const dotPx = (svgXOnLine / 100) * bounds.width;
    const dotPy = (svgYOnLine / 40) * bounds.height;
    setHover({
      x: svgXOnLine,
      y: svgYOnLine,
      i: nearest,
      px: dotPx,
      py: dotPy,
    });
  }

  function onLeave() {
    setHover(null);
  }

  const strokeValue = "var(--chart-2)";
  const strokeDeposits = "var(--chart-1)";
  return (
    <div className="relative h-64 w-full">
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {area && (
          <path d={area} fill={strokeValue} fillOpacity={0.04} stroke="none" />
        )}
        <path
          d={pathDeposits}
          fill="none"
          stroke={strokeDeposits}
          strokeWidth={0.3}
        />
        <path
          d={pathValues}
          fill="none"
          stroke={strokeValue}
          strokeWidth={0.3}
        />
        {hover && (
          <line
            x1={hover.x}
            y1={margins.top}
            x2={hover.x}
            y2={40 - margins.bottom}
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeWidth={0.2}
          />
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow"
          style={{ left: hover.px, top: hover.py, background: strokeValue }}
        />
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-card/90 px-2 py-1 text-xs shadow-md whitespace-nowrap"
          style={{
            left: hover.px + 12,
            top: hover.py - 8,
          }}
        >
          {(() => {
            const [ts] = values[hover.i] || [0, 0];
            const val = values[hover.i]?.[1] ?? 0;
            // deposits series is aligned by index when provided
            const dep = deposits[hover.i]?.[1] ?? 0;
            const date = new Intl.DateTimeFormat(undefined, {
              month: "short",
              day: "2-digit",
              year: "2-digit",
            }).format(new Date(ts * 1000));
            const usdFmt = new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 2,
            });
            return (
              <div>
                <div className="font-semibold">{date}</div>
                <div className="opacity-80">Value: {usdFmt.format(val)}</div>
                <div className="opacity-80">Deposits: {usdFmt.format(dep)}</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function buildChart(values: Array<[number, number]>) {
  // Minimal internal margins since axes are hidden; aligns visually with outer p-4
  const margins = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 };
  if (!values || values.length === 0) {
    return {
      path: "",
      area: "",
      scaleX: { min: 0, max: 1 },
      scaleY: { min: 0, max: 1 },
      domainX: { min: 0, max: 1 },
      domainY: { min: 0, max: 1 },
      margins,
    };
  }
  const ys = values.map(([, y]) => y);
  const xs = values.map(([x]) => x);
  const domainX = { min: Math.min(...xs), max: Math.max(...xs) };
  const domainY = { min: Math.min(...ys), max: Math.max(...ys) };
  // pad y domain slightly
  const pad = (domainY.max - domainY.min) * 0.05 || 1;
  domainY.min -= pad;
  domainY.max += pad;
  const scaleX = { min: margins.left, max: 100 - margins.right };
  const scaleY = { min: margins.top, max: 40 - margins.bottom };
  let d = "";
  let area = "";
  const bottom = 40 - margins.bottom;
  values.forEach(([x, y], i) => {
    const nx = toSvgX(x, scaleX, margins, domainX);
    const ny = toSvgY(y, scaleY, margins, domainY);
    const p = `${nx},${ny}`;
    d += i === 0 ? `M ${p}` : ` L ${p}`;
    if (i === 0) {
      area = `M ${nx},${bottom} L ${p}`;
    } else {
      area += ` L ${p}`;
    }
    if (i === values.length - 1) {
      area += ` L ${nx},${bottom} Z`;
    }
  });
  return { path: d, area, scaleX, scaleY, domainX, domainY, margins };
}

function buildMultiChart(
  values: Array<[number, number]>,
  deposits: Array<[number, number]>
) {
  const margins = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 };
  const all = [...values, ...deposits];
  if (!all || all.length === 0) {
    return {
      pathValues: "",
      pathDeposits: "",
      area: "",
      scaleX: { min: 0, max: 1 },
      scaleY: { min: 0, max: 1 },
      domainX: { min: 0, max: 1 },
      domainY: { min: 0, max: 1 },
      margins,
    };
  }
  const ys = all.map(([, y]) => y);
  const xs = all.map(([x]) => x);
  const domainX = { min: Math.min(...xs), max: Math.max(...xs) };
  const domainY = { min: Math.min(...ys), max: Math.max(...ys) };
  const pad = (domainY.max - domainY.min) * 0.05 || 1;
  domainY.min -= pad;
  domainY.max += pad;
  const scaleX = { min: margins.left, max: 100 - margins.right };
  const scaleY = { min: margins.top, max: 40 - margins.bottom };

  const svgVals: Array<[number, number]> = values.map(([x, y]) => [
    toSvgX(x, scaleX, margins, domainX),
    toSvgY(y, scaleY, margins, domainY),
  ]);
  const svgDeps: Array<[number, number]> = deposits.map(([x, y]) => [
    toSvgX(x, scaleX, margins, domainX),
    toSvgY(y, scaleY, margins, domainY),
  ]);

  const pathValues = buildSmoothPath(svgVals);
  const pathDeposits = buildSmoothPath(svgDeps);

  // area under value line
  let area = "";
  if (svgVals.length > 1) {
    const bottom = 40 - margins.bottom;
    area = `M ${svgVals[0][0]},${bottom}`;
    area += ` L ${svgVals[0][0]},${svgVals[0][1]}`;
    for (let i = 1; i < svgVals.length; i++)
      area += ` L ${svgVals[i][0]},${svgVals[i][1]}`;
    area += ` L ${svgVals[svgVals.length - 1][0]},${bottom} Z`;
  }

  return {
    pathValues,
    pathDeposits,
    area,
    scaleX,
    scaleY,
    domainX,
    domainY,
    margins,
  };
}

function buildSmoothPath(points: Array<[number, number]>) {
  if (!points || points.length === 0) return "";
  if (points.length < 3) {
    // fall back to straight line
    let d = "";
    points.forEach(([x, y], i) => {
      const p = `${x},${y}`;
      d += i === 0 ? `M ${p}` : ` L ${p}`;
    });
    return d;
  }
  // Reduce smoothing by decreasing control point influence
  const smoothingFactor = 0; // was ~1/6; smaller -> closer to straight segments
  const d: string[] = [];
  d.push(`M ${points[0][0]},${points[0][1]}`);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) * smoothingFactor;
    const cp1y = p1[1] + (p2[1] - p0[1]) * smoothingFactor;
    const cp2x = p2[0] - (p3[0] - p1[0]) * smoothingFactor;
    const cp2y = p2[1] - (p3[1] - p1[1]) * smoothingFactor;
    d.push(` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`);
  }
  return d.join("");
}

function toSvgX(
  x: number,
  scaleX: { min: number; max: number },
  margins: { left: number; right: number },
  domainX: { min: number; max: number } = { min: 0, max: 1 }
) {
  const rangeX = domainX.max - domainX.min || 1;
  return ((x - domainX.min) / rangeX) * (scaleX.max - scaleX.min) + scaleX.min;
}

function toSvgY(
  y: number,
  scaleY: { min: number; max: number },
  margins: { top: number; bottom: number },
  domainY: { min: number; max: number } = { min: 0, max: 1 }
) {
  const rangeY = domainY.max - domainY.min || 1;
  const ny =
    ((y - domainY.min) / rangeY) * (scaleY.max - scaleY.min) + scaleY.min;
  return 40 - ny; // invert y axis
}

function domainFromX(
  svgX: number,
  scaleX: { min: number; max: number },
  domainX: { min: number; max: number }
) {
  const t = (svgX - scaleX.min) / (scaleX.max - scaleX.min);
  return domainX.min + t * (domainX.max - domainX.min);
}

function AxisLabels({
  xTicks,
  yTicks,
  domainX,
  domainY,
  scaleX,
  scaleY,
  margins,
}: {
  xTicks: number[];
  yTicks: number[];
  domainX: { min: number; max: number };
  domainY: { min: number; max: number };
  scaleX: { min: number; max: number };
  scaleY: { min: number; max: number };
  margins: { left: number; right: number; top: number; bottom: number };
}) {
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }),
    []
  );
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }),
    []
  );
  return (
    <g>
      {/* Y axis labels on the left */}
      {yTicks.map((v, idx) => (
        <text
          key={`y-${idx}`}
          x={1}
          y={toSvgY(v, scaleY, margins, domainY)}
          fontSize={2.5}
          fill="currentColor"
          opacity={0.6}
        >
          {formatter.format(v)}
        </text>
      ))}
      {/* X axis labels */}
      {xTicks.map((t, idx) => (
        <text
          key={`x-${idx}`}
          x={toSvgX(t, scaleX, margins, domainX) - 8}
          y={40 - 0.5}
          fontSize={2.5}
          fill="currentColor"
          opacity={0.6}
        >
          {dateFmt.format(new Date(t * 1000))}
        </text>
      ))}
    </g>
  );
}

function linspace(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 1)
    return [min, max];
  const arr: number[] = [];
  const step = (max - min) / (count - 1);
  for (let i = 0; i < count; i++) arr.push(min + i * step);
  return arr;
}

function Tooltip({
  point,
  svgX,
  svgY,
  margins,
}: {
  point: [number, number];
  svgX: number;
  svgY: number;
  margins: { left: number; right: number; top: number; bottom: number };
}) {
  const [ts, val] = point;
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "2-digit",
  }).format(new Date(ts * 1000));
  const usd = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(val);
  const boxW = 40;
  const boxH = 8;
  const offset = 2;
  const x = Math.max(
    margins.left,
    Math.min(100 - margins.right - boxW, svgX + offset)
  );
  const y = Math.max(
    margins.top,
    Math.min(40 - margins.bottom - boxH, svgY - boxH - 1)
  );
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={boxW}
        height={boxH}
        rx={0.8}
        fill="currentColor"
        opacity={0.08}
      />
      <text x={x + 2} y={y + 3.5} fontSize={2.5} fill="currentColor">
        {usd}
      </text>
      <text
        x={x + 2}
        y={y + 6.5}
        fontSize={2.2}
        fill="currentColor"
        opacity={0.8}
      >
        {date}
      </text>
    </g>
  );
}

function generatePlaceholderData(): Point[] {
  const pts: Point[] = [];
  // Deterministic gentle sine wave to avoid hydration mismatches
  for (let i = 0; i <= 100; i += 2) {
    const t = (i / 100) * Math.PI * 2;
    const y = 20 + Math.sin(t) * 6;
    pts.push({ x: i, y });
  }
  return pts;
}
