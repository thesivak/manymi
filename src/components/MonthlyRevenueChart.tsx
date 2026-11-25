"use client";

import { useState } from "react";
import { formatCzk } from "@/lib/domain/money";

export interface MonthlyBarPoint {
  monthIndex: number; // 0..11
  shortLabel: string;
  fullLabel: string;
  totalMinor: number;
  count: number;
  isFuture: boolean;
  isCurrent: boolean;
}

export function MonthlyRevenueChart({
  year,
  points,
  averageMinor,
}: {
  year: number;
  points: MonthlyBarPoint[];
  averageMinor: number;
}) {
  const defaultIdx =
    points.findIndex((p) => p.isCurrent) >= 0
      ? points.findIndex((p) => p.isCurrent)
      : points.length - 1;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const active = points[hoveredIdx ?? defaultIdx] ?? points[0];

  const maxVal = Math.max(
    ...points.map((p) => p.totalMinor),
    averageMinor,
    10000000, // min scale 100 tis. Kč
  );
  const stepMinor =
    maxVal <= 30000000
      ? 10000000
      : maxVal <= 90000000
        ? 20000000
        : Math.ceil(maxVal / 3 / 10000000) * 10000000;
  const ceilMinor = Math.max(stepMinor * 3, Math.ceil(maxVal / stepMinor) * stepMinor);

  const svgW = 680;
  const svgH = 260;
  const padLeft = 58;
  const padRight = 14;
  const padTop = 26;
  const padBottom = 30;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;
  const slotW = plotW / points.length;
  const barW = Math.min(30, slotW * 0.62);

  const yFor = (minor: number) =>
    padTop + plotH - (Math.min(minor, ceilMinor) / ceilMinor) * plotH;

  const gridTicks = [0, 1, 2, 3].map((i) => i * stepMinor).filter((v) => v <= ceilMinor);
  const avgY = yFor(averageMinor);

  return (
    <div>
      <p className="small muted" style={{ marginBottom: 6 }}>
        Fakturováno v roce {year}, Kč s DPH
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <p className="small muted num">
            {active.fullLabel} {year} ·{" "}
            {active.count === 1
              ? "1 faktura"
              : active.count >= 2 && active.count <= 4
                ? `${active.count} faktury`
                : `${active.count} faktur`}
          </p>
          <p className="display num" style={{ fontSize: 34, marginTop: 2 }}>
            {formatCzk(active.totalMinor)}
          </p>
        </div>

        <div style={{ display: "flex", gap: 18, fontSize: 12.5, color: "var(--muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: "var(--ink)",
                display: "inline-block",
              }}
            />
            Fakturováno
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 16,
                borderTop: "1.5px dashed var(--ink)",
                display: "inline-block",
              }}
            />
            Měsíční průměr
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%"
        height={260}
        role="img"
        aria-label={`Graf měsíční fakturace za rok ${year}`}
        style={{ display: "block" }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {gridTicks.map((tick) => {
          const y = yFor(tick);
          const label =
            tick === 0 ? "0" : `${Math.round(tick / 100000)} tis.`;
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={svgW - padRight}
                y1={y}
                y2={y}
                stroke={tick === 0 ? "#0B1220" : "#E5E7EB"}
                strokeWidth={tick === 0 ? 1.5 : 1}
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="11.5"
                fill="#6B7280"
                className="num"
              >
                {label}
              </text>
            </g>
          );
        })}

        {averageMinor > 0 && (
          <line
            x1={padLeft}
            x2={svgW - padRight}
            y1={avgY}
            y2={avgY}
            stroke="#0B1220"
            strokeWidth="1.2"
            strokeDasharray="4 4"
            opacity="0.7"
          />
        )}

        {points.map((pt, idx) => {
          const cx = padLeft + idx * slotW + slotW / 2;
          const x = cx - barW / 2;
          const barTop = yFor(pt.totalMinor);
          const barH = Math.max(0, padTop + plotH - barTop);
          const isFocused = hoveredIdx === idx;
          const dimmed = hoveredIdx !== null && hoveredIdx !== idx;

          return (
            <g
              key={pt.monthIndex}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredIdx(idx)}
            >
              <rect
                x={padLeft + idx * slotW}
                y={padTop}
                width={slotW}
                height={plotH + padBottom}
                fill="transparent"
              />
              {pt.isFuture && pt.totalMinor === 0 ? (
                <rect
                  x={x}
                  y={padTop + plotH - 56}
                  width={barW}
                  height={56}
                  fill="none"
                  stroke="#D1D5DB"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              ) : (
                <rect
                  x={x}
                  y={barTop}
                  width={barW}
                  height={barH}
                  fill={dimmed ? "#D1D5DB" : "#0B1220"}
                />
              )}
              {(isFocused || (hoveredIdx === null && pt.isCurrent)) &&
                pt.totalMinor > 0 && (
                  <text
                    x={cx}
                    y={Math.max(14, barTop - 7)}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#0B1220"
                    className="num"
                  >
                    {Math.round(pt.totalMinor / 100000)} tis.
                  </text>
                )}
              <text
                x={cx}
                y={svgH - 8}
                textAnchor="middle"
                fontSize="12"
                fontWeight={pt.isCurrent || isFocused ? "700" : "400"}
                fill={pt.isCurrent || isFocused ? "#0B1220" : "#6B7280"}
              >
                {pt.shortLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
