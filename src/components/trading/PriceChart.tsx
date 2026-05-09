"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
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
import { useWs } from "@/providers/WebSocketProvider";
import type { WsServerMessage } from "@/lib/types";
import * as api from "@/lib/api";
import {
  fonts,
  space,
  type OracleTheme,
  getTradeStyles,
} from "@/lib/oracle-theme";

// =============================================================================
// Constants
// =============================================================================

const TIMEFRAMES = ["LIVE", "1H", "4H", "6H", "1D", "1W", "1M"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

/** Map UI timeframe to candle resolution for the API */
const RESOLUTION_MAP: Record<Exclude<Timeframe, "LIVE">, string> = {
  "1H": "1m",
  "4H": "5m",
  "6H": "5m",
  "1D": "15m",
  "1W": "1h",
  "1M": "4h",
};

/** Map UI timeframe to seconds-ago for the `from` parameter */
const LOOKBACK_SECONDS: Record<Exclude<Timeframe, "LIVE">, number> = {
  "1H": 60 * 60,
  "4H": 4 * 60 * 60,
  "6H": 6 * 60 * 60,
  "1D": 24 * 60 * 60,
  "1W": 7 * 24 * 60 * 60,
  "1M": 30 * 24 * 60 * 60,
};

/** Map UI timeframe to candle bucket size in seconds.
 *  Must match the resolution used for that timeframe so WS updates
 *  snap to the same grid as the REST-loaded candle data. */
const BUCKET_SECONDS: Record<Exclude<Timeframe, "LIVE">, number> = {
  "1H": 60,       // 1m candles
  "4H": 300,      // 5m candles
  "6H": 300,      // 5m candles
  "1D": 900,      // 15m candles
  "1W": 3600,     // 1h candles
  "1M": 14400,    // 4h candles
};

const MAX_LIVE_TICKS = 200;

/** Ticks (0-1000, where 1000 ticks = $1.00) to percentage (0-100) for chart Y-axis */
function ticksToPctValue(ticks: number): number {
  return ticks / 10;
}

// =============================================================================
// PriceChart Component
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
    : { r: 34, g: 197, b: 94 }; // fallback to dark-mode green
}

