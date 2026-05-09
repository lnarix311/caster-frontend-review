"use client";

import {
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LastPriceAnimationMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  fonts,
  space,
  type OracleTheme,
} from "@/lib/oracle-theme";

// =============================================================================
// Types
// =============================================================================

export interface EquitySnapshot {
  time: number; // milliseconds since epoch
  value: number; // ticks (1000 = $1)
}

interface EquityChartProps {
  th: OracleTheme;
  snapshots: EquitySnapshot[];
  isPositive: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Convert a hex color (#RRGGBB) to {r, g, b} components for gradient use. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 34, g: 197, b: 94 };
}

/** Convert ticks to dollars for the Y-axis. */
function ticksToDollarValue(ticks: number): number {
  return ticks / 1000;
}

// =============================================================================
// Component
// =============================================================================

export default function EquityChart({ th, snapshots, isPositive }: EquityChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [chartVersion, setChartVersion] = useState(0);

  const themeKey = th.isDark ? "dark" : "light";
  const lineColor = isPositive ? th.yes : th.no;

  // Derive current value and change from snapshots
  const currentValue = snapshots.length > 0 ? snapshots[snapshots.length - 1].value : null;
  const startValue = snapshots.length > 0 ? snapshots[0].value : null;
  const changePct = currentValue != null && startValue != null && startValue > 0
    ? ((currentValue - startValue) / startValue) * 100
    : null;

  // Prepare chart data points -- deduplicate timestamps (lightweight-charts
  // requires strictly increasing time values)
  const dataPoints = useMemo(() => {
    if (snapshots.length < 2) return [];
    const seen = new Set<number>();
    const points: { time: UTCTimestamp; value: number }[] = [];
    for (const s of snapshots) {
      // Convert ms -> seconds for lightweight-charts
      let ts = Math.floor(s.time / 1000);
      // Ensure strictly increasing
      while (seen.has(ts)) {
        ts += 1;
      }
      seen.add(ts);
      points.push({
        time: ts as UTCTimestamp,
        value: ticksToDollarValue(s.value),
      });
    }
    return points;
  }, [snapshots]);

  // -------------------------------------------------------------------------
  // 1. Chart creation -- runs on mount and when theme changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: th.textTertiary,
        fontFamily: fonts.sans,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: th.chartGrid, style: LineStyle.Dotted },
        horzLines: { color: th.chartGrid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: th.isDark
            ? "rgba(235, 232, 228, 0.2)"
            : "rgba(26, 26, 26, 0.15)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: th.surface,
        },
        horzLine: {
          color: th.isDark
            ? "rgba(235, 232, 228, 0.2)"
            : "rgba(26, 26, 26, 0.15)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: th.surface,
        },
      },
      rightPriceScale: {
        borderColor: th.chartGrid,
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: {
        borderColor: th.chartGrid,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
        barSpacing: 6,
        fixLeftEdge: true,
        fixRightEdge: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const rgb = hexToRgb(isPositive ? th.yes : th.no);
    const series = chart.addAreaSeries({
      lineColor: isPositive ? th.yes : th.no,
      topColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${th.chartAreaFillTop})`,
      bottomColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${th.chartAreaFillBottom})`,
      lineWidth: 2,
      lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
      priceFormat: {
        type: "custom",
        formatter: (price: number) => `$${price.toFixed(2)}`,
        minMove: 0.01,
      },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: isPositive ? th.yes : th.no,
      crosshairMarkerBackgroundColor: th.surface,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    setChartVersion((v) => v + 1);

    // Responsive resizing
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      prevSnapshotCountRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  // -------------------------------------------------------------------------
  // 2. Update series colors when direction changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!seriesRef.current) return;
    const color = isPositive ? th.yes : th.no;
    const rgb = hexToRgb(color);
    seriesRef.current.applyOptions({
      lineColor: color,
      topColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${th.chartAreaFillTop})`,
      bottomColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${th.chartAreaFillBottom})`,
      crosshairMarkerBorderColor: color,
    });
  }, [isPositive, th]);

  // -------------------------------------------------------------------------
  // 3. Feed data into chart (handles both full loads and incremental appends)
  // -------------------------------------------------------------------------

  const prevSnapshotCountRef = useRef(0);
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (dataPoints.length < 2) {
      seriesRef.current.setData([]);
      prevSnapshotCountRef.current = dataPoints.length;
      return;
    }

    // If chart was just recreated (chartVersion changed) or first load, do a full setData
    if (prevSnapshotCountRef.current === 0 || dataPoints.length <= prevSnapshotCountRef.current) {
      seriesRef.current.setData(dataPoints);
      chartRef.current.timeScale().fitContent();
    } else {
      // Incremental: just append the last point
      const lastPoint = dataPoints[dataPoints.length - 1];
      seriesRef.current.update(lastPoint);
    }
    prevSnapshotCountRef.current = dataPoints.length;
  }, [dataPoints, chartVersion]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const hasData = dataPoints.length >= 2;

  return (
    <div
      style={{
        overflow: "hidden",
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header: label + value + change */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `${space[2]}px ${space[3]}px`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: fonts.sans,
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: th.textTertiary,
          }}
        >
          Equity Curve
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {currentValue != null && (
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 13,
                fontWeight: 500,
                color: th.textPrimary,
              }}
            >
              ${(currentValue / 1000).toFixed(2)}
            </span>
          )}
          {changePct != null && (
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 12,
                fontWeight: 500,
                color: lineColor,
              }}
            >
              {changePct >= 0 ? "\u25B2" : "\u25BC"}
              {Math.abs(changePct).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Chart canvas */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <div
          ref={chartContainerRef}
          style={{ width: "100%", height: "100%" }}
        />

        {/* Empty state overlay */}
        {!hasData && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <span
              style={{
                fontFamily: fonts.serif,
                fontSize: 14,
                fontStyle: "italic",
                color: th.textTertiary,
              }}
            >
              Portfolio history builds as prices update
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
