"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTrades } from "@/hooks/useTrades";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { formatDollars } from "@/lib/format";
import { formatRelativeTime } from "@/lib/portfolio";
import { fonts, type, type OracleTheme } from "@/lib/oracle-theme";

/* ------------------------------------------------------------------ *
 * TradeTape -- vertical live trade sidebar (M1)
 *
 * Scoped to a single market via `useTrades(marketId)` which already
 * subscribes to the per-market `trades:{id}` WS channel and bootstraps
 * from /market/{id}/trades/recent. Newest on top, capped at 20 rows.
 *
 * Motion budget
 * -------------
 * This is ONE of the two permitted moving elements in the foveal view
 * (the price chart is the other). Each incoming trade row briefly
 * flashes `flashBg` (150ms, ease-out) and that's it -- no marquee, no
 * auto-scroll, no infinite pulse on the whole column. Under reduced
 * motion the flash is skipped and the list just pops in.
 *
 * Layout
 * ------
 * Self-contained panel that the market page renders as a right-side
 * sidebar next to the orderbook on desktop, or below it on narrow
 * screens. The component doesn't set its own width -- the parent
 * decides (e.g. via a 2-col grid or a fixed-width aside).
 * ------------------------------------------------------------------ */

interface Props {
  marketId: string;
  th: OracleTheme;
  /** Rows to keep in the DOM. 20 is the cap from the UX proposal; the
   * underlying `useTrades` hook buffers up to 50 so this is the visible
   * slice. */
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 20;

export function TradeTape({ marketId, th, maxRows = DEFAULT_MAX_ROWS }: Props) {
  const trades = useTrades(marketId);
  const reducedMotion = usePrefersReducedMotion();

  // Re-render the "Xs ago" column at a modest cadence so the relative
  // timestamps don't freeze on stale values when no new trades arrive.
  // 5s is the right granularity -- finer is wasted work, coarser lags
  // the "2s ago -> 3s ago" reading under the minute-boundary.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  // Track the newest timestamp we've already "flashed" so the flash
  // only fires on freshly-arrived trades, never on re-renders triggered
  // by the tick interval above.
  const lastFlashedRef = useRef<string | null>(null);
  const [flashTs, setFlashTs] = useState<string | null>(null);

  useEffect(() => {
    if (trades.length === 0) return;
    const newest = trades[0].timestamp;
    if (newest !== lastFlashedRef.current) {
      // On the very first paint, don't flash the whole initial set --
      // that defeats the point (nothing is actually "new"). Only flash
      // once we've observed at least one timestamp.
      if (lastFlashedRef.current !== null && !reducedMotion) {
        setFlashTs(newest);
        const t = setTimeout(() => setFlashTs(null), 220);
        lastFlashedRef.current = newest;
        return () => clearTimeout(t);
      }
      lastFlashedRef.current = newest;
    }
  }, [trades, reducedMotion]);

  const visibleTrades = useMemo(() => trades.slice(0, maxRows), [trades, maxRows]);

  return (
    <div
      aria-label="Live trade tape"
      style={{
        border: `0.8px solid ${th.border}`,
        borderRadius: 2,
        background: th.surface,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        // Fill the grid cell assigned by `.market-orderbook-row` so the
        // tape matches the orderbook's height (the grid is
        // `align-items: stretch`).
        height: "100%",
        minHeight: 0,
        // `--tape-flash-bg` is consumed by the `tradeTapeFlash` keyframes
        // in globals.css -- set per-theme so dark + light both work.
        ["--tape-flash-bg" as string]: th.flashBg,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: `0.8px solid ${th.divider}`,
          background: th.surface,
        }}
      >
        <span style={{ ...type.metaLabel, color: th.textTertiary }}>Live Tape</span>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: th.accentFrom,
            // 2s gentle opacity pulse; suppressed under reduced motion
            // (the animation style evaluates to `undefined`).
            animation: reducedMotion ? undefined : "liveDotPulse 2s ease-in-out infinite",
          }}
        />
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "42px 1fr auto",
          gap: 8,
          alignItems: "center",
          padding: "6px 12px",
          borderBottom: `0.8px solid ${th.divider}`,
          ...type.columnHeader,
          color: th.textTertiary,
        }}
      >
        <span>Side</span>
        <span style={{ textAlign: "right" }}>Price / $</span>
        <span style={{ textAlign: "right" }}>Age</span>
      </div>

      {/* Rows -- flexes to fill the remaining height in the panel, with
          internal scrolling when the tape overflows. The parent
          `.market-trade-tape` cell sizes the panel to match the
          orderbook's height via `align-items: stretch`; inside that
          envelope we hand the rows container `flex: 1` + `min-height: 0`
          so it takes whatever vertical space the header/column-labels
          didn't claim without pushing the panel taller. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {visibleTrades.length === 0 && (
          <div
            style={{
              ...type.emptyState,
              color: th.textTertiary,
              textAlign: "center",
              padding: "24px 12px",
            }}
          >
            Awaiting trades…
          </div>
        )}
        {visibleTrades.map((trade, idx) => {
          const isBuy = trade.taker_side === "Buy";
          const priceDollars = trade.price / 1000;
          const notional = priceDollars * trade.quantity;
          // Parse once per row -- API timestamps are ISO strings at this
          // point (see useTrades); Date.parse returns NaN only if the
          // string is malformed, in which case we fall back to "--".
          const parsedMs = Date.parse(trade.timestamp);
          const ageLabel = Number.isFinite(parsedMs) ? formatRelativeTime(parsedMs) : "--";
          const shouldFlash = flashTs === trade.timestamp && idx === 0;

          return (
            <div
              key={`${trade.timestamp}-${idx}`}
              className="trade-tape-row"
              style={{
                display: "grid",
                gridTemplateColumns: "42px 1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "6px 12px",
                borderBottom: `0.8px solid ${th.divider}`,
                // Tasteful 150ms flash on the newest row -- not the whole
                // column. Keyframe fades from `--tape-flash-bg` (set on
                // the root) to transparent.
                animation: shouldFlash ? "tradeTapeFlash 150ms ease-out" : undefined,
              }}
            >
              <span
                style={{
                  ...type.tabLabel,
                  fontWeight: 600,
                  color: isBuy ? th.yes : th.no,
                  letterSpacing: "0.06em",
                }}
              >
                {isBuy ? "BUY" : "SELL"}
              </span>
              <span style={{ textAlign: "right" as const, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <span
                  style={{
                    ...type.monoPrice,
                    color: th.textPrimary,
                  }}
                >
                  {(priceDollars * 100).toFixed(0)}&cent;
                </span>
                <span
                  style={{
                    ...type.monoQty,
                    color: th.textSecondary,
                    minWidth: 48,
                  }}
                >
                  {formatDollars(notional)}
                </span>
              </span>
              <span
                style={{
                  ...type.volumeLabel,
                  color: th.textTertiary,
                  fontVariantNumeric: "tabular-nums" as const,
                  fontFamily: fonts.mono,
                  fontSize: 10,
                }}
              >
                {ageLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