export default function PriceChart({
  marketId,
  th,
  s,
}: {
  marketId: string;
  th: OracleTheme;
  s: ReturnType<typeof getTradeStyles>;
}) {
  const { addListener, subscribe } = useWs();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Incremented each time the chart instance is recreated (e.g. theme toggle)
  // so the data-loading effect re-fires against the new chart.
  const [chartVersion, setChartVersion] = useState(0);

  // Track prices for the header display.
  // currentPrice and periodStartPrice are in ticks (0-1000).
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [periodStartPrice, setPeriodStartPrice] = useState<number | null>(null);

  // For LIVE mode: accumulate tick data in a mutable ref (no re-renders)
  const liveTicksRef = useRef<{ time: number; value: number }[]>([]);

  // Refs that track mutable values for the WS listener closure
  const timeframeRef = useRef<Timeframe>(timeframe);
  timeframeRef.current = timeframe;

  // Derived display values
  const isUp =
    currentPrice != null && periodStartPrice != null
      ? currentPrice >= periodStartPrice
      : true;
  const lineColor = isUp ? th.yes : th.no;
  const currentPct =
    currentPrice != null ? Math.round(currentPrice / 10) : null;
  const pctChange =
    currentPrice != null &&
    periodStartPrice != null &&
    periodStartPrice !== 0
      ? ((currentPrice - periodStartPrice) / periodStartPrice) * 100
      : null;

  // -------------------------------------------------------------------------
  // 1. Chart creation -- runs once on mount and when theme identity changes.
  //    Does NOT depend on lineColor/isUp (those update via applyOptions).
  // -------------------------------------------------------------------------

  // Use a stable string key for theme identity so we only recreate when
  // the user actually toggles dark/light mode.
  const themeKey = th.isDark ? "dark" : "light";

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
        rightOffset: 5,
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

    const yesRgb = hexToRgb(th.yes);
    const series = chart.addAreaSeries({
      lineColor: th.yes, // initial; updated reactively below
      topColor: `rgba(${yesRgb.r}, ${yesRgb.g}, ${yesRgb.b}, ${th.chartAreaFillTop})`,
      bottomColor: `rgba(${yesRgb.r}, ${yesRgb.g}, ${yesRgb.b}, ${th.chartAreaFillBottom})`,
      lineWidth: 2,
      lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
      priceFormat: {
        type: "custom",
        formatter: (price: number) => `${price.toFixed(1)}%`,
        minMove: 0.1,
      },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: th.yes,
      crosshairMarkerBackgroundColor: th.surface,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Signal data-loading effect to re-run against this new chart instance
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  // -------------------------------------------------------------------------
  // 2. Update series colors when price direction changes (cheap operation).
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!seriesRef.current) return;
    const color = isUp ? th.yes : th.no;
    const rgb = hexToRgb(color);
    seriesRef.current.applyOptions({
      lineColor: color,
      topColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${th.chartAreaFillTop})`,
      bottomColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${th.chartAreaFillBottom})`,
      crosshairMarkerBorderColor: color,
    });
  }, [isUp, th]);

  // -------------------------------------------------------------------------
  // 3a. Build a chart line from the full trades endpoint (fallback).
  // -------------------------------------------------------------------------

  const loadFromTrades = useCallback(async () => {
    if (!seriesRef.current) return;

    const trades = await api.getTrades(marketId);
    if (trades.length === 0) {
      setError("No trade data available");
      return;
    }

    // API returns most-recent-first; reverse for chronological order
    const sorted = [...trades].reverse();
    const now = Math.floor(Date.now() / 1000);
    const dataPoints: { time: UTCTimestamp; value: number }[] = [];

    for (let i = 0; i < sorted.length; i++) {
      // Synthesize timestamps: 2 seconds apart, ending at "now"
      const ts = now - (sorted.length - 1 - i) * 2;
      dataPoints.push({
        time: ts as UTCTimestamp,
        value: ticksToPctValue(sorted[i].price),
      });
    }

    if (dataPoints.length > 0 && seriesRef.current) {
      seriesRef.current.setData(dataPoints);
      setPeriodStartPrice(sorted[0].price);
      setCurrentPrice(sorted[sorted.length - 1].price);
      chartRef.current?.timeScale().fitContent();
    }
  }, [marketId]);

  // -------------------------------------------------------------------------
  // 3b. Data loading: candle-based timeframes
  // -------------------------------------------------------------------------

  const loadCandleData = useCallback(
    async (tf: Exclude<Timeframe, "LIVE">) => {
      if (!seriesRef.current) return;
      setLoading(true);
      setError(null);

      try {
        const resolution = RESOLUTION_MAP[tf];
        const now = Math.floor(Date.now() / 1000);
        const from = now - LOOKBACK_SECONDS[tf];

        let loaded = false;

        // Try the candles API first
        try {
          const candles = await api.getCandles(marketId, resolution, from, now);
          if (seriesRef.current && candles.length > 0) {
            const dataPoints = candles.map((c) => ({
              time: c.time as UTCTimestamp,
              value: ticksToPctValue(c.close),
            }));
            seriesRef.current.setData(dataPoints);
            setPeriodStartPrice(candles[0].open);
            setCurrentPrice(candles[candles.length - 1].close);
            chartRef.current?.timeScale().fitContent();
            loaded = true;
          }
        } catch {
          // Candle endpoint may not exist yet; fall through to trades
        }

        // Fallback: build line chart from trade history
        if (!loaded) {
          await loadFromTrades();
        }
      } catch (e) {
        console.error("Failed to load chart data:", e);
        setError("Chart data unavailable");
      } finally {
        setLoading(false);
      }
    },
    [marketId, loadFromTrades],
  );

  // -------------------------------------------------------------------------
  // 4. Data loading: LIVE tick-by-tick mode
  // -------------------------------------------------------------------------

  const initLiveMode = useCallback(async () => {
    if (!seriesRef.current) return;
    setLoading(true);
    setError(null);

    try {
      // Bootstrap with recent trades from the all-trades endpoint
      const trades = await api.getTrades(marketId);
      if (!seriesRef.current) return;

      const sorted = [...trades].reverse().slice(-MAX_LIVE_TICKS);
      const now = Math.floor(Date.now() / 1000);

      const ticks: { time: number; value: number }[] = [];
      for (let i = 0; i < sorted.length; i++) {
        // Space bootstrap trades 1 second apart
        ticks.push({
          time: now - (sorted.length - 1 - i),
          value: ticksToPctValue(sorted[i].price),
        });
      }

      liveTicksRef.current = ticks;
      seriesRef.current.setData(
        ticks.map((t) => ({
          time: t.time as UTCTimestamp,
          value: t.value,
        })),
      );

      if (sorted.length > 0) {
        setPeriodStartPrice(sorted[0].price);
        setCurrentPrice(sorted[sorted.length - 1].price);
      }

      chartRef.current?.timeScale().scrollToRealTime();
    } catch (e) {
      console.error("Failed to init live mode:", e);
      setError("Live data unavailable");
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  // -------------------------------------------------------------------------
  // 5. Trigger data load on timeframe, market, or chart recreation
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;

    if (timeframe === "LIVE") {
      initLiveMode();
    } else {
      loadCandleData(timeframe);
    }
    // chartVersion ensures data reloads after chart recreation (e.g. theme toggle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, marketId, chartVersion, initLiveMode, loadCandleData]);

  // -------------------------------------------------------------------------
  // 5b. Subscribe to trade events via WebSocket
  // -------------------------------------------------------------------------

  useEffect(() => {
    subscribe(["trades"], marketId);
  }, [subscribe, marketId]);

  // -------------------------------------------------------------------------
  // 6. WebSocket: real-time trade updates
  // -------------------------------------------------------------------------

  useEffect(() => {
    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type !== "trade") return;
      if (String(msg.market_id) !== String(marketId)) return;
      if (!seriesRef.current) return;

      const pctValue = ticksToPctValue(msg.price);
      setCurrentPrice(msg.price);

      if (timeframeRef.current === "LIVE") {
        // LIVE mode: each trade becomes a new point on the line
        const now = Math.floor(Date.now() / 1000);
        const newTick = { time: now, value: pctValue };

        // lightweight-charts requires strictly increasing time values
        const lastTick =
          liveTicksRef.current[liveTicksRef.current.length - 1];
        if (lastTick && now <= lastTick.time) {
          newTick.time = lastTick.time + 1;
        }

        liveTicksRef.current.push(newTick);

        if (liveTicksRef.current.length > MAX_LIVE_TICKS) {
          // Trim old data -- must re-set entire dataset
          liveTicksRef.current = liveTicksRef.current.slice(-MAX_LIVE_TICKS);
          seriesRef.current.setData(
            liveTicksRef.current.map((t) => ({
              time: t.time as UTCTimestamp,
              value: t.value,
            })),
          );
        } else {
          // Efficient single-point append
          seriesRef.current.update({
            time: newTick.time as UTCTimestamp,
            value: newTick.value,
          });
        }

        chartRef.current?.timeScale().scrollToRealTime();
      } else {
        // Standard timeframe: update the current candle bucket.
        // Snap to the bucket boundary so the point aligns with candle-spaced
        // data loaded from REST, preventing visual anomalies from raw-second
        // timestamps landing between candle intervals.
        const tf = timeframeRef.current as Exclude<Timeframe, "LIVE">;
        const bucket = BUCKET_SECONDS[tf] ?? 60;
        const now = Math.floor(Date.now() / 1000);
        const bucketTime = Math.floor(now / bucket) * bucket;
        seriesRef.current.update({
          time: bucketTime as UTCTimestamp,
          value: pctValue,
        });
      }
    });

    return remove;
  }, [marketId, addListener]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      style={{
        ...s.chartContainer,
        height: 320,
        marginBottom: space[8],
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header: price display + Caster watermark */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: `${space[3]}px ${space[4]}px`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          {currentPct != null ? (
            <>
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 22,
                  fontWeight: 600,
                  color: lineColor,
                }}
              >
                {currentPct}% chance
              </span>
              {pctChange != null && (
                <span
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 13,
                    fontWeight: 500,
                    color: isUp ? th.yes : th.no,
                  }}
                >
                  {isUp ? "\u25B2" : "\u25BC"}
                  {Math.abs(pctChange).toFixed(1)}%
                </span>
              )}
            </>
          ) : (
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 22,
                fontWeight: 600,
                color: th.textTertiary,
              }}
            >
              --%
            </span>
          )}
        </div>
        <span
          style={{
            fontFamily: fonts.serif,
            fontSize: 22,
            fontWeight: 400,
            color: th.textTertiary,
            letterSpacing: "-0.02em",
            opacity: 0.5,
          }}
        >
          Caster
        </span>
      </div>

      {/* Chart canvas area */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <div
          ref={chartContainerRef}
          style={{ width: "100%", height: "100%" }}
        />

        {/* Loading overlay */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: th.isDark
                ? "rgba(12, 10, 9, 0.6)"
                : "rgba(245, 240, 232, 0.6)",
              zIndex: 10,
            }}
          >
            <span
              style={{
                fontFamily: fonts.sans,
                fontSize: 13,
                color: th.textSecondary,
                fontStyle: "italic",
              }}
            >
              Loading chart data...
            </span>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
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
                fontFamily: fonts.sans,
                fontSize: 13,
                color: th.textTertiary,
              }}
            >
              {error}
            </span>
          </div>
        )}

        {/* LIVE mode indicator -- pulsing red dot */}
        {timeframe === "LIVE" && !loading && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
              zIndex: 5,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: th.no,
                boxShadow: `0 0 6px ${th.no}`,
                animation: "caster-pulse 1.5s ease-in-out infinite",
              }}
            />
            <span
              style={{
                fontFamily: fonts.sans,
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: th.no,
              }}
            >
              LIVE
            </span>
          </div>
        )}
      </div>

      {/* Timeframe selector */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: `${space[2]}px ${space[4]}px`,
          borderTop: `0.8px solid ${th.border}`,
          flexShrink: 0,
        }}
      >
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            style={{
              ...s.chartTimeframeBtn(timeframe === tf),
              // LIVE tab uses the red accent when active
              ...(tf === "LIVE" && timeframe === "LIVE"
                ? { color: th.no, borderBottomColor: th.no }
                : {}),
            }}
            onClick={() => setTimeframe(tf)}
          >
            {tf}
          </button>
        ))}
      </div>

    </div>
  );
}
