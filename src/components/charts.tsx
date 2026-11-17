import { useState } from "react";
import { formatNumber } from "../lib/format";

type Point = { label: string; value: number };

function niceMax(max: number) {
  if (max <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Vertical bars, one per day. Hover (or focus) a bar to read its value. */
export function BarChart({ data, format = formatNumber, height = 190 }: { data: Point[]; format?: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, padL = 36, padR = 8, padT = 12, padB = 26;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const step = innerW / Math.max(1, data.length);
  const barW = Math.max(2, step * 0.62);
  const every = Math.ceil(data.length / 7);

  return (
    <div className="chartWrap">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Bar chart">
        <g className="chartGrid chartAxis">
          {[0, 0.5, 1].map((t) => {
            const y = padT + innerH * (1 - t);
            return (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y} y2={y} />
                <text x={padL - 8} y={y + 4} textAnchor="end">{format(Math.round(max * t))}</text>
              </g>
            );
          })}
        </g>
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = padL + i * step + (step - barW) / 2;
          return (
            <g key={d.label + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={padL + i * step} y={padT} width={step} height={innerH} fill="transparent" />
              <rect className="chartBar" x={x} y={padT + innerH - h} width={barW} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={3} />
              {i % every === 0 && <text className="chartAxis" x={x + barW / 2} y={height - 7} textAnchor="middle" style={{ fill: "var(--muted)", fontSize: 11 }}>{d.label}</text>}
            </g>
          );
        })}
        {hover !== null && (
          <g pointerEvents="none">
            <rect x={Math.min(W - 128, Math.max(padL, padL + hover * step - 44))} y={0} width={124} height={22} rx={6} fill="var(--ink)" />
            <text x={Math.min(W - 128, Math.max(padL, padL + hover * step - 44)) + 62} y={15} textAnchor="middle" style={{ fill: "var(--surface)", fontSize: 11, fontWeight: 600 }}>
              {data[hover].label}: {format(data[hover].value)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/** A smooth-ish line with a soft area under it. */
export function LineChart({ data, format = formatNumber, height = 190 }: { data: Point[]; format?: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, padL = 44, padR = 10, padT = 14, padB = 26;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const x = (i: number) => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = data.length ? `${line} L${x(data.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z` : "";
  const every = Math.ceil(data.length / 7);

  return (
    <div className="chartWrap">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Line chart" onMouseLeave={() => setHover(null)}>
        <g className="chartGrid chartAxis">
          {[0, 0.5, 1].map((t) => {
            const yy = padT + innerH * (1 - t);
            return (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={yy} y2={yy} />
                <text x={padL - 8} y={yy + 4} textAnchor="end">{format(Math.round(max * t))}</text>
              </g>
            );
          })}
        </g>
        <path className="chartArea" d={area} />
        <path className="chartLine" d={line} />
        {data.map((d, i) => (
          <g key={d.label + i}>
            <rect x={x(i) - innerW / data.length / 2} y={padT} width={innerW / data.length} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            {i % every === 0 && <text x={x(i)} y={height - 7} textAnchor="middle" style={{ fill: "var(--muted)", fontSize: 11 }}>{d.label}</text>}
          </g>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <circle className="chartDot" cx={x(hover)} cy={y(data[hover].value)} r={5} />
            <rect x={Math.min(W - 150, Math.max(padL, x(hover) - 70))} y={0} width={140} height={22} rx={6} fill="var(--ink)" />
            <text x={Math.min(W - 150, Math.max(padL, x(hover) - 70)) + 70} y={15} textAnchor="middle" style={{ fill: "var(--surface)", fontSize: 11, fontWeight: 600 }}>
              {data[hover].label}: {format(data[hover].value)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/** Horizontal ranking bars (top services, cities, ...). */
export function HBars({ data, format = formatNumber }: { data: { name: string; value: number; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hbarList">
      {data.map((d) => (
        <div key={d.name} className="hbarRow">
          <div className="hbarTop">
            <span className="clip" style={{ maxWidth: "70%" }}>{d.name}</span>
            <span className="muted mono">{format(d.value)}{d.sub ? ` · ${d.sub}` : ""}</span>
          </div>
          <div className="hbarTrack"><div className="hbarFill" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
