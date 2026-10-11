"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { Granularity } from "../range";

export interface ChartPoint {
  bucket: string;
  totalBeds: number;
  occupiedBeds: number;
  percent: number;
}

const HEIGHT = 220;
const PAD = { top: 16, right: 48, bottom: 28, left: 40 };
const TICKS = [0, 25, 50, 75, 100];

const dayLabel = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const monthLabel = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const longDay = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const asDate = (bucket: string) => new Date(`${bucket}T00:00:00Z`);
const beds = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * Occupancy over time (E8-T2): one series, so the title names it and there is
 * no legend. A crosshair snaps to the nearest day or month (pointer or arrow
 * keys) and the same values are available as a table.
 */
export function TrendChart({
  points,
  granularity,
}: {
  points: readonly ChartPoint[];
  granularity: Granularity;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const short = (bucket: string) =>
    (granularity === "day" ? dayLabel : monthLabel).format(asDate(bucket));
  const long = (bucket: string) =>
    (granularity === "day" ? longDay : longMonth).format(asDate(bucket));

  if (points.length === 0) {
    return <p className="text-sm text-slate-600">No days in this range have happened yet.</p>;
  }

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotWidth / 2 : (i / (points.length - 1)) * plotWidth);
  const y = (percent: number) => PAD.top + plotHeight - (Math.min(percent, 100) / 100) * plotHeight;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.percent)}`).join("");
  const area = `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const last = points.length - 1;
  // First, middle and last labels keep the axis readable at any range length.
  const xLabels = [...new Set([0, Math.floor(last / 2), last])];

  function nearest(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - box.left;
    const index = points.length === 1 ? 0 : Math.round((offset / box.width) * last);
    setActive(Math.max(0, Math.min(last, index)));
  }

  function onKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setActive((current) => Math.max(0, Math.min(last, (current ?? last) + step)));
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  const shown = active === null ? null : points[active];
  const tooltipLeft = active === null ? 0 : Math.min(Math.max(x(active) - 80, 0), width - 160);

  return (
    <div>
      <div ref={frame} className="relative">
        <svg
          // Scales from the default width until the frame is measured, so it never overflows.
          width="100%"
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Occupancy from ${long(points[0].bucket)} to ${long(points[last].bucket)}: ${points[last].percent}% at the end. Use the left and right arrow keys to read each ${granularity}.`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="block rounded-md focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          {TICKS.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-slate-200"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-slate-500 text-[11px] tabular-nums"
              >
                {tick}%
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor={
                points.length === 1 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"
              }
              className="fill-slate-500 text-[11px]"
            >
              {short(points[i].bucket)}
            </text>
          ))}

          {points.length > 1 && (
            <>
              <path d={area} className="fill-brand-600" fillOpacity={0.1} />
              <path
                d={line}
                fill="none"
                className="stroke-brand-600"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}

          {shown && active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
              className="stroke-slate-400"
              strokeWidth={1}
            />
          )}

          {/* End marker and its direct label. */}
          <circle
            cx={x(last)}
            cy={y(points[last].percent)}
            r={4}
            className="fill-brand-600 stroke-white"
            strokeWidth={2}
          />
          <text
            x={x(last) + 8}
            y={y(points[last].percent)}
            dy="0.32em"
            className="fill-slate-900 text-xs font-semibold tabular-nums"
          >
            {points[last].percent}%
          </text>

          {shown && active !== null && active !== last && (
            <circle
              cx={x(active)}
              cy={y(shown.percent)}
              r={4}
              className="fill-brand-600 stroke-white"
              strokeWidth={2}
            />
          )}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={nearest}
            onPointerDown={nearest}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {shown && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 w-40 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{ left: tooltipLeft }}
          >
            <p className="text-sm font-semibold text-slate-900 tabular-nums">{shown.percent}%</p>
            <p className="text-slate-600">
              {beds(shown.occupiedBeds)} of {beds(shown.totalBeds)} beds
              {granularity === "month" && " on average"}
            </p>
            <p className="mt-1 text-slate-500">{long(shown.bucket)}</p>
          </div>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
          Show as table
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slate-200">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Occupancy by {granularity}</caption>
            <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">{granularity === "day" ? "Day" : "Month"}</th>
                <th className="px-3 py-2 text-right font-medium">Occupied beds</th>
                <th className="px-3 py-2 text-right font-medium">Beds</th>
                <th className="px-3 py-2 text-right font-medium">Occupancy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {points.map((point) => (
                <tr key={point.bucket}>
                  <td className="px-3 py-1.5">{long(point.bucket)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {beds(point.occupiedBeds)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{beds(point.totalBeds)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{point.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
